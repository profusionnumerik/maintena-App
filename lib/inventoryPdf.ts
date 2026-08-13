/**
 * lib/inventoryPdf.ts
 * Génère un HTML complet d'état des lieux — converti en PDF via expo-print.
 * Format inspiré du modèle ALUR (loi du 27 mars 2014).
 */

import {
  InventoryReport,
  InventoryRoom,
  INVENTORY_TYPE_LABELS,
  ELEMENT_CONDITION_LABELS,
  METER_TYPE_LABELS,
  KEY_ITEM_TYPE_LABELS,
  EQUIPMENT_CATEGORY_LABELS,
} from "@/shared/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s?: string | null): string {
  if (!s) return "—";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit", month: "long", year: "numeric",
    });
  } catch { return "—"; }
}

function fmtDt(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function condLabel(c?: string | null): string {
  if (!c || c === "not_checked") return "Non vérifié";
  return (ELEMENT_CONDITION_LABELS as Record<string, string>)[c] ?? c;
}

function condColor(c?: string | null): string {
  const map: Record<string, string> = {
    neuf:        "#16a34a",
    bon:         "#2563eb",
    usage:       "#d97706",
    vetuste:     "#dc2626",
    degrade:     "#9f1239",
    not_checked: "#94a3b8",
  };
  return map[c ?? "not_checked"] ?? "#94a3b8";
}

// ── Sections HTML ─────────────────────────────────────────────────────────────

function roomsHtml(rooms: InventoryRoom[]): string {
  if (rooms.length === 0) return "<p class='empty'>Aucune pièce renseignée.</p>";

  return rooms.map((room) => {
    const items = room.items.map((item) => `
      <tr>
        <td>${esc(item.name)}</td>
        <td style="color:${condColor(item.condition)};font-weight:600">${condLabel(item.condition)}</td>
        <td>${esc(item.observation)}</td>
      </tr>
    `).join("");

    return `
      <div class="room">
        <div class="room-header">
          <span class="room-name">${esc(room.name)}</span>
          <span class="room-cond" style="color:${condColor(room.generalCondition)}">
            État général : ${condLabel(room.generalCondition)}
          </span>
        </div>
        ${room.observation ? `<p class="room-obs">Observations : ${esc(room.observation)}</p>` : ""}
        ${items ? `
        <table class="items-table">
          <thead>
            <tr><th>Élément</th><th>État</th><th>Observations</th></tr>
          </thead>
          <tbody>${items}</tbody>
        </table>` : "<p class='empty'>Aucun élément renseigné.</p>"}
      </div>
    `;
  }).join("");
}

function metersHtml(report: InventoryReport): string {
  if (!report.meterReadings?.length) return "<p class='empty'>Aucun relevé renseigné.</p>";
  const rows = report.meterReadings.map((m) => `
    <tr>
      <td>${esc((METER_TYPE_LABELS as Record<string, string>)[m.type] ?? m.type)}</td>
      <td class="num">${esc(m.index)} ${esc(m.unit)}</td>
      <td>${esc(m.number)}</td>
      <td>${esc(m.comment)}</td>
    </tr>
  `).join("");
  return `
    <table class="data-table">
      <thead><tr><th>Compteur</th><th>Relevé</th><th>N° compteur</th><th>Commentaire</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function keysHtml(report: InventoryReport): string {
  if (!report.keyItems?.length) return "<p class='empty'>Aucune clé renseignée.</p>";
  const rows = report.keyItems.map((k) => `
    <tr>
      <td>${esc((KEY_ITEM_TYPE_LABELS as Record<string, string>)[k.type] ?? k.type)}</td>
      <td class="num">${k.quantity}</td>
      <td>${esc(k.observation)}</td>
    </tr>
  `).join("");
  return `
    <table class="data-table">
      <thead><tr><th>Type de clé / badge</th><th>Qté</th><th>Observations</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function equipmentHtml(report: InventoryReport): string {
  if (!report.equipment?.length) return "<p class='empty'>Aucun équipement renseigné.</p>";
  const rows = report.equipment.map((e) => `
    <tr>
      <td>${esc(e.name)}</td>
      <td>${esc((EQUIPMENT_CATEGORY_LABELS as Record<string, string>)[e.category] ?? e.category)}</td>
      <td style="color:${condColor(e.condition)};font-weight:600">${condLabel(e.condition)}</td>
      <td>${esc(e.serialNumber)}</td>
      <td>${esc(e.observation)}</td>
    </tr>
  `).join("");
  return `
    <table class="data-table">
      <thead><tr><th>Équipement</th><th>Catégorie</th><th>État</th><th>N° série</th><th>Observations</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function sigBlock(label: string, name: string, record?: { status?: string; signedAt?: string } | null): string {
  const signed = record?.status === "signed";
  return `
    <div class="sig-block">
      <div class="sig-label">${label}</div>
      <div class="sig-name">${esc(name)}</div>
      ${signed
        ? `<div class="sig-date">Signé électroniquement le ${fmtDt(record?.signedAt)}</div>
           <div class="sig-stamp">✓ SIGNATURE ÉLECTRONIQUE</div>`
        : `<div class="sig-pending">Signature en attente</div>
           <div class="sig-line"></div>`
      }
    </div>
  `;
}

// ── Générateur principal ──────────────────────────────────────────────────────

export function generateInventoryHtml(
  report: InventoryReport,
  rooms: InventoryRoom[]
): string {
  const snap = report.propertySnapshot;
  const typeLabel = INVENTORY_TYPE_LABELS[report.type] ?? report.type;
  const today = fmt(report.finalizedAt ?? report.createdAt);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    color: #1a1a2e;
    background: #fff;
    padding: 28px 32px;
    line-height: 1.5;
  }

  /* ── En-tête ── */
  .header {
    border-top: 5px solid #1e3a5f;
    padding-top: 16px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .header-left .doc-type {
    font-size: 18pt;
    font-weight: 700;
    color: #1e3a5f;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .header-left .doc-sub {
    font-size: 9pt;
    color: #64748b;
    margin-top: 3px;
  }
  .header-right {
    text-align: right;
    font-size: 9pt;
    color: #475569;
  }
  .header-right .ref {
    font-size: 8pt;
    color: #94a3b8;
    margin-top: 4px;
  }

  /* ── Sections ── */
  .section {
    margin-bottom: 22px;
    break-inside: avoid;
  }
  .section-title {
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #fff;
    background: #1e3a5f;
    padding: 6px 12px;
    margin-bottom: 10px;
    border-radius: 3px;
  }

  /* ── Info logement ── */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
    padding: 0 4px;
  }
  .info-row { display: flex; gap: 6px; }
  .info-label { font-weight: 600; color: #475569; min-width: 120px; font-size: 10pt; }
  .info-value { color: #1a1a2e; font-size: 10pt; }

  /* ── Parties ── */
  .parties-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    padding: 0 4px;
  }
  .party {
    border: 1.5px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px;
  }
  .party-role {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #64748b;
    margin-bottom: 6px;
  }
  .party-name { font-size: 12pt; font-weight: 700; color: #1e3a5f; }
  .party-detail { font-size: 9pt; color: #475569; margin-top: 2px; }

  /* ── Pièces ── */
  .room {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: hidden;
    break-inside: avoid;
  }
  .room-header {
    background: #f1f5f9;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #e2e8f0;
  }
  .room-name { font-weight: 700; font-size: 11pt; color: #1e3a5f; }
  .room-cond { font-size: 9pt; font-weight: 600; }
  .room-obs  { font-size: 9.5pt; color: #475569; padding: 6px 12px; background: #fafafa; border-bottom: 1px solid #f1f5f9; font-style: italic; }

  /* ── Tableaux ── */
  .items-table, .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5pt;
  }
  .items-table th, .data-table th {
    background: #f8fafc;
    font-weight: 600;
    text-align: left;
    padding: 6px 10px;
    color: #475569;
    border-bottom: 1.5px solid #e2e8f0;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .items-table td, .data-table td {
    padding: 5px 10px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
  }
  .items-table tr:last-child td, .data-table tr:last-child td { border-bottom: none; }
  .items-table tr:nth-child(even) td, .data-table tr:nth-child(even) td { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  /* ── Observations ── */
  .obs-box {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px;
    min-height: 60px;
    font-size: 10pt;
    color: #1a1a2e;
    white-space: pre-wrap;
  }

  /* ── Signatures ── */
  .sig-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin-top: 8px;
  }
  .sig-block {
    border: 1.5px solid #e2e8f0;
    border-radius: 6px;
    padding: 14px;
    text-align: center;
    min-height: 100px;
  }
  .sig-label  { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; margin-bottom: 6px; }
  .sig-name   { font-size: 11pt; font-weight: 700; color: #1e3a5f; margin-bottom: 8px; }
  .sig-date   { font-size: 8.5pt; color: #64748b; font-style: italic; margin-bottom: 6px; }
  .sig-stamp  {
    display: inline-block;
    border: 2px solid #16a34a;
    color: #16a34a;
    font-weight: 700;
    font-size: 9pt;
    padding: 3px 10px;
    border-radius: 4px;
    letter-spacing: 0.5px;
  }
  .sig-pending { font-size: 9pt; color: #94a3b8; font-style: italic; margin-bottom: 8px; }
  .sig-line {
    border-bottom: 1px solid #94a3b8;
    width: 80%;
    margin: 0 auto;
    margin-top: 20px;
  }

  /* ── Misc ── */
  .empty { color: #94a3b8; font-style: italic; font-size: 9.5pt; padding: 8px 4px; }
  .page-break { page-break-after: always; }
  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 8pt;
    color: #94a3b8;
    text-align: center;
  }
  .legal-notice {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 8.5pt;
    color: #475569;
    margin-bottom: 16px;
    line-height: 1.6;
  }
</style>
</head>
<body>

<!-- EN-TÊTE -->
<div class="header">
  <div class="header-left">
    <div class="doc-type">${esc(typeLabel)}</div>
    <div class="doc-sub">Établi conformément à la loi ALUR du 27 mars 2014 et au décret du 30 mars 2016</div>
  </div>
  <div class="header-right">
    <div><strong>Date :</strong> ${today}</div>
    <div class="ref">Réf. : ${esc(report.id?.slice(0, 8).toUpperCase())}</div>
  </div>
</div>

<!-- MENTION LÉGALE -->
<div class="legal-notice">
  Le présent état des lieux a été établi contradictoirement entre les parties désignées ci-dessous.
  Toute mention non renseignée est réputée satisfaisante au moment de l'établissement du document.
  Ce document fait partie intégrante du contrat de bail.
</div>

<!-- LOGEMENT -->
<div class="section">
  <div class="section-title">Désignation du logement</div>
  <div class="info-grid">
    <div class="info-row">
      <span class="info-label">Adresse :</span>
      <span class="info-value">${esc(snap.address)}${snap.apartmentNumber ? `, Apt. ${esc(snap.apartmentNumber)}` : ""}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Code postal / Ville :</span>
      <span class="info-value">${esc(snap.postalCode)} ${esc(snap.city)}</span>
    </div>
    ${snap.floor ? `<div class="info-row"><span class="info-label">Étage :</span><span class="info-value">${esc(String(snap.floor))}</span></div>` : ""}
    ${snap.surface ? `<div class="info-row"><span class="info-label">Surface :</span><span class="info-value">${snap.surface} m²</span></div>` : ""}
    ${snap.numberOfRooms ? `<div class="info-row"><span class="info-label">Nb de pièces :</span><span class="info-value">${snap.numberOfRooms}</span></div>` : ""}
    <div class="info-row">
      <span class="info-label">Type :</span>
      <span class="info-value">${esc(snap.propertyType)}</span>
    </div>
    <div class="info-row"><span class="info-label">Date création :</span><span class="info-value">${fmt(report.createdAt)}</span></div>
  </div>
</div>

<!-- PARTIES -->
<div class="section">
  <div class="section-title">Les parties</div>
  <div class="parties-grid">
    <div class="party">
      <div class="party-role">Bailleur</div>
      <div class="party-name">${esc(snap.landlordName)}</div>
      ${snap.landlordEmail ? `<div class="party-detail">${esc(snap.landlordEmail)}</div>` : ""}
    </div>
    <div class="party">
      <div class="party-role">Locataire</div>
      <div class="party-name">${esc(snap.tenantFirstName)} ${esc(snap.tenantLastName)}</div>
      ${snap.tenantEmail ? `<div class="party-detail">${esc(snap.tenantEmail)}</div>` : ""}
    </div>
  </div>
</div>

<!-- PIÈCES & ANNEXES -->
<div class="section">
  <div class="section-title">État des pièces et annexes</div>
  ${roomsHtml(rooms)}
</div>

<!-- COMPTEURS -->
<div class="section">
  <div class="section-title">Relevés de compteurs</div>
  ${metersHtml(report)}
</div>

<!-- CLÉS -->
<div class="section">
  <div class="section-title">Inventaire des clés et accès</div>
  ${keysHtml(report)}
</div>

<!-- ÉQUIPEMENTS -->
<div class="section">
  <div class="section-title">Équipements</div>
  ${equipmentHtml(report)}
</div>

<!-- OBSERVATIONS GÉNÉRALES -->
<div class="section">
  <div class="section-title">Observations générales</div>
  <div class="obs-box">${esc(report.generalObservations) || "<em style='color:#94a3b8'>Aucune observation</em>"}</div>
</div>

<!-- SIGNATURES -->
<div class="section">
  <div class="section-title">Signatures des parties</div>
  <div class="sig-row">
    ${sigBlock("Bailleur", snap.landlordName, report.signatures?.landlord)}
    ${sigBlock("Locataire", `${snap.tenantFirstName} ${snap.tenantLastName}`, report.signatures?.tenant)}
  </div>
</div>

<!-- PIED DE PAGE -->
<div class="footer">
  Document généré par <strong>Maintena</strong> · ${fmtDt(new Date().toISOString())} ·
  Référence rapport : ${esc(report.id)}
</div>

</body>
</html>`;
}
