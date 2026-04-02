import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { CoPro, Intervention, CATEGORY_LABELS, STATUS_LABELS, Category } from "@/shared/types";
import { COLORS } from "@/constants/colors";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function starsHtml(rating?: number): string {
  if (!rating) return '<span style="color:#94a3b8">—</span>';
  const filled = "★".repeat(rating);
  const empty = "☆".repeat(4 - rating);
  return `<span style="color:#f59e0b;font-size:14px">${filled}${empty}</span>`;
}

function statusBadge(status: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    planifie: { bg: "#FFF3CD", text: "#92400E" },
    en_cours: { bg: "#DBEAFE", text: "#1E40AF" },
    termine: { bg: "#D1FAE5", text: "#065F46" },
  };
  const c = colors[status] || { bg: "#F3F4F6", text: "#374151" };
  const label = STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status;
  return `<span style="background:${c.bg};color:${c.text};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">${label}</span>`;
}

function categoryBadge(cat: string): string {
  const label = CATEGORY_LABELS[cat as Category] ?? cat;
  return `<span style="background:#EFF6FF;color:#2563EB;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600">${label}</span>`;
}

export async function generateAnnualReport(
  copro: CoPro,
  interventions: Intervention[],
  year: number
): Promise<void> {
  const filtered = interventions.filter(
    (i) => new Date(i.date).getFullYear() === year
  );

  const totalDone = filtered.filter((i) => i.status === "termine").length;
  const rated = filtered.filter((i) => i.rating != null);
  const avgRating =
    rated.length > 0
      ? (rated.reduce((s, i) => s + (i.rating ?? 0), 0) / rated.length).toFixed(1)
      : "—";

  const byCategory: Record<string, Intervention[]> = {};
  for (const i of filtered) {
    if (!byCategory[i.category]) byCategory[i.category] = [];
    byCategory[i.category].push(i);
  }

  const categorySections = Object.entries(byCategory)
    .map(([cat, items]) => {
      const rows = items
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(
          (i) => `
          <tr>
            <td>${formatDate(i.date)}</td>
            <td style="font-weight:500">${i.title}</td>
            <td>${i.technician ?? "—"}</td>
            <td>${statusBadge(i.status)}</td>
            <td>${starsHtml(i.rating)}</td>
          </tr>`
        )
        .join("");

      return `
        <div class="category-section">
          <h3>${CATEGORY_LABELS[cat as Category] ?? cat} <span class="count">${items.length} intervention${items.length > 1 ? "s" : ""}</span></h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Intervention</th>
                <th>Prestataire</th>
                <th>Statut</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; color: #1e293b; font-size: 13px; padding: 32px; }
    .header { background: linear-gradient(135deg, #0b1628, #142240); color: white; padding: 28px 32px; border-radius: 12px; margin-bottom: 28px; }
    .header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: rgba(255,255,255,0.6); margin-top: 6px; font-size: 13px; }
    .header .year { font-size: 48px; font-weight: 800; color: rgba(255,255,255,0.15); position: absolute; right: 32px; top: 20px; }
    .header-inner { position: relative; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 28px; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f4; border-radius: 10px; padding: 16px; text-align: center; }
    .stat-card .val { font-size: 28px; font-weight: 700; color: #0b1628; }
    .stat-card .label { font-size: 11px; color: #64748b; margin-top: 4px; }
    .category-section { margin-bottom: 24px; }
    .category-section h3 { font-size: 15px; font-weight: 700; color: #0b1628; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 2px solid #e2e8f4; }
    .category-section h3 .count { font-size: 11px; font-weight: 500; color: #64748b; margin-left: 8px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f1f5f9; text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.4px; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .footer { margin-top: 32px; text-align: center; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f4; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-inner">
      <div class="year">${year}</div>
      <h1>${copro.name}</h1>
      <p>${copro.address ?? ""}</p>
      <p style="margin-top:8px">Rapport annuel AG · Exercice ${year} · Généré le ${new Date().toLocaleDateString("fr-FR")}</p>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="val">${filtered.length}</div>
      <div class="label">Total interventions</div>
    </div>
    <div class="stat-card">
      <div class="val">${totalDone}</div>
      <div class="label">Terminées</div>
    </div>
    <div class="stat-card">
      <div class="val">${Object.keys(byCategory).length}</div>
      <div class="label">Catégories</div>
    </div>
    <div class="stat-card">
      <div class="val">${avgRating}${avgRating !== "—" ? "/4" : ""}</div>
      <div class="label">Note moyenne</div>
    </div>
  </div>

  ${categorySections.length > 0 ? categorySections : '<p style="color:#94a3b8;text-align:center;padding:40px">Aucune intervention pour cette année.</p>'}

  <div class="footer">
    Maintena · Rapport généré automatiquement · ${copro.name} · ${year}
  </div>
</body>
</html>`;

  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: `Rapport AG ${year} — ${copro.name}`,
    UTI: "com.adobe.pdf",
  });
}
