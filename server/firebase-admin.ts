import admin from "firebase-admin";

let app: admin.app.App;

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT manquant.");
  }

  const serviceAccount = JSON.parse(raw);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket:
      process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
      serviceAccount.project_id + ".appspot.com",
  });
} else {
  app = admin.app();
}

const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage();

export { admin, app, db, auth, storage };