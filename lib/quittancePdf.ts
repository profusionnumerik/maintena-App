/**
 * Génération HTML d'une quittance de loyer au format légal français
 */

export interface QuittanceData {
  // Bailleur
  landlordName:    string;
  landlordAddress: string;
  landlordEmail?:  string;
  landlordPhone?:  string;
  // Locataire
  tenantName:      string;
  tenantEmail?:    string;
  // Logement
  propertyAddress: string;
  propertyCity:    string;
  propertyPostal:  string;
  surface?:        number;
  // Période
  period:          string;   // "2026-08"
  paymentDate:     string;   // "15/08/2026"
  // Montants
  rentAmount:      number;   // loyer HC
  chargesAmount:   number;   // charges
  // Identifiant
  quittanceNumber: string;   // "QUI-202608-001"
}

function formatMoney(amount: number): string {
  return amount.toFixed(2).replace(".", ",") + " €";
}

function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export function generateQuittanceHtml(data: QuittanceData): string {
  const total = data.rentAmount + data.chargesAmount;
  const today = new Date().toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    color: #1a1a1a;
    background: #fff;
    padding: 40px;
    max-width: 700px;
    margin: 0 auto;
  }
  h1 {
    font-size: 20pt;
    font-weight: bold;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin-bottom: 4px;
    color: #1a1a1a;
  }
  .subtitle {
    text-align: center;
    font-size: 12pt;
    color: #444;
    margin-bottom: 24px;
  }
  hr { border: none; border-top: 2px solid #1a1a1a; margin: 20px 0; }
  hr.thin { border-top-width: 1px; border-color: #ccc; margin: 12px 0; }
  .ref { text-align: right; font-size: 9pt; color: #666; margin-bottom: 24px; }
  .parties {
    display: flex;
    gap: 40px;
    margin-bottom: 24px;
  }
  .party { flex: 1; }
  .party-title {
    font-size: 9pt;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #666;
    margin-bottom: 6px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
  }
  .party-name { font-size: 13pt; font-weight: bold; margin-bottom: 4px; }
  .party-detail { font-size: 10pt; color: #333; line-height: 1.6; }
  .logement {
    background: #f8f8f8;
    border-left: 4px solid #333;
    padding: 14px 16px;
    margin-bottom: 24px;
    border-radius: 0 6px 6px 0;
  }
  .logement-title { font-weight: bold; margin-bottom: 4px; font-size: 11pt; }
  .logement-addr { font-size: 11pt; color: #333; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  thead tr {
    background: #1a1a1a;
    color: #fff;
  }
  thead th {
    padding: 8px 12px;
    text-align: left;
    font-size: 10pt;
    font-weight: bold;
    letter-spacing: 0.5px;
  }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody td {
    padding: 8px 12px;
    font-size: 11pt;
    border-bottom: 1px solid #eee;
  }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .total-row td {
    font-size: 12pt;
    font-weight: bold;
    background: #f0f0f0 !important;
    border-top: 2px solid #333;
  }
  .attestation {
    font-size: 11pt;
    line-height: 1.8;
    margin: 20px 0;
    padding: 16px;
    border: 1px solid #ccc;
    border-radius: 6px;
    background: #fcfcfc;
  }
  .signature-block {
    display: flex;
    justify-content: flex-end;
    margin-top: 30px;
  }
  .signature-box {
    text-align: center;
    width: 240px;
  }
  .sig-title { font-size: 10pt; color: #666; margin-bottom: 8px; }
  .sig-name { font-size: 11pt; font-weight: bold; margin-bottom: 40px; }
  .sig-line {
    border-top: 1px solid #999;
    margin-top: 4px;
    padding-top: 4px;
    font-size: 9pt;
    color: #666;
  }
  .footer {
    margin-top: 40px;
    padding-top: 12px;
    border-top: 1px solid #ddd;
    font-size: 8pt;
    color: #888;
    text-align: center;
    line-height: 1.6;
  }
</style>
</head>
<body>

<h1>Quittance de Loyer</h1>
<p class="subtitle">${periodLabel(data.period)}</p>
<hr/>

<p class="ref">N° ${data.quittanceNumber} · Émise le ${today}</p>

<div class="parties">
  <div class="party">
    <div class="party-title">Bailleur</div>
    <div class="party-name">${data.landlordName}</div>
    <div class="party-detail">
      ${data.landlordAddress}${data.landlordEmail ? `<br/>${data.landlordEmail}` : ""}${data.landlordPhone ? `<br/>${data.landlordPhone}` : ""}
    </div>
  </div>
  <div class="party">
    <div class="party-title">Locataire</div>
    <div class="party-name">${data.tenantName}</div>
    ${data.tenantEmail ? `<div class="party-detail">${data.tenantEmail}</div>` : ""}
  </div>
</div>

<div class="logement">
  <div class="logement-title">Bien loué</div>
  <div class="logement-addr">
    ${data.propertyAddress}<br/>
    ${data.propertyPostal} ${data.propertyCity}
    ${data.surface ? `<br/>Surface : ${data.surface} m²` : ""}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Désignation</th>
      <th class="amount">Montant</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Loyer hors charges — ${periodLabel(data.period)}</td>
      <td class="amount">${formatMoney(data.rentAmount)}</td>
    </tr>
    <tr>
      <td>Provision sur charges</td>
      <td class="amount">${formatMoney(data.chargesAmount)}</td>
    </tr>
    <tr class="total-row">
      <td><strong>Total payé</strong></td>
      <td class="amount"><strong>${formatMoney(total)}</strong></td>
    </tr>
  </tbody>
</table>

<div class="attestation">
  Je soussigné(e) <strong>${data.landlordName}</strong>, bailleur, déclare avoir reçu de
  <strong>${data.tenantName}</strong>, locataire du logement situé au
  <strong>${data.propertyAddress}, ${data.propertyPostal} ${data.propertyCity}</strong>,
  la somme de <strong>${formatMoney(total)}</strong> (${formatMoney(data.rentAmount)} de loyer
  + ${formatMoney(data.chargesAmount)} de charges) en règlement du loyer du mois de
  <strong>${periodLabel(data.period)}</strong>, payé le <strong>${data.paymentDate}</strong>,
  et lui en donne quittance, sous réserve de tous droits.
</div>

<div class="signature-block">
  <div class="signature-box">
    <div class="sig-title">Signature du bailleur</div>
    <div class="sig-name">${data.landlordName}</div>
    <div class="sig-line">Lu et approuvé</div>
  </div>
</div>

<div class="footer">
  Cette quittance est établie conformément à l'article 21 de la loi n° 89-462 du 6 juillet 1989.<br/>
  Générée par Maintena · ${today}
</div>

</body>
</html>`;
}
