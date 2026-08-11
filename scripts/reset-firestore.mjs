import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { readFileSync } from "fs";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const COLLECTIONS = [
  "users",
  "copros",
  "members",
  "interventions",
  "announcements",
  "polls",
  "signalements",
  "inviteCodes",
  "guestInterventionInvites",
  "accountDeletionRequests",
];

async function deleteCollection(colName) {
  const snap = await db.collection(colName).get();
  if (snap.empty) {
    console.log(`  ${colName}: vide (0 documents)`);
    return 0;
  }
  const batches = [];
  let batch = db.batch();
  let count = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count++;
    if (count % 500 === 0) {
      batches.push(batch.commit());
      batch = db.batch();
    }
  }
  batches.push(batch.commit());
  await Promise.all(batches);
  console.log(`  ${colName}: ${count} document(s) supprimé(s)`);
  return count;
}

async function deleteAllAuthUsers() {
  const auth = getAuth();
  let total = 0;
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    if (result.users.length > 0) {
      const uids = result.users.map((u) => u.uid);
      await auth.deleteUsers(uids);
      total += uids.length;
    }
    pageToken = result.pageToken;
  } while (pageToken);
  console.log(`  auth: ${total} compte(s) supprimé(s)`);
  return total;
}

console.log("=== RESET COMPLET (Firestore + Auth) ===");
console.log("");

let total = 0;
for (const col of COLLECTIONS) {
  total += await deleteCollection(col);
}

console.log("");
console.log("Suppression des comptes Firebase Auth...");
total += await deleteAllAuthUsers();

console.log("");
console.log(`✅ Terminé — ${total} éléments supprimés au total.`);
process.exit(0);
