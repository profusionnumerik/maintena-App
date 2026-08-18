/**
 * lib/inventoryStorage.ts
 * Upload / suppression des photos d'états des lieux avec :
 *  - Compression JPEG 1200px / 75% avant upload
 *  - Tracking usage dans users/{uid}.storageInventoryBytes
 *  - Vérification quota selon plan d'abonnement
 */

import * as ImageManipulator from "expo-image-manipulator";
import { Platform } from "react-native";
import {
  deleteObject, getDownloadURL, ref, uploadBytes,
} from "firebase/storage";
import {
  doc, getDoc, increment, updateDoc,
} from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import {
  PLAN_STORAGE_BYTES, STORAGE_BYTES_FREE,
  SubscriptionPlan, PhotoRecord,
} from "@/shared/types";

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAX_WIDTH    = 1200;
const JPEG_QUALITY = 0.75;

// ─── Helpers internes ─────────────────────────────────────────────────────────

function makeFileName(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
}

async function compressToBlob(uri: string): Promise<Blob> {
  if (Platform.OS === "web") {
    const r = await fetch(uri);
    return r.blob();
  }
  const { uri: compressed } = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG }
  );
  const r = await fetch(compressed);
  return r.blob();
}

// ─── Quota ────────────────────────────────────────────────────────────────────

export function getStorageQuota(plan?: SubscriptionPlan | null): number {
  if (!plan) return STORAGE_BYTES_FREE;
  return PLAN_STORAGE_BYTES[plan] ?? STORAGE_BYTES_FREE;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** Lit le stockage utilisé depuis Firestore. Retourne 0 si pas encore renseigné. */
export async function getStorageUsed(uid: string): Promise<number> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return 0;
  return (snap.data().storageInventoryBytes as number) ?? 0;
}

/**
 * Vérifie si l'upload est possible.
 * Lève une erreur avec message lisible si quota dépassé.
 */
async function assertQuota(uid: string, plan: SubscriptionPlan | undefined, blobSize: number) {
  const quota = getStorageQuota(plan);
  const used  = await getStorageUsed(uid);
  if (used + blobSize > quota) {
    const pct = Math.round((used / quota) * 100);
    throw new Error(
      `Stockage plein (${pct}% utilisé — quota ${formatBytes(quota)}).\n` +
      `Supprimez des photos ou passez au plan supérieur.`
    );
  }
}

async function trackUsage(uid: string, deltaBytes: number) {
  try {
    await updateDoc(doc(db, "users", uid), {
      storageInventoryBytes: increment(deltaBytes),
    });
  } catch {
    // Silencieux — ne bloque pas l'UI
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface UploadInventoryPhotoOptions {
  propertyId: string;
  reportId:   string;
  /** "room" | "item-{itemId}" */
  target:     string;
  localUri:   string;
  uid:        string;
  plan?:      SubscriptionPlan;
  caption?:   string;
}

export async function uploadInventoryPhoto(
  opts: UploadInventoryPhotoOptions
): Promise<PhotoRecord> {
  const { propertyId, reportId, target, localUri, uid, plan, caption } = opts;

  // 1. Compression
  const blob = await compressToBlob(localUri);
  const size  = blob.size;

  // 2. Vérification quota
  await assertQuota(uid, plan, size);

  // 3. Upload Firebase Storage
  const fileName = makeFileName();
  const path     = `properties/${propertyId}/inventory/reports/${reportId}/${target}/${fileName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(storageRef);

  // 4. Mise à jour compteur usage
  await trackUsage(uid, size);

  return { url, caption, takenAt: new Date().toISOString() };
}

// ─── Suppression ──────────────────────────────────────────────────────────────

/**
 * Supprime une photo du Storage Firebase et décrémente le compteur.
 * `url` doit être une URL Firebase Storage (gs:// ou https://firebasestorage.googleapis.com).
 * `estimatedBytes` facultatif — sert à corriger le compteur.
 */
export async function deleteInventoryPhoto(
  url: string,
  uid: string,
  estimatedBytes = 200 * 1024  // estimation conservative : 200 Ko
): Promise<void> {
  try {
    const fileRef = ref(storage, url);
    await deleteObject(fileRef);
    await trackUsage(uid, -estimatedBytes);
  } catch {
    // Silencieux — le doc Firestore sera nettoyé de toute façon
  }
}
