/**
 * Script admin — Activer un plan bailleur
 *
 * Usage :
 *   node scripts/set-plan.mjs <email> <plan>
 *
 * Plans disponibles : free | starter | pro | business
 *
 * Exemple :
 *   node scripts/set-plan.mjs jean.dupont@gmail.com starter
 *   node scripts/set-plan.mjs marie.martin@gmail.com pro
 *   node scripts/set-plan.mjs agence@exemple.fr business
 *   node scripts/set-plan.mjs dupont@gmail.com free   ← pour repasser gratuit
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore }        from "firebase-admin/firestore";
import { getAuth }             from "firebase-admin/auth";
import { readFileSync }        from "fs";
import { config }              from "dotenv";

config(); // charge .env

// ── Initialisation Firebase Admin ─────────────────────────────────────────────
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT ??
  readFileSync("./firebase-service-account.json", "utf8")
);
initializeApp({ credential: cert(serviceAccount) });
const db   = getFirestore();
const auth = getAuth();

// ── Validation des arguments ──────────────────────────────────────────────────
const VALID_PLANS = ["free", "starter", "pro", "business"];
const [,, email, plan] = process.argv;

if (!email || !plan) {
  console.error("❌  Usage : node scripts/set-plan.mjs <email> <plan>");
  console.error("    Plans : free | starter | pro | business");
  process.exit(1);
}
if (!VALID_PLANS.includes(plan)) {
  console.error(`❌  Plan invalide : "${plan}". Choisis parmi : ${VALID_PLANS.join(", ")}`);
  process.exit(1);
}

// ── Mise à jour ───────────────────────────────────────────────────────────────
try {
  // 1. Trouver l'UID depuis l'email
  const userRecord = await auth.getUserByEmail(email);
  const uid = userRecord.uid;

  // 2. Mettre à jour rentalProfile.plan dans Firestore
  const userRef = db.collection("users").doc(uid);
  await userRef.set(
    { rentalProfile: { plan } },
    { merge: true }
  );

  // 3. Confirmation
  const LABELS = {
    free:     "Gratuit (0€)",
    starter:  "Starter (4,99€/mois)",
    pro:      "Pro (14,99€/mois)",
    business: "Business (34,99€/mois)",
  };
  console.log(`\n✅  Plan mis à jour avec succès`);
  console.log(`   👤  ${email}  (uid: ${uid})`);
  console.log(`   📦  Plan : ${LABELS[plan]}`);
  console.log(`\n   L'app se met à jour en temps réel pour cet utilisateur.\n`);

} catch (err) {
  if (err.code === "auth/user-not-found") {
    console.error(`❌  Aucun compte trouvé pour "${email}"`);
  } else {
    console.error("❌  Erreur :", err.message);
  }
  process.exit(1);
}
