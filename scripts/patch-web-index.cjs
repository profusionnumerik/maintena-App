#!/usr/bin/env node
/**
 * scripts/patch-web-index.js
 * Patche l'index.html généré par `npx expo export` pour ajouter :
 *  - lang="fr" sur <html>
 *  - <title> locatif
 *  - meta description + Open Graph
 */
const fs = require("fs");
const path = require("path");

const filePath = path.resolve(process.cwd(), "static-build", "index.html");

if (!fs.existsSync(filePath)) {
  console.log("[patch-web-index] index.html introuvable — skip");
  process.exit(0);
}

let html = fs.readFileSync(filePath, "utf8");

// lang
html = html.replace('<html lang="en">', '<html lang="fr">');

// title
html = html.replace(
  "<title>Maintena</title>",
  "<title>Maintena — Copropriétés &amp; Gestion locative</title>"
);

// meta tags à injecter avant </head>
const metas = [
  '<meta name="description" content="Maintena gère vos copropriétés ET votre parc locatif : suivi des interventions, états des lieux, quittances de loyer, signalements locataires. Essai gratuit 30 jours." />',
  '<meta property="og:title" content="Maintena — Copropriétés &amp; Gestion locative" />',
  '<meta property="og:description" content="Gérez vos copropriétés et vos locations en un seul endroit. Interventions, états des lieux, quittances, signalements locataires." />',
  '<meta property="og:type" content="website" />',
  '<meta property="og:url" content="https://maintena-pro.fr" />',
  '<meta name="twitter:card" content="summary" />',
].join("\n  ");

// Insérer avant le premier <link ou </head>
if (html.includes('<link rel="icon"')) {
  html = html.replace('<link rel="icon"', metas + "\n  " + '<link rel="icon"');
} else {
  html = html.replace("</head>", metas + "\n</head>");
}

fs.writeFileSync(filePath, html, "utf8");
console.log("[patch-web-index] index.html patché OK");
