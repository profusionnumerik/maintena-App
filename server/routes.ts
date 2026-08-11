import { getAuth } from "firebase-admin/auth";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import multer from "multer";
import { getUncachableResendClient } from "./resend-client";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Inline depuis shared/types pour éviter les problèmes d'import dans le bundle esbuild
const CATEGORY_LABELS_SERVER: Record<string, string> = {
  nettoyage: "Nettoyage",
  ascenseur: "Ascenseur (maintenance)",
  portail: "Portail",
  parking: "Parking",
  vmc: "VMC",
  plomberie: "Plomberie",
  electricite: "Électricité",
  espaces_verts: "Espaces verts",
  chaufferie: "Chaufferie",
  video_surveillance: "Vidéo-surveillance",
  facade: "Façade",
  toiture: "Toiture",
  local_poubelle: "Local poubelles",
  piscine: "Piscine",
  interphone: "Interphone",
  desinfection: "Désinfection",
  divers: "Divers",
};

interface BuildingDef { name: string; floors: number; }
interface BuildingConfigServer {
  buildings?: BuildingDef[];
  buildingCount?: number;
  floorsPerBuilding?: number;
  hasElevator?: boolean;
  hasCellar?: boolean;
  hasParking?: boolean;
  hasBikeParking?: boolean;
  hasTrashRoom?: boolean;
  hasExteriorAccess?: boolean;
  customAreas?: string[];
}
interface CleaningAreaServer { id: string; label: string; group: string; }

const DEFAULT_BUILDING_CONFIG_SERVER: BuildingConfigServer = {
  buildings: [{ name: "Bâtiment", floors: 3 }],
  hasElevator: false, hasCellar: false, hasParking: false,
  hasBikeParking: false, hasTrashRoom: true, hasExteriorAccess: false,
  customAreas: [],
};

function generateCleaningAreasServer(config: BuildingConfigServer): CleaningAreaServer[] {
  const areas: CleaningAreaServer[] = [];
  let buildings: BuildingDef[];
  if (config.buildings && config.buildings.length > 0) {
    buildings = config.buildings;
  } else {
    const count = config.buildingCount ?? 1;
    const floors = config.floorsPerBuilding ?? 3;
    buildings = Array.from({ length: count }, (_, i) => ({
      name: count > 1 ? `Bâtiment ${String.fromCharCode(65 + i)}` : "Bâtiment",
      floors,
    }));
  }
  const multi = buildings.length > 1;
  areas.push({ id: "hall_principal", label: "Hall d'entrée principal", group: "Parties communes" });
  areas.push({ id: "boites_lettres", label: "Boîtes aux lettres", group: "Parties communes" });
  buildings.forEach((building, b) => {
    const group = multi ? building.name : "Espaces communs";
    const batId = multi ? `_bat${b + 1}` : "";
    const batSuffix = multi ? ` (${building.name})` : "";
    if (config.hasElevator) {
      areas.push({ id: `ascenseur_cabine${batId}`, label: `Cabine ascenseur${batSuffix}`, group });
      areas.push({ id: `ascenseur_portes${batId}`, label: `Portes palières ascenseur${batSuffix}`, group });
    }
    areas.push({ id: `escalier${batId}`, label: `Cage d'escalier${batSuffix}`, group });
    for (let f = 1; f <= building.floors; f++) {
      const ordinal = f === 1 ? "1er" : `${f}ème`;
      areas.push({ id: `palier${batId}_etage${f}`, label: `Palier ${ordinal} étage${batSuffix}`, group });
    }
  });
  const annexes = "Annexes";
  if (config.hasCellar) areas.push({ id: "cave_soussol", label: "Cave / Sous-sol", group: annexes });
  if (config.hasParking) areas.push({ id: "parking_voitures", label: "Parking voitures", group: annexes });
  if (config.hasBikeParking) areas.push({ id: "parking_velos", label: "Parking vélos", group: annexes });
  if (config.hasTrashRoom) areas.push({ id: "local_poubelles", label: "Local poubelles", group: annexes });
  if (config.hasExteriorAccess) areas.push({ id: "acces_exterieur", label: "Accès extérieur", group: annexes });
  (config.customAreas ?? []).forEach((area, idx) => {
    const trimmed = area.trim();
    if (trimmed) areas.push({ id: `custom_${idx}`, label: trimmed, group: "Personnalisé" });
  });
  return areas;
}

function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-02-25.clover",
  });
}

const PLAN_LIMITS: Record<string, number> = {
  benevole: 1,
  starter: 4,
  pro: 15,
  business: 30,
  trialing: 1,
};

function getPlanFromPriceId(priceId: string): string {
  if (priceId === (process.env.STRIPE_PRICE_ID_BENEVOLE ?? "")) return "benevole";
  if (priceId === (process.env.STRIPE_PRICE_ID_STARTER ?? "") || priceId === (process.env.STRIPE_PRICE_ID_STARTER_ANNUEL ?? "")) return "starter";
  if (priceId === (process.env.STRIPE_PRICE_ID_PRO ?? "") || priceId === (process.env.STRIPE_PRICE_ID_PRO_ANNUEL ?? "")) return "pro";
  if (priceId === (process.env.STRIPE_PRICE_ID_BUSINESS ?? "") || priceId === (process.env.STRIPE_PRICE_ID_BUSINESS_ANNUEL ?? "")) return "business";
  return "starter";
}

function getAdminDb() {
  if (getApps().length === 0) {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      console.warn("[Firebase Admin] FIREBASE_SERVICE_ACCOUNT non défini.");
      return null;
    }

    try {
      let serviceAccount: any = null;

      const raw = serviceAccountStr;
      const trimmed = raw.trim();

      const candidates: any[] = [
        trimmed,
        trimmed.replace(/\\n/g, "\n"),
        trimmed.replace(/^['"]|['"]$/g, ""),
        trimmed.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"),
        (() => {
          try {
            return JSON.parse(trimmed);
          } catch {
            return "";
          }
        })(),
        raw
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
          .trim(),
        raw
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
          .trim()
          .replace(/\\n/g, "\n"),
      ];

      for (const candidate of candidates) {
        if (!candidate) continue;

        if (typeof candidate === "object") {
          serviceAccount = candidate;
          break;
        }

        if (typeof candidate === "string") {
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object") {
              serviceAccount = parsed;
              if (parsed.type === "service_account") break;
            }
          } catch {}
        }
      }

      if (!serviceAccount || !serviceAccount.project_id) {
        console.error(
          "[Firebase Admin] Parsing échoué. Début du secret:",
          serviceAccountStr.substring(0, 80)
        );
        throw new Error("Service account invalide ou introuvable");
      }

      initializeApp({ credential: cert(serviceAccount) });
    } catch (e) {
      console.error("Firebase admin init error:", e);
      return null;
    }
  }

  try {
    return getFirestore();
  } catch {
    return null;
  }
}

function getAdminStorage() {
  getAdminDb();
  if (getApps().length === 0) return null;

  try {
    const bucket =
      process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
      "maintena-3a544.firebasestorage.app";
    return getStorage().bucket(bucket);
  } catch {
    return null;
  }
}

// Builds a Firebase Storage download URL without signed URLs (no extra IAM perms needed).
// Requires saving the file with firebaseStorageDownloadTokens in custom metadata.
function makeFirebaseStorageUrl(bucketName: string, storagePath: string, downloadToken: string): string {
  const encodedPath = encodeURIComponent(storagePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;
}

function generateDownloadToken(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}


function getAdminAuthInstance() {
  getAdminDb();
  if (getApps().length === 0) return null;

  try {
    return getAuth();
  } catch {
    return null;
  }
}

const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --blue: #2563EB; --blue-dark: #1E40AF; --navy: #0B1628;
    --text: #0f172a; --muted: #64748b; --border: #e2e8f0;
    --bg: #f8fafc; --white: #fff;
    --shadow: 0 8px 30px rgba(15,23,42,.08);
    --radius: 18px;
  }
  html { scroll-behavior: smooth; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
  a { color: inherit; text-decoration: none; }
  .m-nav {
    position: sticky; top: 0; z-index: 100;
    background: rgba(11,22,40,0.97); backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    padding: 0 32px; height: 64px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .m-nav-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
  .m-nav-brand img { width: 38px; height: 38px; border-radius: 10px; object-fit: contain; }
  .m-nav-brand span { color: white; font-weight: 700; font-size: 17px; }
  .m-nav-back { color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 500; transition: color .2s; }
  .m-nav-back:hover { color: white; }
  .m-footer {
    margin-top: 60px; padding: 28px 32px; text-align: center;
    font-size: 13px; color: var(--muted);
    border-top: 1px solid var(--border);
  }
  .m-footer a { color: var(--muted); }
  .m-footer a:hover { color: var(--blue); }
  .m-container { max-width: 680px; margin: 48px auto; padding: 0 24px; }
  .m-card { background: var(--white); border-radius: var(--radius); padding: 36px; box-shadow: var(--shadow); }
  .m-card h1 { font-size: clamp(1.4rem, 3vw, 1.8rem); font-weight: 800; color: var(--navy); margin-bottom: 8px; }
  .m-card .subtitle { color: var(--muted); margin-bottom: 28px; font-size: 15px; }
  .m-label { display: block; font-weight: 600; font-size: 14px; color: var(--text); margin: 16px 0 6px; }
  .m-input {
    width: 100%; padding: 12px 14px; border: 1.5px solid var(--border);
    border-radius: 12px; font-size: 15px; font-family: inherit;
    transition: border-color .2s; outline: none;
  }
  .m-input:focus { border-color: var(--blue); }
  .m-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .m-btn {
    display: block; width: 100%; margin-top: 24px;
    background: var(--blue); color: white; border: none;
    border-radius: 12px; padding: 15px; font-size: 1rem;
    font-weight: 700; cursor: pointer; font-family: inherit;
    transition: background .2s, transform .15s;
  }
  .m-btn:hover { background: var(--blue-dark); transform: translateY(-1px); }
  .m-error { display: none; margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #fee2e2; color: #991b1b; font-size: 14px; }
  .m-success { display: none; margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #dcfce7; color: #166534; font-size: 14px; }
  @media (max-width: 600px) { .m-row { grid-template-columns: 1fr; } .m-nav { padding: 0 16px; } .m-card { padding: 24px; } }
`;

function pageShell(title: string, body: string, backLabel = "← Retour à l'accueil", backHref = "/", footerHtml?: string) {
  const footer = footerHtml ?? `<p>© 2026 ProFusion Numérik · SIREN 932 117 500 · <a href="tel:0668183092">06 68 18 30 92</a> · <a href="mailto:contact@profusionnumerik.com">contact@profusionnumerik.com</a> · <a href="/privacy-policy">Confidentialité</a></p>`;
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title} — Maintena</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <nav class="m-nav">
    <a href="/" class="m-nav-brand">
      <img src="/icon.png" alt="Maintena" />
      <span>Maintena</span>
    </a>
    <a href="${backHref}" class="m-nav-back">${backLabel}</a>
  </nav>
  ${body}
  <footer class="m-footer">
    ${footer}
  </footer>
</body>
</html>`;
}

async function extractAuthenticatedUser(req: Request) {
  const authHeader = req.header("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  const adminAuth = getAdminAuthInstance();
  if (!adminAuth) return null;

  try {
    return await adminAuth.verifyIdToken(match[1]);
  } catch {
    return null;
  }
}

async function deleteUserData(uid: string) {
  const db = getAdminDb();
  const adminAuth = getAdminAuthInstance();
  if (!db || !adminAuth) throw new Error("Firebase Admin indisponible");

  const batch = db.batch();
  batch.delete(db.collection("users").doc(uid));

  const coprosSnap = await db.collection("copros").get();
  for (const coproDoc of coprosSnap.docs) {
    const members = await db
      .collection("copros")
      .doc(coproDoc.id)
      .collection("members")
      .where("uid", "==", uid)
      .get();

    members.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  }

  await batch.commit();
  await adminAuth.deleteUser(uid);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateGuestToken(): string {
  return randomBytes(32).toString("hex");
}

function generateInviteCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function createUniqueInviteCode(
  db: FirebaseFirestore.Firestore
): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateInviteCode(6);
    const snap = await db.collection("inviteCodes").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new Error("Impossible de générer un code d'invitation unique.");
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBaseUrl(req: Request): string {
  if (process.env.APP_WEB_BASE_URL) {
    return process.env.APP_WEB_BASE_URL.replace(/\/+$/, "");
  }

  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN.replace(
      /^https?:\/\//,
      ""
    ).replace(/\/+$/, "")}`;
  }

  return `${req.protocol}://${req.get("host")}`;
}

function getAppDownloadUrl(): string {
  return (
    process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL ||
    process.env.APP_WEB_BASE_URL ||
    ""
  );
}

async function getGuestInviteByToken(token: string) {
  const db = getAdminDb();
  if (!db) return null;

  const tokenHash = sha256(token);
  const snap = await db
    .collection("guestInterventionInvites")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() as any };
}

async function createGuestInviteRecord(params: {
  coProId: string;
  interventionId: string;
  providerFirstName?: string;
  providerLastName?: string;
  providerName?: string;
  providerEmail: string;
  providerPhone?: string;
  providerCompany?: string;
  categoryInviteCode?: string;
  req: Request;
}) {
  const db = getAdminDb();
  if (!db) {
    throw new Error("Firebase Admin n'est pas configuré.");
  }

  const token = generateGuestToken();
  const tokenHash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Code d'activation personnel, usage unique, 8 caractères sans ambiguïté visuelle
  const activationChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const activationCode = Array.from(
    { length: 8 },
    () => activationChars[Math.floor(Math.random() * activationChars.length)]
  ).join("");

  const baseUrl = getBaseUrl(params.req);
  const webLink = `${baseUrl}/guest-intervention/${token}`;
  const completeAccountLink = `${baseUrl}/guest-complete-account/${token}`;

  const docRef = await db.collection("guestInterventionInvites").add({
    tokenHash,
    tokenPreview: `${token.slice(0, 8)}…`,
    coProId: params.coProId,
    interventionId: params.interventionId,
    providerFirstName: params.providerFirstName ?? "",
    providerLastName: params.providerLastName ?? "",
    providerName:
      params.providerName ??
      [params.providerFirstName, params.providerLastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
    providerEmail: params.providerEmail.toLowerCase(),
    providerPhone: params.providerPhone ?? "",
    providerCompany: params.providerCompany ?? "",
    categoryInviteCode: params.categoryInviteCode ?? null,
    activationCode,
    activationCodeUsed: false,
    status: "sent",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    webLink,
    completeAccountLink,
  });

  return {
    inviteId: docRef.id,
    token,
    activationCode,
    webLink,
    completeAccountLink,
    appLink: getAppDownloadUrl(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function buildGuestInterventionPayload(token: string) {
  const invite = await getGuestInviteByToken(token);
  if (!invite) {
    return { error: "Lien invalide ou introuvable.", status: 404 as const };
  }

  const expiresAtRaw = invite.data.expiresAt;
  const expiresAt = expiresAtRaw?.toDate
    ? expiresAtRaw.toDate()
    : new Date(expiresAtRaw);

  if (
    expiresAt &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() < Date.now()
  ) {
    return { error: "Ce lien a expiré.", status: 410 as const };
  }

  const db = getAdminDb();
  if (!db) {
    return { error: "Base de données indisponible.", status: 503 as const };
  }

  const interventionRef = db
    .collection("copros")
    .doc(invite.data.coProId)
    .collection("interventions")
    .doc(invite.data.interventionId);

  const interventionSnap = await interventionRef.get();

  if (!interventionSnap.exists) {
    return { error: "Intervention introuvable.", status: 404 as const };
  }

  const intervention = interventionSnap.data() as any;
  const coproSnap = await db.collection("copros").doc(invite.data.coProId).get();
  const copro = coproSnap.exists ? (coproSnap.data() as any) : null;

  const providerName =
    invite.data.providerName ||
    [invite.data.providerFirstName, invite.data.providerLastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    invite.data.providerEmail ||
    "Intervenant";

  return {
    status: 200 as const,
    invite,
    interventionRef,
    intervention: {
      id: interventionSnap.id,
      title: intervention.title ?? "Intervention",
      description: intervention.description ?? "",
      category: intervention.category ?? "divers",
      status: intervention.status ?? "planifie",
      providerStatus: (intervention.providerStatus ?? "pending") as "pending" | "accepted" | "refused",
      date: intervention.date?.toDate
        ? intervention.date.toDate().toISOString()
        : intervention.date ?? null,
      completionComment: intervention.completionComment ?? "",
      interventionReport: intervention.interventionReport ?? "",
      interventionRemaining: intervention.interventionRemaining ?? "",
      photos: Array.isArray(intervention.photos) ? intervention.photos : [],
      completionPhotos: Array.isArray(intervention.completionPhotos)
        ? intervention.completionPhotos
        : [],
      cleaningChecklist: (intervention.cleaningChecklist && typeof intervention.cleaningChecklist === "object")
        ? intervention.cleaningChecklist as Record<string, boolean>
        : {} as Record<string, boolean>,
      guestUpdatedAt: intervention.guestUpdatedAt ?? null,
      recurrenceGroupId: intervention.recurrenceGroupId ?? null,
    },
    copro: {
      id: invite.data.coProId,
      name: copro?.name ?? "Copropriété",
      address:
        copro?.address ??
        [copro?.street, copro?.postalCode, copro?.city]
          .filter(Boolean)
          .join(", "),
      buildingConfig: (copro?.buildingConfig ?? null) as BuildingConfigServer | null,
      adminEmail: copro?.adminEmail ?? null,
    },
    provider: {
      firstName: invite.data.providerFirstName ?? "",
      lastName: invite.data.providerLastName ?? "",
      name: providerName,
      email: invite.data.providerEmail ?? "",
      phone: invite.data.providerPhone ?? "",
      company: invite.data.providerCompany ?? "",
    },
    links: {
      webLink: invite.data.webLink ?? "",
      completeAccountLink: invite.data.completeAccountLink ?? "",
      appLink: getAppDownloadUrl(),
    },
  };
}

async function sendActivationEmail(
  adminEmail: string,
  coProName: string,
  inviteCode: string
): Promise<void> {
  let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
  try {
    resendClient = await getUncachableResendClient();
  } catch (e) {
    console.warn("Resend not connected — email non envoyé:", e);
    return;
  }

  const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";

  await resendClient.client.emails.send({
    from: fromAddress,
    to: adminEmail,
    subject: `Votre copropriété "${coProName}" est activée !`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>

    <div style="padding:32px;">
      <div style="background:#D1FAE5;color:#065F46;font-size:13px;font-weight:600;
        padding:8px 16px;border-radius:20px;display:inline-block;margin-bottom:20px;">
        Copropriété activée
      </div>

      <h1 style="font-size:22px;font-weight:700;color:#0F172A;margin:0 0 12px;">
        Bienvenue sur Maintena !
      </h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Votre copropriété <strong>${escapeHtml(coProName)}</strong> est maintenant active.
        Partagez le code ci-dessous à vos prestataires pour qu'ils rejoignent votre espace.
      </p>

      <div style="background:#F8FAFC;border:2px dashed #CBD5E1;border-radius:14px;
        padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:600;color:#94A3B8;
          text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
          Code d'invitation
        </div>
        <div style="font-size:36px;font-weight:800;color:#0B1628;
          letter-spacing:8px;font-family:monospace;">
          ${escapeHtml(inviteCode)}
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:8px;">
          Partagez ce code à vos prestataires
        </div>
      </div>

      <div style="background:#EFF6FF;border-radius:12px;padding:16px;">
        <div style="font-size:13px;color:#1D4ED8;font-weight:600;margin-bottom:4px;">
          Comment inviter un prestataire ?
        </div>
        <div style="font-size:13px;color:#3B82F6;line-height:1.5;">
          Dans l'app Maintena → Créer un compte → "Rejoindre avec un code" → saisir <strong>${escapeHtml(
            inviteCode
          )}</strong>
        </div>
      </div>
    </div>

    <div style="padding:20px 32px;border-top:1px solid #F1F5F9;text-align:center;">
      <p style="font-size:12px;color:#94A3B8;margin:0;">
        Maintena — Gestion professionnelle de copropriété
      </p>
    </div>
  </div>
</body>
</html>
    `,
  });

  console.log(
    `Activation email sent to ${adminEmail} for copro "${coProName}" (code: ${inviteCode})`
  );
}

async function sendAdminNotification(params: {
  type: "trial" | "demo";
  displayName: string;
  email: string;
  coProName: string;
  demoExpiresInDays?: number | null;
}): Promise<void> {
  const adminEmail = process.env.EXPO_PUBLIC_SUPER_ADMIN_EMAIL;
  if (!adminEmail) return;
  let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
  try { resendClient = await getUncachableResendClient(); } catch { return; }
  const from = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
  const isDemo = params.type === "demo";
  const badge = isDemo
    ? `<span style="background:#EFF6FF;color:#2563EB;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">🔗 Accès Démo</span>`
    : `<span style="background:#D1FAE5;color:#065F46;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">✓ Essai 30 jours</span>`;
  const expiryLine = isDemo && params.demoExpiresInDays
    ? `<tr><td style="color:#94A3B8;padding:4px 0;font-size:13px;">Durée démo</td><td style="font-weight:600;color:#0F172A;font-size:13px;">${params.demoExpiresInDays} jours</td></tr>`
    : "";
  const now = new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
  await resendClient.client.emails.send({
    from,
    to: adminEmail,
    subject: `🆕 Nouvelle inscription — ${params.displayName}`,
    html: `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:480px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:24px 28px;">
      <div style="font-size:22px;font-weight:800;color:#fff;">Maintena</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">Notification admin</div>
    </div>
    <div style="padding:28px;">
      <div style="margin-bottom:16px;">${badge}</div>
      <h2 style="font-size:18px;font-weight:700;color:#0F172A;margin:0 0 16px;">Nouvelle inscription</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="color:#94A3B8;padding:4px 0;font-size:13px;">Nom</td><td style="font-weight:600;color:#0F172A;font-size:13px;">${escapeHtml(params.displayName)}</td></tr>
        <tr><td style="color:#94A3B8;padding:4px 0;font-size:13px;">Email</td><td style="font-weight:600;color:#0F172A;font-size:13px;">${escapeHtml(params.email)}</td></tr>
        <tr><td style="color:#94A3B8;padding:4px 0;font-size:13px;">Copropriété</td><td style="font-weight:600;color:#0F172A;font-size:13px;">${escapeHtml(params.coProName)}</td></tr>
        ${expiryLine}
        <tr><td style="color:#94A3B8;padding:4px 0;font-size:13px;">Date</td><td style="font-weight:600;color:#0F172A;font-size:13px;">${now}</td></tr>
      </table>
    </div>
  </div>
</body></html>`,
  });
}

async function sendGuestInviteEmail(params: {
  to: string;
  providerName: string;
  coproName: string;
  interventionTitle: string;
  interventionCategory?: string;
  interventionPhotos?: string[];
  webLink: string;
  completeAccountLink: string;
  activationCode?: string;
  tempPassword?: string;
  existingAccount?: boolean;
}): Promise<boolean> {
  let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
  try {
    resendClient = await getUncachableResendClient();
  } catch (e) {
    console.warn("Resend non disponible — email prestataire non envoyé:", e);
    return false;
  }

  const primaryFrom = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
  const fallbackFrom = "Maintena <onboarding@resend.dev>";

  const htmlBody = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:620px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:28px 32px 22px;">
      <div style="font-size:28px;font-weight:800;color:#fff;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:4px;">Gestion de copropriété</div>
    </div>

    <div style="padding:32px;">
      <div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;margin-bottom:18px;">
        Invitation prestataire
      </div>

      <h1 style="font-size:22px;color:#0F172A;margin:0 0 12px;">
        Bonjour ${escapeHtml(params.providerName)},
      </h1>

      <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 18px;">
        Vous avez été invité à compléter une fiche d'intervention pour la copropriété
        <strong>${escapeHtml(params.coproName)}</strong>.
      </p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:18px;margin-bottom:22px;">
        <div style="font-size:13px;color:#64748B;margin-bottom:6px;">Intervention</div>
        <div style="font-size:16px;color:#0F172A;font-weight:700;margin-bottom:${params.interventionCategory ? "8px" : "0"};">
          ${escapeHtml(params.interventionTitle)}
        </div>
        ${params.interventionCategory ? `<div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;">${escapeHtml(CATEGORY_LABELS_SERVER[params.interventionCategory] ?? params.interventionCategory)}</div>` : ""}
        ${params.interventionPhotos && params.interventionPhotos.length > 0 ? `
        <div style="margin-top:14px;">
          <div style="font-size:12px;color:#64748B;margin-bottom:8px;">Photos jointes</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${params.interventionPhotos.map(url =>
              `<a href="${url}" target="_blank" style="display:block;"><img src="${url}" alt="photo" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #E2E8F0;" /></a>`
            ).join("")}
          </div>
        </div>` : ""}
      </div>

      <p style="margin:0 0 20px;">
        <a href="${params.webLink}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:700;">
          Ouvrir la fiche d'intervention
        </a>
      </p>

      <p style="font-size:14px;color:#64748B;line-height:1.6;">
        Cliquez sur le bouton ci-dessus pour accéder à votre fiche directement, <strong>sans créer de compte</strong>.
      </p>

      ${params.existingAccount ? `
      <div style="background:#0B1628;border-radius:14px;padding:20px 24px;margin:20px 0;text-align:center;">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Vous avez déjà un compte Maintena</div>
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px;">Votre identifiant</div>
          <div style="font-size:15px;color:#fff;font-weight:600;">${escapeHtml(params.to)}</div>
        </div>
        <div style="font-size:13px;color:rgba(255,255,255,0.55);margin-top:8px;line-height:1.5;">Connectez-vous avec votre mot de passe habituel.<br/>Si vous l'avez oublié, utilisez "Mot de passe oublié" dans l'application.</div>
      </div>` : params.tempPassword ? `
      <div style="background:#0B1628;border-radius:14px;padding:20px 24px;margin:20px 0;text-align:center;">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Connexion à l'application Maintena</div>
        <div style="margin-bottom:10px;">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px;">Email</div>
          <div style="font-size:15px;color:#fff;font-weight:600;">${escapeHtml(params.to)}</div>
        </div>
        <div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:2px;">Mot de passe provisoire</div>
          <div style="font-size:26px;font-weight:800;color:#fff;letter-spacing:4px;font-family:monospace;">${escapeHtml(params.tempPassword)}</div>
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:10px;">Modifiez votre mot de passe après votre première connexion</div>
      </div>` : ""}

      ${params.activationCode ? `
      <div style="border:2px solid #059669;border-radius:14px;padding:20px 24px;margin:20px 0;text-align:center;background:#ECFDF5;">
        <div style="font-size:11px;color:#065F46;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">🔑 Votre code d'activation personnel</div>
        <div style="font-size:36px;font-weight:800;color:#065F46;letter-spacing:8px;font-family:monospace;margin:8px 0;">${escapeHtml(params.activationCode)}</div>
        <div style="font-size:13px;color:#047857;margin-top:10px;line-height:1.5;">
          Ce code est <strong>personnel et à usage unique</strong>. Entrez-le sur la page "Finaliser mon compte" pour créer votre espace Maintena.
        </div>
      </div>` : ""}

      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-top:12px;">
        Besoin d'aide ? Contactez votre syndic.
      </p>
    </div>
  </div>
</body>
</html>`;

  // Tentative avec l'adresse principale, fallback sur onboarding@resend.dev
  console.log(`[Maintena] Tentative envoi email à ${params.to} depuis ${primaryFrom}`);
  try {
    const result = await resendClient.client.emails.send({
      from: primaryFrom,
      to: params.to,
      subject: `Intervention Maintena - ${params.coproName}`,
      html: htmlBody,
    });
    console.log(`[Maintena] Email envoyé à ${params.to} — Resend response: ${JSON.stringify(result)}`);
    return true;
  } catch (primaryErr: any) {
    console.error(`[Maintena] Échec depuis ${primaryFrom}: ${primaryErr?.message ?? JSON.stringify(primaryErr)}`);
    if (primaryFrom === fallbackFrom) return false;
    console.log(`[Maintena] Tentative fallback depuis ${fallbackFrom}`);
    try {
      const result2 = await resendClient.client.emails.send({
        from: fallbackFrom,
        to: params.to,
        subject: `Intervention Maintena - ${params.coproName}`,
        html: htmlBody,
      });
      console.log(`[Maintena] Email envoyé via fallback — Resend response: ${JSON.stringify(result2)}`);
      return true;
    } catch (fallbackErr: any) {
      console.error(`[Maintena] Échec total envoi à ${params.to}: ${fallbackErr?.message ?? JSON.stringify(fallbackErr)}`);
      return false;
    }
  }
}

async function generateSignedDevisPdf(params: {
  offer: any;
  demande: any;
  coProData: any;
  coProId: string;
  demandeId: string;
  demandeRef: FirebaseFirestore.DocumentReference;
}): Promise<void> {
  const { offer, demande, coProData, coProId, demandeId, demandeRef } = params;

  const bucket = getAdminStorage();
  if (!bucket) return;

  try {
    console.log(`[pdf] Début génération BON DE COMMANDE pour ${coProId}/${demandeId}/${offer.id}`);
    const { PDFDocument, rgb, StandardFonts, PageSizes } = await import("pdf-lib");

    const pdfDoc  = await PDFDocument.create();
    const page    = pdfDoc.addPage(PageSizes.A4);
    const { width, height } = page.getSize(); // 595 × 842

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const dark   = rgb(0.06, 0.09, 0.16);
    const gray   = rgb(0.39, 0.45, 0.55);
    const lgray  = rgb(0.88, 0.90, 0.94);
    const white  = rgb(1, 1, 1);
    const purple = rgb(0.42, 0.27, 0.76);

    const M  = 50;        // marges gauche/droite
    const W  = width - 2 * M; // largeur utile : 495pt

    const fmtDate = (iso: string) =>
      new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const fmtMontant = (n: number) =>
      n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
    const trunc = (s: string, n: number) => (s?.length > n ? s.slice(0, n - 1) + "…" : s ?? "");

    // ── HEADER ──────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: height - 78, width, height: 78, color: purple });
    page.drawText("BON DE COMMANDE", {
      x: M, y: height - 44, size: 20, font: bold, color: white,
    });
    page.drawText("Maintena — Gestion de copropriété", {
      x: M, y: height - 62, size: 9, font: regular, color: rgb(0.85, 0.80, 0.95),
    });
    const signedAtStr = offer.adminSignedAt ?? new Date().toISOString();
    page.drawText(`Date : ${fmtDate(signedAtStr)}`, {
      x: width - M - 145, y: height - 44, size: 9, font: regular, color: white,
    });
    page.drawText(`Réf. : ${offer.id.slice(-10).toUpperCase()}`, {
      x: width - M - 145, y: height - 58, size: 9, font: regular, color: rgb(0.85, 0.80, 0.95),
    });

    // ── PARTIES ─────────────────────────────────────────────────────────
    const colW  = (W - 16) / 2;
    const colX2 = M + colW + 16;
    let y       = height - 78 - 22;

    // Colonne gauche : DONNEUR D'ORDRE
    page.drawText("DONNEUR D'ORDRE", { x: M, y, size: 8, font: bold, color: purple });
    y -= 14;
    page.drawText("Syndicat des copropriétaires de", { x: M, y, size: 9, font: regular, color: gray });
    y -= 13;
    page.drawText(trunc(coProData?.name ?? "", 44), { x: M, y, size: 10, font: bold, color: dark });
    y -= 13;
    const addressParts = [
      coProData?.street,
      [coProData?.postalCode, coProData?.city].filter(Boolean).join(" "),
    ].filter(Boolean);
    if (addressParts.length) {
      page.drawText(trunc(addressParts.join(", "), 50), { x: M, y, size: 9, font: regular, color: gray });
      y -= 13;
    }
    page.drawText(`Syndic : ${trunc(coProData?.adminEmail ?? "", 38)}`, {
      x: M, y, size: 9, font: regular, color: gray,
    });
    const yAfterLeft = y - 6;

    // Colonne droite : PRESTATAIRE
    let yR = height - 78 - 22;
    page.drawText("PRESTATAIRE", { x: colX2, y: yR, size: 8, font: bold, color: purple });
    yR -= 14;
    page.drawText(trunc(offer.contactCompany ?? "", 34), { x: colX2, y: yR, size: 10, font: bold, color: dark });
    yR -= 13;
    page.drawText(trunc(offer.contactName ?? "", 34), { x: colX2, y: yR, size: 9, font: regular, color: gray });
    yR -= 13;
    page.drawText(trunc(offer.contactEmail ?? "", 40), { x: colX2, y: yR, size: 9, font: regular, color: gray });
    const yAfterRight = yR - 6;

    // Séparateur après les deux colonnes
    y = Math.min(yAfterLeft, yAfterRight) - 14;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: lgray });

    // ── OBJET DE LA COMMANDE ─────────────────────────────────────────────
    y -= 18;
    page.drawText("OBJET DE LA COMMANDE", { x: M, y, size: 8, font: bold, color: purple });
    y -= 14;

    const objH = 72;
    page.drawRectangle({ x: M, y: y - objH, width: W, height: objH, color: rgb(0.97, 0.97, 0.99) });

    const catLabel = CATEGORY_LABELS_SERVER[demande?.category ?? ""] ?? (demande?.category ?? "");
    page.drawText(`Catégorie : ${catLabel}`, { x: M + 12, y: y - 14, size: 9, font: regular, color: gray });
    page.drawText(trunc(demande?.title ?? "", 64), { x: M + 12, y: y - 29, size: 11, font: bold, color: dark });

    const devisDate = offer.submittedAt ? fmtDate(offer.submittedAt) : "—";
    page.drawText(`Devis prestataire accepté du ${devisDate}`, {
      x: M + 12, y: y - 46, size: 9, font: regular, color: gray,
    });
    page.drawText("Le détail des prestations figure dans le devis du prestataire.", {
      x: M + 12, y: y - 60, size: 8, font: regular, color: gray,
    });

    y -= objH + 16;

    // ── MONTANT ──────────────────────────────────────────────────────────
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: lgray });
    y -= 18;

    const priceTTC   = offer.priceTTC ?? 0;
    const montantStr = `MONTANT TTC :  ${fmtMontant(priceTTC)}`;
    const montantW   = bold.widthOfTextAtSize(montantStr, 14);
    page.drawText(montantStr, { x: width - M - montantW, y, size: 14, font: bold, color: dark });
    y -= 11;
    page.drawText(
      "TVA selon taux applicable — se référer au devis du prestataire pour le détail HT/TVA",
      { x: M, y, size: 7, font: regular, color: gray },
    );
    y -= 28;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: lgray });

    // ── BON POUR ACCORD ──────────────────────────────────────────────────
    y -= 22;
    page.drawText("BON POUR ACCORD", { x: M, y, size: 14, font: bold, color: purple });
    y -= 15;
    page.drawText(
      "Le syndic, agissant au nom et pour le compte du syndicat des copropriétaires,",
      { x: M, y, size: 9, font: regular, color: gray },
    );
    y -= 13;
    page.drawText(
      "accepte le devis susmentionné dans les termes et conditions qui y figurent.",
      { x: M, y, size: 9, font: regular, color: gray },
    );
    y -= 22;

    // Boîte signature
    const sigBoxW = 230;
    const sigBoxH = 110;
    page.drawRectangle({
      x: M, y: y - sigBoxH, width: sigBoxW, height: sigBoxH,
      borderColor: lgray, borderWidth: 0.5, color: rgb(0.98, 0.98, 0.99),
    });

    // Convertir la signature SVG en PNG
    let adminSigImage: any = null;
    if (offer.adminSignatureUrl) {
      try {
        const { Resvg } = await import("@resvg/resvg-js");
        const r = await fetch(offer.adminSignatureUrl);
        if (r.ok) {
          const svgText = await r.text();
          const resvg = new Resvg(svgText, { background: "white" });
          adminSigImage = await pdfDoc.embedPng(resvg.render().asPng());
          console.log("[pdf] Signature syndic convertie en PNG");
        }
      } catch (e: any) {
        console.error("[pdf] Erreur SVG→PNG:", e?.message ?? e);
      }
    }

    if (adminSigImage) {
      const dims = adminSigImage.scaleToFit(sigBoxW - 20, sigBoxH - 20);
      page.drawImage(adminSigImage, {
        x: M + 10,
        y: y - sigBoxH + (sigBoxH - dims.height) / 2,
        width: dims.width,
        height: dims.height,
      });
    }

    page.drawText("Signature du syndic", { x: M, y: y - sigBoxH - 13, size: 8, font: regular, color: gray });
    page.drawText(`Le ${fmtDate(signedAtStr)}`, { x: M, y: y - sigBoxH - 25, size: 9, font: bold, color: dark });

    // ── PIED DE PAGE (infos légales du syndic) ───────────────────────────
    page.drawLine({
      start: { x: M, y: 46 }, end: { x: width - M, y: 46 },
      thickness: 0.3, color: lgray,
    });

    // Ligne 1 : nom de la société syndic (ou nom copro par défaut) + forme juridique
    const footerCompany = coProData?.syndicCompanyName
      ? trunc(coProData.syndicCompanyName, 70)
      : `Syndicat des copropriétaires de ${trunc(coProData?.name ?? "", 50)}`;
    const footerForm = coProData?.syndicLegalForm ? ` — ${coProData.syndicLegalForm}` : "";
    page.drawText(footerCompany + footerForm, {
      x: M, y: 34, size: 8, font: bold, color: dark,
    });

    // Ligne 2 : adresse + SIRET + téléphone
    const footerParts: string[] = [];
    const addr = [coProData?.street, [coProData?.postalCode, coProData?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (addr) footerParts.push(addr);
    if (coProData?.syndicSiret) footerParts.push(`SIRET : ${coProData.syndicSiret}`);
    if (coProData?.syndicPhone) footerParts.push(`Tél : ${coProData.syndicPhone}`);
    page.drawText(trunc(footerParts.join("  |  "), 95), {
      x: M, y: 22, size: 7, font: regular, color: gray,
    });

    // Mention outil (très discrète)
    page.drawText("Généré via Maintena — art. 1366 C. civ.", {
      x: width - M - 165, y: 22, size: 6, font: regular, color: lgray,
    });

    // ── UPLOAD ────────────────────────────────────────────────────────────
    const finalPdfBytes = await pdfDoc.save();
    const { randomBytes: rb } = await import("crypto");
    const dlToken     = rb(16).toString("hex");
    const storagePath = `devis/${coProId}/${demandeId}/${offer.id}_bon_commande.pdf`;
    await bucket.file(storagePath).save(Buffer.from(finalPdfBytes), {
      metadata: {
        contentType: "application/pdf",
        metadata: { firebaseStorageDownloadTokens: dlToken },
      },
    });
    const bucketName    = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
    const finalDevisUrl = makeFirebaseStorageUrl(bucketName, storagePath, dlToken);

    // Mettre à jour Firestore
    const snap = await demandeRef.get();
    if (snap.exists) {
      const devis: any[] = snap.data()!.devis ?? [];
      const i = devis.findIndex((o: any) => o.id === offer.id);
      if (i !== -1) {
        devis[i] = { ...devis[i], finalDevisUrl };
        await demandeRef.update({ devis });
        console.log(`[pdf] BON DE COMMANDE généré : ${storagePath}`);
      }
    }
  } catch (e: any) {
    console.error("[generateSignedDevisPdf] Erreur:", e?.message ?? e);
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Endpoint de diagnostic Resend — accessible uniquement depuis le back-office
  app.post("/api/test-email", async (req: Request, res: Response) => {
    const { to } = req.body as { to?: string };
    if (!to) return res.status(400).json({ error: "Champ 'to' requis." });

    let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
    try {
      resendClient = await getUncachableResendClient();
    } catch (e: any) {
      return res.status(503).json({ error: "Resend non initialisé", detail: e?.message });
    }

    const from = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
    try {
      const result = await resendClient.client.emails.send({
        from,
        to,
        subject: "[Maintena] Test envoi email",
        html: "<p>Test email Maintena. Si vous recevez ceci, Resend fonctionne correctement.</p>",
      });
      console.log("[Maintena] test-email success:", JSON.stringify(result));
      return res.json({ ok: true, from, to, result });
    } catch (err: any) {
      console.error("[Maintena] test-email error:", JSON.stringify(err));
      return res.status(500).json({ ok: false, from, to, error: err?.message, detail: err });
    }
  });


    app.post("/api/create-checkout-session", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        error:
          "Le paiement n'est pas encore configuré. Contactez l'administrateur pour activer votre copropriété manuellement.",
      });
    }

    const { coProId, userId, adminEmail, coProName, inviteCode, plan } = req.body as {
      coProId?: string;
      userId?: string;
      adminEmail?: string;
      coProName?: string;
      inviteCode?: string;
      plan?: string;
    };

    if (!coProId || !userId) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const selectedPlan = String(plan ?? "starter").trim().toLowerCase();
    const priceId =
      selectedPlan === "benevole"        ? (process.env.STRIPE_PRICE_ID_BENEVOLE        || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "starter-annuel"  ? (process.env.STRIPE_PRICE_ID_STARTER_ANNUEL  || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "pro-annuel"      ? (process.env.STRIPE_PRICE_ID_PRO_ANNUEL      || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "business-annuel" ? (process.env.STRIPE_PRICE_ID_BUSINESS_ANNUEL || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "pro"             ? (process.env.STRIPE_PRICE_ID_PRO             || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "business"        ? (process.env.STRIPE_PRICE_ID_BUSINESS        || process.env.STRIPE_PRICE_ID) :
                                           (process.env.STRIPE_PRICE_ID_STARTER         || process.env.STRIPE_PRICE_ID);
    if (!priceId) {
      return res.status(503).json({
        error: "Configuration Stripe incomplète (STRIPE_PRICE_ID manquant).",
      });
    }

    // Plan bénévole : 30 jours d'essai gratuit avec carte requise (anti-abus Stripe)
    const isBenevole = selectedPlan === "benevole";

    try {
      const baseUrl = getBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        payment_method_collection: isBenevole ? "always" : "if_required",
        customer_email: adminEmail ?? undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        ...(isBenevole ? {
          subscription_data: {
            trial_period_days: 30,
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
            metadata: { plan: selectedPlan },
          },
        } : {
          subscription_data: { metadata: { plan: selectedPlan } },
        }),
        metadata: {
          coProId,
          userId,
          adminEmail: adminEmail ?? "",
          coProName: coProName ?? "",
          inviteCode: inviteCode ?? "",
          plan: selectedPlan,
        },
        success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/payment-cancel`,
      });

      return res.json({ url: session.url });
    } catch (e: any) {
      console.error("Stripe checkout error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur Stripe" });
    }
  });

  app.post("/api/web-signup-checkout", async (req: Request, res: Response) => {
    const stripe = getStripe();
    const db = getAdminDb();

    if (!stripe) {
      return res.status(503).json({ error: "Stripe non configuré." });
    }

    if (!db) {
      return res.status(503).json({ error: "Firebase Admin non configuré." });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      coProName,
      address,
      postalCode,
      city,
      plan,
    } = req.body ?? {};

    if (
      !firstName ||
      !lastName ||
      !email ||
      !password ||
      !coProName ||
      !address ||
      !postalCode ||
      !city
    ) {
      return res.status(400).json({ error: "Champs obligatoires manquants." });
    }

    if (String(password).trim().length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit contenir au moins 6 caractères.",
      });
    }

    const selectedPlan = String(plan ?? "starter").trim().toLowerCase();
    const priceId =
      selectedPlan === "starter-annuel"  ? (process.env.STRIPE_PRICE_ID_STARTER_ANNUEL  || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "pro-annuel"      ? (process.env.STRIPE_PRICE_ID_PRO_ANNUEL      || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "business-annuel" ? (process.env.STRIPE_PRICE_ID_BUSINESS_ANNUEL || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "pro"             ? (process.env.STRIPE_PRICE_ID_PRO             || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "business"        ? (process.env.STRIPE_PRICE_ID_BUSINESS        || process.env.STRIPE_PRICE_ID) :
                                           (process.env.STRIPE_PRICE_ID_STARTER         || process.env.STRIPE_PRICE_ID);
    if (!priceId) {
      return res.status(503).json({
        error: "Configuration Stripe incomplète (STRIPE_PRICE_ID manquant).",
      });
    }

    try {
      const { getAuth } = await import("firebase-admin/auth");
      const adminAuth = getAuth();

      const normalizedEmail = String(email).trim().toLowerCase();
      const displayName = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();

      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(normalizedEmail);
      } catch {
        userRecord = await adminAuth.createUser({
          email: normalizedEmail,
          password: String(password).trim(),
          displayName,
        });
      }

      const userId = userRecord.uid;
      const inviteCode = await createUniqueInviteCode(db);
      const coProRef = db.collection("copros").doc();
      const now = new Date().toISOString();

      await db.collection("users").doc(userId).set(
        {
          uid: userId,
          email: normalizedEmail,
          displayName,
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          phone: String(phone ?? "").trim(),
          role: "admin",
          subscriptionStatus: "pending",
          createdAt: now,
          managedCoproIds: [coProRef.id],
        },
        { merge: true }
      );

      await coProRef.set({
        name: String(coProName).trim(),
        address: String(address).trim(),
        postalCode: String(postalCode).trim(),
        city: String(city).trim(),
        adminId: userId,
        adminEmail: normalizedEmail,
        inviteCode,
        status: "pending",
        stripePaid: false,
        createdAt: now,
      });

      await db
        .collection("copros")
        .doc(coProRef.id)
        .collection("members")
        .doc(userId)
        .set({
          uid: userId,
          email: normalizedEmail,
          displayName,
          role: "admin",
          joinedAt: now,
        });

      await db.collection("inviteCodes").doc(inviteCode).set({
        coProId: coProRef.id,
        coProName: String(coProName).trim(),
        role: "prestataire",
        createdAt: now,
      });

      const baseUrl = getBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: normalizedEmail,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: {
          userId,
          coProId: coProRef.id,
          adminEmail: normalizedEmail,
          coProName: String(coProName).trim(),
          inviteCode,
          plan: selectedPlan,
        },
        success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/payment-cancel`,
      });

      return res.json({
        ok: true,
        url: session.url,
        userId,
        coProId: coProRef.id,
        inviteCode,
      });
    } catch (e: any) {
      console.error("web-signup-checkout error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Inscription essai gratuit 30 jours (sans carte) ──────────────────────────
  app.post("/api/web-signup-trial", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase Admin non configuré." });

    const { firstName, lastName, email, phone, password, coProName, address, postalCode, city } = req.body ?? {};

    if (!firstName || !lastName || !email || !password || !coProName || !address || !postalCode || !city) {
      return res.status(400).json({ error: "Champs obligatoires manquants." });
    }
    if (String(password).trim().length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
    }

    try {
      const { getAuth } = await import("firebase-admin/auth");
      const adminAuth = getAuth();
      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedPhone = String(phone ?? "").trim();
      const displayName = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();

      if (normalizedPhone) {
        const phoneSnap = await db.collection("users").where("phone", "==", normalizedPhone).limit(1).get();
        if (!phoneSnap.empty) {
          return res.status(409).json({ error: "Un compte existe déjà avec ce numéro de téléphone." });
        }
      }

      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(normalizedEmail);
        return res.status(409).json({ error: "Un compte existe déjà avec cet email. Connectez-vous directement dans l'application." });
      } catch {
        userRecord = await adminAuth.createUser({
          email: normalizedEmail,
          password: String(password).trim(),
          displayName,
        });
      }

      const userId = userRecord.uid;
      const inviteCode = await createUniqueInviteCode(db);
      const coProRef = db.collection("copros").doc();
      const now = new Date().toISOString();
      const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

      // Vérifier si cet email a un accès démo pré-accordé
      const demoInviteSnap = await db.collection("demoInvites").doc(normalizedEmail).get();
      const demoInvite = demoInviteSnap.exists ? demoInviteSnap.data()! : null;
      const isDemo = !!demoInvite && (!demoInvite.expiresAt || new Date(demoInvite.expiresAt) > new Date());

      await db.collection("users").doc(userId).set({
        uid: userId,
        email: normalizedEmail,
        displayName,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        phone: String(phone ?? "").trim(),
        role: "admin",
        subscriptionStatus: isDemo ? "active" : "trialing",
        ...(isDemo ? {
          accessType: "demo",
          demoMaxCopros: demoInvite!.maxCopros,
          demoMaxMembersPerCopro: demoInvite!.maxMembersPerCopro,
          demoGrantedAt: demoInvite!.grantedAt,
          ...(demoInvite!.expiresAt ? { demoExpiresAt: demoInvite!.expiresAt } : {}),
        } : { trialEndsAt }),
        createdAt: now,
        managedCoproIds: [coProRef.id],
      }, { merge: true });

      await coProRef.set({
        name: String(coProName).trim(),
        address: String(address).trim(),
        postalCode: String(postalCode).trim(),
        city: String(city).trim(),
        adminId: userId,
        adminEmail: normalizedEmail,
        inviteCode,
        status: isDemo ? "active" : "pending",
        stripePaid: false,
        createdAt: now,
      });

      await db.collection("copros").doc(coProRef.id).collection("members").doc(userId).set({
        uid: userId,
        email: normalizedEmail,
        displayName,
        role: "admin",
        joinedAt: now,
      });

      await db.collection("inviteCodes").doc(inviteCode).set({
        coProId: coProRef.id,
        coProName: String(coProName).trim(),
        role: "prestataire",
        createdAt: now,
      });

      // Notification admin
      try {
        await sendAdminNotification({ type: "trial", displayName, email: normalizedEmail, coProName: String(coProName).trim() });
      } catch {}

      const baseUrl = getBaseUrl(req);
      return res.json({ ok: true, redirectUrl: `${baseUrl}/trial-success`, userId, coProId: coProRef.id });
    } catch (e: any) {
      console.error("web-signup-trial error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.get("/trial-success", (_req: Request, res: Response) => {
    res.send(pageShell("Essai gratuit démarré — Maintena", `
  <div class="m-container" style="max-width:560px;">
    <div class="m-card" style="text-align:center;">
      <div style="width:72px;height:72px;border-radius:20px;background:linear-gradient(135deg,#059669,#10b981);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px;">✓</div>
      <h1 style="font-size:1.6rem;margin-bottom:10px;">Votre essai gratuit commence !</h1>
      <p class="subtitle">30 jours pour découvrir Maintena. Aucun paiement ne sera prélevé pendant cette période.</p>

      <div style="background:#F0FDF4;border:1px solid #A7F3D0;border-radius:14px;padding:16px;margin:24px 0;text-align:left;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#065F46;margin-bottom:12px;">Prochaines étapes</div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:0.9rem;color:#1a3c34;">
          <div style="display:flex;align-items:center;gap:10px;"><span style="width:22px;height:22px;background:#10b981;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#fff;flex-shrink:0;">1</span> Téléchargez l'application Maintena</div>
          <div style="display:flex;align-items:center;gap:10px;"><span style="width:22px;height:22px;background:#10b981;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#fff;flex-shrink:0;">2</span> Connectez-vous avec votre email et mot de passe</div>
          <div style="display:flex;align-items:center;gap:10px;"><span style="width:22px;height:22px;background:#10b981;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:800;color:#fff;flex-shrink:0;">3</span> Invitez vos prestataires et résidents</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;">
        <a href="https://play.google.com/store/apps/details?id=com.profusionnumerik.maintena" target="_blank" style="display:flex;align-items:center;justify-content:center;gap:10px;background:#000;color:#fff;padding:14px 20px;border-radius:12px;font-weight:600;font-size:0.9rem;text-decoration:none;border:1px solid rgba(255,255,255,0.12);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.18 23.77a2.5 2.5 0 0 1-.74-1.82V2.05A2.5 2.5 0 0 1 3.18.23l.1-.08L13.5 10.5v.1L3.18 23.77zm14.04-8.62-2.86-2.85-1.46 1.46 2.86 2.85 1.46-1.46zm2.43-5.42-2.86 2.86-2.86-2.86-.1.07-3.3 3.3 3.3 3.3.1.07 9.27-5.35a1.5 1.5 0 0 0 0-2.6l-3.55-2.05zM3.28.3l10.22 10.2-1.46 1.46L1.82 1.74A2.5 2.5 0 0 1 3.28.3z"/></svg>
          Télécharger sur Google Play
        </a>
        <a href="/web" style="display:block;background:var(--blue);color:#fff;padding:14px 20px;border-radius:12px;font-weight:700;font-size:0.9rem;text-decoration:none;">
          Accéder à la version web →
        </a>
      </div>

      <p style="margin-top:20px;font-size:0.78rem;color:rgba(255,255,255,0.35);">
        Une question ? <a href="mailto:contact@profusionnumerik.com" style="color:var(--blue);">contact@profusionnumerik.com</a>
      </p>
    </div>
  </div>`));
  });

  app.post("/api/stripe-webhook", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).send("Stripe not configured");

    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;
    try {
      if (webhookSecret && sig) {
        const rawBody = (req as any).rawBody ?? req.body;
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } else {
        event = req.body as Stripe.Event;
      }
    } catch (e: any) {
      console.error("Webhook signature error:", e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    const db = getAdminDb();
    if (!db) return res.status(503).send("Firestore unavailable");

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;

        const userId = session.metadata?.userId;
        const coProId = session.metadata?.coProId;
        const adminEmail = session.metadata?.adminEmail;
        const coProName = session.metadata?.coProName;
        const inviteCode = session.metadata?.inviteCode;
        const planFromMeta = session.metadata?.plan ?? "starter";

        const customerId =
          typeof session.customer === "string" ? session.customer : "";

        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : "";

        let expiresAtStr: string | null = null;
        let resolvedPlan = planFromMeta.replace("-annuel", "");

        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const periodEndUnix = (subscription as any).current_period_end;
            if (periodEndUnix) {
              expiresAtStr = new Date(periodEndUnix * 1000).toISOString();
            }
            const priceId = (subscription as any).items?.data?.[0]?.price?.id ?? "";
            if (priceId) resolvedPlan = getPlanFromPriceId(priceId);
          } catch (e) {
            console.error("subscription retrieve error:", e);
          }
        }

        const now = new Date().toISOString();

        // Plan bénévole avec trial Stripe : statut "trialing" jusqu'à la fin d'essai
        const isBenevoleWithTrial =
          resolvedPlan === "benevole" &&
          session.status === "complete" &&
          (session as any).subscription;

        let finalStatus = "active";
        let trialEndsAtStr: string | null = null;
        if (isBenevoleWithTrial && subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            if ((sub as any).status === "trialing" && (sub as any).trial_end) {
              finalStatus = "trialing";
              trialEndsAtStr = new Date((sub as any).trial_end * 1000).toISOString();
            }
          } catch {}
        }

        if (userId) {
          await db.collection("users").doc(userId).set(
            {
              subscriptionStatus: finalStatus,
              subscriptionPlan: resolvedPlan,
              subscriptionActivatedAt: now,
              subscriptionExpiresAt: expiresAtStr,
              ...(trialEndsAtStr ? { trialEndsAt: trialEndsAtStr } : {}),
              stripeSessionId: session.id,
              stripeCustomerId: customerId || null,
              stripeSubscriptionId: subscriptionId || null,
            },
            { merge: true }
          );

          // Anti-abus : marquer le téléphone comme "trial utilisé" pour plan bénévole
          if (resolvedPlan === "benevole") {
            try {
              const userDoc = await db.collection("users").doc(userId).get();
              const userPhone = String(userDoc.data()?.phone ?? "").trim();
              if (userPhone) {
                await db.collection("phoneIndex").doc(userPhone).set(
                  { trialClaimed: true, trialClaimedAt: now, uid: userId },
                  { merge: true }
                );
              }
            } catch {}
          }
        }

        if (coProId) {
          await db.collection("copros").doc(coProId).set(
            {
              status: "active",
              activatedAt: now,
              stripePaid: true,
              stripeSessionId: session.id,
              stripeCustomerId: customerId || null,
              stripeSubscriptionId: subscriptionId || null,
            },
            { merge: true }
          );
        } else if (userId) {
          const pendingCopros = await db
            .collection("copros")
            .where("adminId", "==", userId)
            .where("status", "==", "pending")
            .get();

          if (!pendingCopros.empty) {
            const batch = db.batch();
            pendingCopros.docs.forEach((d) => {
              batch.set(
                d.ref,
                {
                  status: "active",
                  activatedAt: now,
                  stripePaid: true,
                  stripeSessionId: session.id,
                  stripeCustomerId: customerId || null,
                  stripeSubscriptionId: subscriptionId || null,
                },
                { merge: true }
              );
            });
            await batch.commit();
          }
        }

        if (adminEmail && coProName && inviteCode) {
          try {
            await sendActivationEmail(adminEmail, coProName, inviteCode);
          } catch (e) {
            console.error("Email send error:", e);
          }
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const now = new Date().toISOString();

        const usersSnap = await db
          .collection("users")
          .where("stripeSubscriptionId", "==", subscriptionId)
          .get();

        const coprosSnap = await db
          .collection("copros")
          .where("stripeSubscriptionId", "==", subscriptionId)
          .get();

        const batch = db.batch();

        usersSnap.forEach((doc) => {
          batch.set(
            doc.ref,
            {
              subscriptionStatus: "canceled",
              subscriptionCanceledAt: now,
            },
            { merge: true }
          );
        });

        coprosSnap.forEach((doc) => {
          batch.set(
            doc.ref,
            {
              status: "inactive",
              subscriptionCanceledAt: now,
            },
            { merge: true }
          );
        });

        await batch.commit();
      }

      return res.json({ received: true });
    } catch (e: any) {
      console.error("stripe-webhook error:", e);
      return res.status(500).send(e.message ?? "Webhook error");
    }
  });

  app.post("/api/start-trial", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });

    const authHeader = req.headers.authorization ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return res.status(401).json({ error: "Non authentifié." });

    try {
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase non configuré." });
      const { uid } = await adminAuth.verifyIdToken(idToken);

      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.data() ?? {};

      if (userData.subscriptionStatus === "trialing" || userData.trialEndsAt) {
        return res.status(409).json({ error: "Un essai gratuit a déjà été utilisé sur ce compte." });
      }
      if (userData.subscriptionStatus === "active") {
        return res.status(409).json({ error: "Votre abonnement est déjà actif." });
      }

      // Anti-abus : vérifier que le numéro de téléphone n'a pas déjà bénéficié d'un essai
      const userPhone = String(userData.phone ?? "").trim();
      if (userPhone) {
        const phoneSnap = await db.collection("phoneIndex").doc(userPhone).get();
        if (phoneSnap.exists && phoneSnap.data()?.trialClaimed) {
          return res.status(409).json({
            error: "Un essai gratuit a déjà été utilisé avec ce numéro de téléphone. Abonnez-vous directement.",
          });
        }
      }

      const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
      const now = new Date().toISOString();

      await db.collection("users").doc(uid).set(
        { subscriptionStatus: "trialing", trialEndsAt },
        { merge: true }
      );

      // Marquer le numéro comme ayant utilisé son essai
      if (userPhone) {
        await db.collection("phoneIndex").doc(userPhone).set(
          { trialClaimed: true, trialClaimedAt: now, uid },
          { merge: true }
        );
      }

      return res.json({ ok: true, trialEndsAt });
    } catch (e: any) {
      console.error("start-trial error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Vérification limite copros selon le plan ─────────────────────────────────
  app.post("/api/check-copro-limit", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });

    const authHeader = req.headers.authorization ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return res.status(401).json({ error: "Non authentifié." });

    try {
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase non configuré." });
      const { uid } = await adminAuth.verifyIdToken(idToken);
      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.data() ?? {};

      let max: number;
      let maxMembersPerCopro: number = 100;
      let plan: string;

      if (userData.accessType === "demo") {
        // Vérifier expiration démo
        if (userData.demoExpiresAt && new Date(userData.demoExpiresAt) < new Date()) {
          plan = "expired";
          max = 0;
        } else {
          plan = "demo";
          max = userData.demoMaxCopros ?? 1;
          maxMembersPerCopro = userData.demoMaxMembersPerCopro ?? 5;
        }
      } else {
        plan = userData.subscriptionPlan ?? (userData.subscriptionStatus === "trialing" ? "trialing" : "starter");
        max = PLAN_LIMITS[plan] ?? 1;
      }

      const coproSnap = await db.collection("copros").where("adminId", "==", uid).get();
      const current = coproSnap.size;

      return res.json({ allowed: current < max, current, max, plan, maxMembersPerCopro });
    } catch (e: any) {
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Changement de plan (upgrade / downgrade) ──────────────────────────────────
  app.post("/api/change-plan", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "Stripe non configuré." });

    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });

    const authHeader = req.headers.authorization ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return res.status(401).json({ error: "Non authentifié." });

    const { plan } = req.body as { plan?: string };
    const validPlans = ["starter", "starter-annuel", "pro", "pro-annuel", "business", "business-annuel"];
    if (!plan || !validPlans.includes(plan)) {
      return res.status(400).json({ error: "Plan invalide." });
    }

    try {
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase non configuré." });
      const { uid } = await adminAuth.verifyIdToken(idToken);
      const userSnap = await db.collection("users").doc(uid).get();
      const userData = userSnap.data() ?? {};

      const stripeSubscriptionId = userData.stripeSubscriptionId as string | undefined;
      if (!stripeSubscriptionId) {
        return res.status(400).json({ error: "Aucun abonnement Stripe actif." });
      }

      const priceId =
        plan === "starter-annuel"  ? (process.env.STRIPE_PRICE_ID_STARTER_ANNUEL  || process.env.STRIPE_PRICE_ID) :
        plan === "pro-annuel"      ? (process.env.STRIPE_PRICE_ID_PRO_ANNUEL      || process.env.STRIPE_PRICE_ID) :
        plan === "business-annuel" ? (process.env.STRIPE_PRICE_ID_BUSINESS_ANNUEL || process.env.STRIPE_PRICE_ID) :
        plan === "pro"             ? (process.env.STRIPE_PRICE_ID_PRO             || process.env.STRIPE_PRICE_ID) :
        plan === "business"        ? (process.env.STRIPE_PRICE_ID_BUSINESS        || process.env.STRIPE_PRICE_ID) :
                                     (process.env.STRIPE_PRICE_ID_STARTER         || process.env.STRIPE_PRICE_ID);

      if (!priceId) return res.status(503).json({ error: "Configuration Stripe incomplète." });

      const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
      const itemId = (subscription as any).items?.data?.[0]?.id;

      await stripe.subscriptions.update(stripeSubscriptionId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: "create_prorations",
      });

      const planName = plan.replace("-annuel", "");
      await db.collection("users").doc(uid).set(
        { subscriptionPlan: planName },
        { merge: true }
      );

      return res.json({ ok: true, plan: planName, max: PLAN_LIMITS[planName] ?? 1 });
    } catch (e: any) {
      console.error("change-plan error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur Stripe" });
    }
  });

  app.post("/api/billing-portal", async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "Stripe non configuré." });

    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });

    const authHeader = req.headers.authorization ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return res.status(401).json({ error: "Non authentifié." });

    try {
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase non configuré." });
      const { uid } = await adminAuth.verifyIdToken(idToken);
      const userSnap = await db.collection("users").doc(uid).get();
      const stripeCustomerId = userSnap.data()?.stripeCustomerId as string | undefined;
      if (!stripeCustomerId) {
        return res.status(400).json({ error: "Aucun abonnement Stripe associé à ce compte." });
      }

      const baseUrl = req.headers.origin ?? (process.env.BASE_URL ?? "https://maintena.app");
      const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: `${baseUrl}/`,
      });

      return res.json({ url: session.url });
    } catch (e: any) {
      console.error("billing-portal error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur portail." });
    }
  });

  app.post("/api/activate-user-subscription", async (req: Request, res: Response) => {
    const { userId, coProId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId requis." });
    }

    const db = getAdminDb();
    if (!db) {
      return res.status(503).json({ error: "Firebase non configuré." });
    }

    try {
      const now = new Date().toISOString();
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const expiresAtStr = expiresAt.toISOString();

      await db
        .collection("users")
        .doc(userId)
        .set(
          {
            subscriptionStatus: "active",
            subscriptionActivatedAt: now,
            subscriptionExpiresAt: expiresAtStr,
            activatedByAdmin: true,
          },
          { merge: true }
        );

      if (coProId) {
        await db.collection("copros").doc(coProId).update({
          status: "active",
          activatedAt: now,
        });
      }

      const pendingCopros = await db
        .collection("copros")
        .where("adminId", "==", userId)
        .where("status", "==", "pending")
        .get();

      if (!pendingCopros.empty) {
        const batch = db.batch();
        pendingCopros.docs.forEach((d) => {
          batch.update(d.ref, { status: "active", activatedAt: now });
        });
        await batch.commit();
      }

      return res.json({ activated: true, expiresAt: expiresAtStr });
    } catch (e: any) {
      console.error("activate-user-subscription error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
    const adminAuth = getAdminAuthInstance();
    if (!adminAuth) return res.status(503).json({ error: "Firebase non configuré." });

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: "Email invalide." });
    }

    try {
      const resetLink = await adminAuth.generatePasswordResetLink(email);

      let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
      try {
        resendClient = await getUncachableResendClient();
      } catch {
        return res.status(200).json({ sent: true });
      }

      const from = resendClient.fromEmail ?? "Maintena <noreply@maintena-pro.fr>";
      await resendClient.client.emails.send({
        from,
        to: email,
        subject: "Réinitialisation de votre mot de passe Maintena",
        html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>
    <div style="padding:32px;">
      <div style="background:#FEF3C7;color:#92400E;font-size:13px;font-weight:600;padding:8px 16px;border-radius:20px;display:inline-block;margin-bottom:20px;">
        Réinitialisation du mot de passe
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#0F172A;margin:0 0 12px;">
        Vous avez oublié votre mot de passe ?
      </h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Pas de panique. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable <strong>1 heure</strong>.
      </p>
      <a href="${resetLink}" style="display:inline-block;background:#2563EB;color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;margin-bottom:24px;">
        Réinitialiser mon mot de passe
      </a>
      <p style="color:#94A3B8;font-size:13px;line-height:1.6;margin:0;">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe ne sera pas modifié.
      </p>
    </div>
    <div style="background:#F8FAFC;padding:20px 32px;border-top:1px solid #E2E8F0;">
      <p style="margin:0;color:#94A3B8;font-size:12px;">© 2026 ProFusion Numérik · <a href="https://maintena-pro.fr" style="color:#2563EB;">maintena-pro.fr</a></p>
    </div>
  </div>
</body>
</html>`,
      });

      return res.json({ sent: true });
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") {
        return res.json({ sent: true });
      }
      console.error("reset-password error:", e);
      return res.status(500).json({ error: "Erreur lors de l'envoi." });
    }
  });

  app.post("/api/resend-invite-code", async (req: Request, res: Response) => {
    const { adminEmail, coProName, inviteCode } = req.body;
    if (!adminEmail || !coProName || !inviteCode) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
    try {
      resendClient = await getUncachableResendClient();
    } catch (e) {
      console.warn("Resend not connected — email non envoyé:", e);
      return res.status(503).json({ error: "Service email non disponible." });
    }

    const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";

    try {
      await resendClient.client.emails.send({
        from: fromAddress,
        to: adminEmail,
        subject: `Rappel : votre code d'invitation Maintena`,
        html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>
    <div style="padding:32px;">
      <div style="background:#EFF6FF;color:#1D4ED8;font-size:13px;font-weight:600;
        padding:8px 16px;border-radius:20px;display:inline-block;margin-bottom:20px;">
        Rappel de code
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#0F172A;margin:0 0 12px;">
        Votre code d'invitation
      </h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Voici le code d'invitation pour votre copropriété <strong>${escapeHtml(
          coProName
        )}</strong>.
        Utilisez-le pour rejoindre l'application Maintena ou partagez-le à vos prestataires.
      </p>
      <div style="background:#F8FAFC;border:2px dashed #CBD5E1;border-radius:14px;
        padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:600;color:#94A3B8;
          text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
          Code d'invitation
        </div>
        <div style="font-size:36px;font-weight:800;color:#0B1628;
          letter-spacing:8px;font-family:monospace;">
          ${escapeHtml(inviteCode)}
        </div>
        <div style="font-size:12px;color:#94A3B8;margin-top:8px;">
          Saisissez ce code dans l'application Maintena
        </div>
      </div>
      <div style="background:#FEF3C7;border-radius:12px;padding:16px;">
        <div style="font-size:13px;color:#92400E;font-weight:600;margin-bottom:4px;">
          Vous n'avez pas demandé ce rappel ?
        </div>
        <div style="font-size:13px;color:#B45309;line-height:1.5;">
          Ignorez cet email. Votre compte reste sécurisé.
        </div>
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #F1F5F9;text-align:center;">
      <p style="font-size:12px;color:#94A3B8;margin:0;">
        Maintena — Gestion professionnelle de copropriété
      </p>
    </div>
  </div>
</body>
</html>
        `,
      });

      return res.json({ sent: true });
    } catch (e: any) {
      console.error("Email send error:", e);
      return res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/send-activation-email", async (req: Request, res: Response) => {
    const { adminEmail, coProName, inviteCode } = req.body;
    if (!adminEmail || !coProName || !inviteCode) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    try {
      await sendActivationEmail(adminEmail, coProName, inviteCode);
      return res.json({ sent: true });
    } catch (e: any) {
      console.error("Email send error:", e);
      return res.status(500).json({ error: e.message });
    }
  });


  app.get("/privacy-policy", (_req: Request, res: Response) => {
    return res.sendFile("privacy-policy.html", { root: "public" });
  });

  app.get("/cgu", (_req: Request, res: Response) => {
    res.send(pageShell("Conditions d'utilisation — Maintena", `
  <div class="m-container" style="max-width:720px;">
    <div class="m-card">
      <h1 style="font-size:26px;font-weight:800;margin-bottom:4px;">Conditions Générales d'Utilisation</h1>
      <p style="color:var(--muted);font-size:14px;margin-bottom:32px;">Dernière mise à jour : mai 2026</p>

      <h2>1. Objet</h2>
      <p>Maintena est une application destinée à la gestion et au suivi des interventions en copropriété, éditée par ProFusion Numérik (SIREN 932 117 500).</p>

      <h2>2. Utilisateurs</h2>
      <p>L'application est accessible aux syndics, prestataires et copropriétaires ou occupants autorisés. Chaque profil dispose de droits d'accès adaptés à sa fonction.</p>

      <h2>3. Compte utilisateur</h2>
      <p>L'utilisateur est responsable des informations fournies et de la confidentialité de ses identifiants. Toute utilisation frauduleuse du compte devra être signalée immédiatement.</p>

      <h2>4. Utilisation du service</h2>
      <p>L'application doit être utilisée de manière loyale et conforme à sa finalité : gestion réelle d'interventions et d'informations liées à une copropriété. Tout usage abusif, frauduleux ou contraire à l'ordre public est interdit.</p>

      <h2>5. Données personnelles</h2>
      <p>Les données collectées (nom, email, téléphone, photos) sont utilisées exclusivement dans le cadre du service. Consultez notre <a href="/privacy-policy" style="color:var(--blue);">Politique de confidentialité</a> pour plus d'informations.</p>

      <h2>6. Abonnement</h2>
      <p>L'accès complet au service nécessite un abonnement payant (essai gratuit 30 jours inclus). Tarifs mensuels sans engagement : <strong>Starter 9,99 €/mois</strong> (1–4 copros), <strong>Pro 19,99 €/mois</strong> (jusqu'à 15 copros), <strong>Business 34,99 €/mois</strong> (jusqu'à 30 copros). Offres annuelles : <strong>99 €/an</strong> (Starter), <strong>199 €/an</strong> (Pro), <strong>349 €/an</strong> (Business). L'abonnement mensuel est résiliable à tout moment depuis votre espace client Stripe.</p>

      <h2>7. Responsabilité</h2>
      <p>ProFusion Numérik s'engage à maintenir le service disponible et sécurisé, sans garantir une disponibilité ininterrompue. La société ne peut être tenue responsable des dommages indirects liés à l'utilisation du service.</p>

      <h2>8. Modification des CGU</h2>
      <p>Ces conditions peuvent être modifiées à tout moment. Les utilisateurs seront informés de tout changement significatif. La poursuite de l'utilisation du service vaut acceptation des nouvelles conditions.</p>

      <h2>9. Droit applicable</h2>
      <p>Les présentes CGU sont soumises au droit français. Tout litige sera soumis à la compétence des tribunaux de Toulouse.</p>

      <h2>10. Contact</h2>
      <p>Pour toute question : <a href="mailto:contact@profusionnumerik.com" style="color:var(--blue);">contact@profusionnumerik.com</a> · 06 68 18 30 92</p>
    </div>
  </div>
  <style>
    h2 { font-size: 16px; font-weight: 700; margin: 24px 0 8px; color: var(--text); }
    p { font-size: 14px; color: #334155; line-height: 1.7; margin-bottom: 4px; }
    .m-card { padding: 40px; }
  </style>`));
  });

  app.get("/account-deletion", (_req: Request, res: Response) => {
    return res.sendFile("account-deletion.html", { root: "public" });
  });

  app.post("/api/account/deletion-request", async (req: Request, res: Response) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim();
    if (!email) {
      return res.status(400).json({ message: "Email requis." });
    }

    const db = getAdminDb();
    const createdAt = new Date().toISOString();

    if (db) {
      await db.collection("accountDeletionRequests").add({
        email,
        reason: reason || null,
        source: "public-web",
        status: "pending",
        createdAt,
      });
    } else {
      // fallback: send email notification when Firebase Admin is unavailable
      try {
        const resendClient = await getUncachableResendClient();
        const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
        await resendClient.client.emails.send({
          from: fromAddress,
          to: process.env.EXPO_PUBLIC_SUPER_ADMIN_EMAIL ?? "bijourobert1@gmail.com",
          subject: `[Maintena] Demande de suppression de compte — ${email}`,
          html: `<p><strong>Email :</strong> ${email}</p><p><strong>Motif :</strong> ${reason || "Non précisé"}</p><p><strong>Date :</strong> ${createdAt}</p>`,
        });
      } catch (e) {
        console.error("deletion-request fallback email failed:", e);
        return res.status(503).json({ message: "Service temporairement indisponible." });
      }
    }

    return res.status(200).json({ ok: true });
  });

  app.post("/api/account/delete", async (req: Request, res: Response) => {
    const decoded = await extractAuthenticatedUser(req);
    if (!decoded?.uid) {
      return res.status(401).json({ message: "Authentification requise." });
    }

    try {
      await deleteUserData(decoded.uid);
      return res.status(200).json({ ok: true, deleted: true });
    } catch (error) {
      console.error("Account deletion failed", error);
      return res.status(500).json({ message: "Suppression impossible pour le moment." });
    }
  });

  app.get("/inscription", (_req: Request, res: Response) => {
    const html = pageShell("Créer mon espace syndic — Essai gratuit 30 jours", `
  <div class="m-container">
    <div class="m-card">
      <div style="display:flex;align-items:center;gap:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:10px;padding:10px 14px;margin-bottom:20px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
        <span style="font-size:0.88rem;font-weight:600;color:#6ee7b7;">30 jours gratuits · Sans engagement · Aucune carte bancaire</span>
      </div>

      <h1>Créer mon espace syndic</h1>
      <p class="subtitle">Renseignez vos informations pour démarrer votre essai gratuit. Votre compte est actif immédiatement.</p>

      <form id="signup-form">
        <div class="m-row">
          <div>
            <label class="m-label" for="firstName">Prénom</label>
            <input class="m-input" id="firstName" placeholder="Jean" required autocomplete="given-name" />
          </div>
          <div>
            <label class="m-label" for="lastName">Nom</label>
            <input class="m-input" id="lastName" placeholder="Dupont" required autocomplete="family-name" />
          </div>
        </div>

        <label class="m-label" for="email">Email professionnel</label>
        <input class="m-input" id="email" type="email" placeholder="jean.dupont@syndic.fr" required autocomplete="email" />

        <label class="m-label" for="phone">Téléphone <span style="font-weight:400;color:var(--muted)">(optionnel)</span></label>
        <input class="m-input" id="phone" type="tel" placeholder="06 00 00 00 00" maxlength="14" autocomplete="tel" />

        <label class="m-label" for="password">Mot de passe <span style="font-weight:400;color:var(--muted)">(min. 6 caractères)</span></label>
        <input class="m-input" id="password" type="password" minlength="6" required autocomplete="new-password" />

        <hr style="border:none;border-top:1px solid var(--border);margin:24px 0;" />
        <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:4px;">Votre première copropriété</p>

        <label class="m-label" for="coProName">Nom de la copropriété</label>
        <input class="m-input" id="coProName" placeholder="Résidence Les Pins" required />

        <label class="m-label" for="address">Adresse</label>
        <input class="m-input" id="address" placeholder="12 rue de la Paix" required autocomplete="street-address" />

        <div class="m-row">
          <div>
            <label class="m-label" for="postalCode">Code postal</label>
            <input class="m-input" id="postalCode" placeholder="31000" required autocomplete="postal-code" />
          </div>
          <div>
            <label class="m-label" for="city">Ville</label>
            <input class="m-input" id="city" placeholder="Toulouse" required autocomplete="address-level2" />
          </div>
        </div>

        <button class="m-btn" type="submit" id="submit-btn" style="background:linear-gradient(135deg,#059669,#10b981);">
          Démarrer l’essai gratuit →
        </button>
        <div class="m-error" id="error"></div>
      </form>

      <p style="text-align:center;margin-top:16px;font-size:12px;color:var(--muted);">
        Après l’essai, à partir de 9,99 €/mois · Résiliable à tout moment<br/>
        <a href="/inscription-paiement" style="color:var(--muted);text-decoration:underline;text-underline-offset:2px;">Payer directement sans essai</a>
      </p>
    </div>
  </div>

  <script>
    var form = document.getElementById("signup-form");
    var errorBox = document.getElementById("error");
    var btn = document.getElementById("submit-btn");

    var phoneInput = document.getElementById("phone");
    phoneInput.addEventListener("input", function () {
      var digits = phoneInput.value.replace(/\\D/g, "").slice(0, 10);
      phoneInput.value = digits.replace(/(\\d{2})(?=\\d)/g, "$1 ").trim();
    });

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      errorBox.style.display = "none";
      btn.textContent = "Création du compte…";
      btn.disabled = true;

      var body = {
        firstName: document.getElementById("firstName").value.trim(),
        lastName: document.getElementById("lastName").value.trim(),
        email: document.getElementById("email").value.trim().toLowerCase(),
        phone: document.getElementById("phone").value.replace(/\\s/g, "").trim(),
        password: document.getElementById("password").value,
        coProName: document.getElementById("coProName").value.trim(),
        address: document.getElementById("address").value.trim(),
        postalCode: document.getElementById("postalCode").value.trim(),
        city: document.getElementById("city").value.trim(),
      };

      try {
        var response = await fetch("/api/web-signup-trial", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || "Erreur lors de l’inscription");
        if (data.redirectUrl) { window.location.href = data.redirectUrl; return; }
        throw new Error("Réponse inattendue du serveur");
      } catch (err) {
        errorBox.textContent = err.message || "Erreur inconnue";
        errorBox.style.display = "block";
        btn.textContent = "Démarrer l’essai gratuit →";
        btn.disabled = false;
      }
    });
  </script>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  });

  // Inscription avec paiement direct (pour ceux qui veulent payer sans essai)
  app.get("/inscription-paiement", (req: Request, res: Response) => {
    const queryPlan = String(req.query?.plan ?? "starter").trim().toLowerCase();
    const validPlans = ["starter","pro","business","starter-annuel","pro-annuel","business-annuel"];
    const initialPlan = validPlans.includes(queryPlan) ? queryPlan : "starter";
    const planLabels: Record<string, string> = {
      "starter":          "Continuer → 9,99 €/mois",
      "pro":              "Continuer → 19,99 €/mois",
      "business":         "Continuer → 34,99 €/mois",
      "starter-annuel":   "Continuer → 99 €/an",
      "pro-annuel":       "Continuer → 199 €/an",
      "business-annuel":  "Continuer → 349 €/an",
    };
    const html = pageShell("Créer mon espace syndic — Abonnement direct", `
  <style>
    .billing-toggle { display:flex; gap:0; margin-bottom:16px; border-radius:10px; overflow:hidden; border:1px solid var(--border); max-width:280px; margin-left:auto; margin-right:auto; }
    .billing-btn { flex:1; padding:10px 12px; background:transparent; color:var(--muted); border:none; cursor:pointer; font-size:13px; font-weight:600; font-family:inherit; transition:background 0.15s,color 0.15s; text-align:center; }
    .billing-btn.active { background:var(--blue); color:#fff; }
    .plan-grid { display:flex; gap:10px; margin-bottom:24px; flex-wrap:wrap; }
    .plan-card { flex:1; min-width:140px; border:2px solid var(--border); border-radius:12px; padding:14px 12px; cursor:pointer; transition:border-color 0.15s,background 0.15s; text-align:center; }
    .plan-card.active { border-color:var(--blue); background:rgba(37,99,235,0.06); }
    .plan-card:hover:not(.active) { border-color:rgba(255,255,255,0.3); }
    .plan-name { font-size:14px; font-weight:700; color:var(--text); margin-bottom:4px; }
    .plan-price { font-size:13px; color:var(--muted); }
    .plan-copros { font-size:11px; color:var(--muted); margin-top:3px; }
  </style>
  <div class="m-container">
    <div class="m-card">
      <p style="text-align:center;margin-bottom:16px;"><a href="/inscription" style="color:var(--blue);font-size:0.88rem;">← Retour à l’essai gratuit</a></p>
      <h1>Abonnement direct</h1>
      <p class="subtitle">Créez votre compte et activez votre abonnement immédiatement via Stripe.</p>

      <div class="billing-toggle" id="billing-toggle">
        <button type="button" class="billing-btn${!initialPlan.includes("annuel") ? " active" : ""}" data-billing="mensuel">Mensuel</button>
        <button type="button" class="billing-btn${initialPlan.includes("annuel") ? " active" : ""}" data-billing="annuel">Annuel ⭐</button>
      </div>

      <div class="plan-grid" id="plan-grid">
        <div class="plan-card${initialPlan === "starter" || initialPlan === "starter-annuel" ? " active" : ""}" data-tier="starter">
          <div class="plan-name">Starter</div>
          <div class="plan-price" id="price-starter">9,99 €/mois</div>
          <div class="plan-copros">1 à 4 copros</div>
        </div>
        <div class="plan-card${initialPlan === "pro" || initialPlan === "pro-annuel" ? " active" : ""}" data-tier="pro">
          <div class="plan-name">Pro</div>
          <div class="plan-price" id="price-pro">19,99 €/mois</div>
          <div class="plan-copros">5 à 15 copros</div>
        </div>
        <div class="plan-card${initialPlan === "business" || initialPlan === "business-annuel" ? " active" : ""}" data-tier="business">
          <div class="plan-name">Business</div>
          <div class="plan-price" id="price-business">34,99 €/mois</div>
          <div class="plan-copros">16 à 30 copros</div>
        </div>
      </div>

      <form id="signup-form">
        <div class="m-row"><div><label class="m-label">Prénom</label><input class="m-input" id="firstName" placeholder="Jean" required /></div><div><label class="m-label">Nom</label><input class="m-input" id="lastName" placeholder="Dupont" required /></div></div>
        <label class="m-label">Email professionnel</label><input class="m-input" id="email" type="email" placeholder="jean.dupont@syndic.fr" required />
        <label class="m-label">Téléphone</label><input class="m-input" id="phone" type="tel" placeholder="06 00 00 00 00" maxlength="14" />
        <label class="m-label">Mot de passe <span style="font-weight:400;color:var(--muted)">(min. 6 car.)</span></label><input class="m-input" id="password" type="password" minlength="6" required />
        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0;" />
        <label class="m-label">Nom de la copropriété</label><input class="m-input" id="coProName" placeholder="Résidence Les Pins" required />
        <label class="m-label">Adresse</label><input class="m-input" id="address" placeholder="12 rue de la Paix" required />
        <div class="m-row"><div><label class="m-label">Code postal</label><input class="m-input" id="postalCode" placeholder="31000" required /></div><div><label class="m-label">Ville</label><input class="m-input" id="city" placeholder="Toulouse" required /></div></div>
        <button class="m-btn" type="submit" id="submit-btn">${planLabels[initialPlan]}</button>
        <div class="m-error" id="error"></div>
      </form>
      <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--muted);">🔒 Paiement sécurisé via Stripe · Résiliation à tout moment</p>
    </div>
  </div>
  <script>
    var currentTier = "${initialPlan.replace("-annuel", "") || "starter"}";
    var currentBilling = "${initialPlan.includes("annuel") ? "annuel" : "mensuel"}";

    var monthlyPrices = { starter:"9,99 €/mois", pro:"19,99 €/mois", business:"34,99 €/mois" };
    var annualPrices  = { starter:"99 €/an", pro:"199 €/an", business:"349 €/an" };
    var btnLabels = {
      starter:{mensuel:"Continuer → 9,99 €/mois", annuel:"Continuer → 99 €/an"},
      pro:{mensuel:"Continuer → 19,99 €/mois", annuel:"Continuer → 199 €/an"},
      business:{mensuel:"Continuer → 34,99 €/mois", annuel:"Continuer → 349 €/an"},
    };

    var form = document.getElementById("signup-form");
    var errorBox = document.getElementById("error");
    var btn = document.getElementById("submit-btn");

    function getCurrentPlanCode() {
      return currentBilling === "annuel" ? currentTier + "-annuel" : currentTier;
    }

    function updateUI() {
      var prices = currentBilling === "annuel" ? annualPrices : monthlyPrices;
      document.getElementById("price-starter").textContent = prices.starter;
      document.getElementById("price-pro").textContent = prices.pro;
      document.getElementById("price-business").textContent = prices.business;
      document.querySelectorAll("#plan-grid .plan-card").forEach(function(c) {
        c.classList.toggle("active", c.dataset.tier === currentTier);
      });
      document.querySelectorAll("#billing-toggle .billing-btn").forEach(function(b) {
        b.classList.toggle("active", b.dataset.billing === currentBilling);
      });
      btn.textContent = btnLabels[currentTier][currentBilling];
    }

    document.querySelectorAll("#billing-toggle .billing-btn").forEach(function(b) {
      b.addEventListener("click", function() { currentBilling = b.dataset.billing; updateUI(); });
    });
    document.querySelectorAll("#plan-grid .plan-card").forEach(function(c) {
      c.addEventListener("click", function() { currentTier = c.dataset.tier; updateUI(); });
    });

    var phoneInput = document.getElementById("phone");
    phoneInput.addEventListener("input", function() { var d = phoneInput.value.replace(/\\D/g,"").slice(0,10); phoneInput.value = d.replace(/(\\d{2})(?=\\d)/g,"$1 ").trim(); });

    form.addEventListener("submit", async function(e) {
      e.preventDefault(); errorBox.style.display="none"; btn.textContent="Chargement…"; btn.disabled=true;
      var body = { firstName:document.getElementById("firstName").value.trim(), lastName:document.getElementById("lastName").value.trim(), email:document.getElementById("email").value.trim().toLowerCase(), phone:document.getElementById("phone").value.replace(/\\s/g,"").trim(), password:document.getElementById("password").value, coProName:document.getElementById("coProName").value.trim(), address:document.getElementById("address").value.trim(), postalCode:document.getElementById("postalCode").value.trim(), city:document.getElementById("city").value.trim(), plan:getCurrentPlanCode() };
      try { var r = await fetch("/api/web-signup-checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); var d = await r.json(); if(!r.ok) throw new Error(d.error||"Erreur"); if(d.url){window.location.href=d.url;return;} throw new Error("Session Stripe introuvable"); }
      catch(err) { errorBox.textContent=err.message||"Erreur inconnue"; errorBox.style.display="block"; btn.textContent=btnLabels[currentTier][currentBilling]; btn.disabled=false; }
    });

    updateUI();
  </script>`);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  });

  app.get("/payment-success", (_req: Request, res: Response) => {
    res.send(pageShell("Paiement confirmé", `
  <div class="m-container" style="max-width:520px;">
    <div class="m-card" style="text-align:center;">
      <div style="font-size:56px;margin-bottom:16px;">✅</div>
      <h1>Paiement confirmé !</h1>
      <p class="subtitle">Votre abonnement Maintena est activé. Fermez cette fenêtre et retournez dans l’application.</p>
      <a href="https://maintena-pro.fr" style="display:inline-block;margin-top:16px;background:var(--blue);color:white;padding:13px 28px;border-radius:12px;font-weight:700;font-size:15px;">Accéder à l’application</a>
      <p style="margin-top:16px;font-size:13px;color:var(--muted);">Ou ouvrez l’application mobile Maintena sur votre téléphone.</p>
      <p style="margin-top:12px;font-size:13px;color:var(--muted);">Une question ? <a href="mailto:contact@profusionnumerik.com" style="color:var(--blue);">contact@profusionnumerik.com</a></p>
    </div>
  </div>`));
  });

  app.get("/payment-cancel", (_req: Request, res: Response) => {
    res.send(pageShell("Paiement annulé", `
  <div class="m-container" style="max-width:520px;">
    <div class="m-card" style="text-align:center;">
      <div style="font-size:56px;margin-bottom:16px;">↩️</div>
      <h1>Paiement annulé</h1>
      <p class="subtitle">Le paiement n’a pas été finalisé. Vous pouvez réessayer à tout moment sans perdre vos informations.</p>
      <a href="/inscription" style="display:inline-block;margin-top:8px;background:var(--blue);color:white;padding:13px 28px;border-radius:12px;font-weight:700;font-size:15px;">Réessayer</a>
      <a href="/" style="display:inline-block;margin-top:12px;color:var(--muted);font-size:14px;">Retour à l’accueil</a>
    </div>
  </div>`));
  });

  app.post("/api/init-user-copros", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) {
      return res.status(503).json({ error: "Firebase Admin non configuré" });
    }

    const { uid, email, displayName } = req.body as {
      uid?: string;
      email?: string;
      displayName?: string;
    };

    if (!uid) {
      return res.status(400).json({ error: "uid requis" });
    }

    try {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const existingIds: string[] = userSnap.exists
        ? userSnap.data()?.managedCoproIds ?? []
        : [];

      const adminQuery = await db
        .collection("copros")
        .where("adminId", "==", uid)
        .get();

      const allIds = new Set<string>(existingIds);
      const copros: any[] = [];

      for (const d of adminQuery.docs) {
        allIds.add(d.id);
        const data = d.data();
        copros.push({ id: d.id, ...data });

        const memberRef = db
          .collection("copros")
          .doc(d.id)
          .collection("members")
          .doc(uid);

        const memberSnap = await memberRef.get();
        if (!memberSnap.exists) {
          await memberRef.set({
            uid,
            email: email ?? "",
            displayName: displayName ?? email ?? "",
            role: "admin",
            joinedAt: new Date().toISOString(),
          });
        }
      }

      for (const id of existingIds) {
        if (!adminQuery.docs.find((d) => d.id === id)) {
          try {
            const coProSnap = await db.collection("copros").doc(id).get();
            if (coProSnap.exists) {
              copros.push({ id: coProSnap.id, ...coProSnap.data() });

              const memberRef = db
                .collection("copros")
                .doc(id)
                .collection("members")
                .doc(uid);

              const memberSnap = await memberRef.get();
              if (!memberSnap.exists) {
                await memberRef.set({
                  uid,
                  email: email ?? "",
                  displayName: displayName ?? email ?? "",
                  role: "admin",
                  joinedAt: new Date().toISOString(),
                });
              }
            }
          } catch {}
        }
      }

      const allIdsArr = Array.from(allIds);
      if (allIdsArr.length > 0) {
        await userRef.set({ managedCoproIds: allIdsArr }, { merge: true });
      }

      return res.json({ copros, managedCoproIds: allIdsArr });
    } catch (e: any) {
      console.error("init-user-copros error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.post("/api/admin/activate-subscription", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) {
      return res.status(503).json({ error: "Firebase Admin non configuré" });
    }

    const { uid, adminSecret } = req.body as {
      uid?: string;
      adminSecret?: string;
    };

    if (adminSecret !== process.env.SESSION_SECRET) {
      return res.status(403).json({ error: "Non autorisé" });
    }

    if (!uid) {
      return res.status(400).json({ error: "uid requis" });
    }

    try {
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      await db
        .collection("users")
        .doc(uid)
        .set(
          {
            subscriptionStatus: "active",
            subscriptionActivatedAt: now.toISOString(),
            subscriptionExpiresAt: expiresAt.toISOString(),
          },
          { merge: true }
        );

      const coprosSnap = await db.collection("copros").where("adminId", "==", uid).get();
      const batch = db.batch();
      coprosSnap.docs.forEach((d) => {
        batch.update(d.ref, { status: "active" });
      });
      await batch.commit();

      return res.json({
        success: true,
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        coprosActivated: coprosSnap.docs.length,
      });
    } catch (e: any) {
      console.error("activate-subscription error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Accès Démo (Super Admin) ──────────────────────────────────────────────────

  async function verifySuperAdmin(req: Request, db: FirebaseFirestore.Firestore) {
    const adminAuth = getAdminAuthInstance();
    if (!adminAuth) throw new Error("Firebase non configuré.");
    const authHeader = req.headers.authorization ?? "";
    const idToken = authHeader.replace("Bearer ", "").trim();
    if (!idToken) throw new Error("Non authentifié.");
    const { uid, email } = await adminAuth.verifyIdToken(idToken);
    const superAdminEmail = process.env.EXPO_PUBLIC_SUPER_ADMIN_EMAIL ?? "";
    if (!email || email.toLowerCase() !== superAdminEmail.toLowerCase()) throw new Error("Accès refusé.");
    return { uid, email };
  }

  app.post("/api/superadmin/grant-demo", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const { email, maxCopros = 1, maxMembersPerCopro = 5, expiresInDays } = req.body as {
        email?: string; maxCopros?: number; maxMembersPerCopro?: number; expiresInDays?: number;
      };
      if (!email) return res.status(400).json({ error: "email requis." });

      const normalizedEmail = email.toLowerCase().trim();
      const now = new Date().toISOString();
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
        : null;

      const demoData = {
        email: normalizedEmail,
        maxCopros: Math.max(1, Math.min(maxCopros, 30)),
        maxMembersPerCopro: Math.max(1, Math.min(maxMembersPerCopro, 100)),
        grantedAt: now,
        ...(expiresAt ? { expiresAt } : {}),
      };

      // Stocker dans demoInvites (toujours) pour retrouver la liste
      await db.collection("demoInvites").doc(normalizedEmail).set(demoData);

      // Appliquer immédiatement si l'utilisateur existe déjà
      const adminAuth = getAdminAuthInstance();
      if (adminAuth) {
        try {
          const userRecord = await adminAuth.getUserByEmail(normalizedEmail);
          await db.collection("users").doc(userRecord.uid).set({
            accessType: "demo",
            demoMaxCopros: demoData.maxCopros,
            demoMaxMembersPerCopro: demoData.maxMembersPerCopro,
            demoGrantedAt: now,
            ...(expiresAt ? { demoExpiresAt: expiresAt } : {}),
            subscriptionStatus: "active",
          }, { merge: true });

          // Activer les copros existantes de cet utilisateur
          const coprosSnap = await db.collection("copros").where("adminId", "==", userRecord.uid).get();
          if (!coprosSnap.empty) {
            const batch = db.batch();
            coprosSnap.docs.forEach((d) => batch.update(d.ref, { status: "active" }));
            await batch.commit();
          }
        } catch {
          // Utilisateur pas encore inscrit — l'invite sera appliquée à l'inscription
        }
      }

      return res.json({ ok: true, ...demoData });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  app.post("/api/superadmin/revoke-demo", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const { email } = req.body as { email?: string };
      if (!email) return res.status(400).json({ error: "email requis." });
      const normalizedEmail = email.toLowerCase().trim();

      await db.collection("demoInvites").doc(normalizedEmail).delete();

      const adminAuth = getAdminAuthInstance();
      if (adminAuth) {
        try {
          const userRecord = await adminAuth.getUserByEmail(normalizedEmail);
          await db.collection("users").doc(userRecord.uid).set({
            accessType: null,
            demoMaxCopros: null,
            demoMaxMembersPerCopro: null,
            demoGrantedAt: null,
            demoExpiresAt: null,
            subscriptionStatus: "trialing",
          }, { merge: true });
        } catch { /* user not found */ }
      }

      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  app.get("/api/superadmin/list-demos", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const snap = await db.collection("demoInvites").orderBy("grantedAt", "desc").get();
      const demos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.json({ demos });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  // ── Génération de lien démo ────────────────────────────────────────────────
  app.post("/api/superadmin/generate-demo-link", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const { maxCopros = 2, maxMembersPerCopro = 10, demoExpiresInDays = null, usageLimit = 1 } = req.body ?? {};
      const { randomBytes } = await import("crypto");
      const token = randomBytes(20).toString("hex");
      const now = new Date().toISOString();
      await db.collection("demoLinks").doc(token).set({
        token,
        maxCopros: Number(maxCopros),
        maxMembersPerCopro: Number(maxMembersPerCopro),
        demoExpiresInDays: demoExpiresInDays ? Number(demoExpiresInDays) : null,
        usageLimit: Number(usageLimit),
        usedCount: 0,
        createdAt: now,
        createdBy: process.env.EXPO_PUBLIC_SUPER_ADMIN_EMAIL ?? "admin",
      });
      const url = `${getBaseUrl(req)}/demo/${token}`;
      return res.json({ ok: true, url, token });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  app.get("/api/superadmin/list-demo-links", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const snap = await db.collection("demoLinks").orderBy("createdAt", "desc").get();
      return res.json({ links: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  app.delete("/api/superadmin/delete-demo-link/:token", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      await db.collection("demoLinks").doc(String(req.params.token)).delete();
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  // ── Page landing démo (/demo/:token) ───────────────────────────────────────
  app.get("/demo/:token", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).send("Service indisponible.");
    const token = String(req.params.token);
    const snap = await db.collection("demoLinks").doc(token).get();
    if (!snap.exists) return res.status(404).send(pageShell("Lien invalide — Maintena", `<div class="m-container"><div class="m-card" style="text-align:center;"><h1>Lien invalide</h1><p>Ce lien démo n'existe pas ou a expiré.</p><a href="/inscription" class="m-btn" style="display:inline-block;">Créer un compte →</a></div></div>`));
    const link = snap.data()!;
    if (link.usedCount >= link.usageLimit) return res.status(410).send(pageShell("Lien expiré — Maintena", `<div class="m-container"><div class="m-card" style="text-align:center;"><h1>Lien déjà utilisé</h1><p>Ce lien démo a atteint sa limite d'utilisation.</p><a href="/inscription" class="m-btn" style="display:inline-block;">Démarrer un essai gratuit →</a></div></div>`));

    const limitText = `${link.maxCopros} copropriété${link.maxCopros > 1 ? "s" : ""} · ${link.maxMembersPerCopro} membres/copro${link.demoExpiresInDays ? ` · ${link.demoExpiresInDays} jours d'accès` : " · Accès illimité"}`;

    const html = pageShell("Accès Démo — Maintena", `
  <div class="m-container">
    <div class="m-card">
      <div style="display:flex;align-items:center;gap:8px;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.2);border-radius:10px;padding:10px 14px;margin-bottom:20px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
        <span style="font-size:0.88rem;font-weight:600;color:#2563eb;">Accès Démo · ${escapeHtml(limitText)}</span>
      </div>

      <h1>Créer votre compte démo</h1>
      <p class="subtitle">Vous avez été invité à tester Maintena. Renseignez vos informations pour accéder à l'application immédiatement.</p>

      <form id="signup-form">
        <div class="m-row">
          <div>
            <label class="m-label" for="firstName">Prénom</label>
            <input class="m-input" id="firstName" placeholder="Jean" required autocomplete="given-name" />
          </div>
          <div>
            <label class="m-label" for="lastName">Nom</label>
            <input class="m-input" id="lastName" placeholder="Dupont" required autocomplete="family-name" />
          </div>
        </div>

        <label class="m-label" for="email">Email professionnel</label>
        <input class="m-input" id="email" type="email" placeholder="jean.dupont@syndic.fr" required autocomplete="email" />

        <label class="m-label" for="phone">Téléphone <span style="font-weight:400;color:var(--muted)">(optionnel)</span></label>
        <input class="m-input" id="phone" type="tel" placeholder="06 00 00 00 00" maxlength="14" autocomplete="tel" />

        <label class="m-label" for="password">Mot de passe <span style="font-weight:400;color:var(--muted)">(min. 6 caractères)</span></label>
        <input class="m-input" id="password" type="password" minlength="6" required autocomplete="new-password" />

        <hr style="border:none;border-top:1px solid var(--border);margin:24px 0;" />
        <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:4px;">Votre première copropriété</p>

        <label class="m-label" for="coProName">Nom de la copropriété</label>
        <input class="m-input" id="coProName" placeholder="Résidence Les Pins" required />

        <label class="m-label" for="address">Adresse</label>
        <input class="m-input" id="address" placeholder="12 rue de la Paix" required autocomplete="street-address" />

        <div class="m-row">
          <div>
            <label class="m-label" for="postalCode">Code postal</label>
            <input class="m-input" id="postalCode" placeholder="31000" required autocomplete="postal-code" />
          </div>
          <div>
            <label class="m-label" for="city">Ville</label>
            <input class="m-input" id="city" placeholder="Toulouse" required autocomplete="address-level2" />
          </div>
        </div>

        <button class="m-btn" type="submit" id="submit-btn">
          Accéder à l'application →
        </button>
        <div class="m-error" id="error"></div>
      </form>
    </div>
  </div>

  <script>
    var form = document.getElementById("signup-form");
    var errorBox = document.getElementById("error");
    var btn = document.getElementById("submit-btn");
    var phoneInput = document.getElementById("phone");
    phoneInput.addEventListener("input", function () {
      var digits = phoneInput.value.replace(/\\D/g, "").slice(0, 10);
      phoneInput.value = digits.replace(/(\\d{2})(?=\\d)/g, "$1 ").trim();
    });
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      errorBox.style.display = "none";
      btn.disabled = true;
      btn.textContent = "Création en cours…";
      try {
        var r = await fetch("/api/demo-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: ${JSON.stringify(token)},
            firstName: document.getElementById("firstName").value.trim(),
            lastName: document.getElementById("lastName").value.trim(),
            email: document.getElementById("email").value.trim().toLowerCase(),
            phone: document.getElementById("phone").value.replace(/\\s/g,"").trim(),
            password: document.getElementById("password").value,
            coProName: document.getElementById("coProName").value.trim(),
            address: document.getElementById("address").value.trim(),
            postalCode: document.getElementById("postalCode").value.trim(),
            city: document.getElementById("city").value.trim(),
          }),
        });
        var d = await r.json();
        if (!r.ok) throw new Error(d.error || "Erreur");
        window.location.href = d.redirectUrl;
      } catch (err) {
        errorBox.textContent = err.message;
        errorBox.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Accéder à l'application →";
      }
    });
  </script>`);
    res.send(html);
  });

  // ── Inscription via lien démo ───────────────────────────────────────────────
  app.post("/api/demo-signup", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    const { token, firstName, lastName, email, phone, password, coProName, address, postalCode, city } = req.body ?? {};
    if (!token || !firstName || !lastName || !email || !password || !coProName || !address || !postalCode || !city) {
      return res.status(400).json({ error: "Champs obligatoires manquants." });
    }
    if (String(password).trim().length < 6) {
      return res.status(400).json({ error: "Le mot de passe doit contenir au moins 6 caractères." });
    }
    try {
      const linkRef = db.collection("demoLinks").doc(String(token));
      const linkSnap = await linkRef.get();
      if (!linkSnap.exists) return res.status(404).json({ error: "Lien invalide." });
      const link = linkSnap.data()!;
      if (link.usedCount >= link.usageLimit) return res.status(410).json({ error: "Ce lien a déjà été utilisé." });

      const { getAuth } = await import("firebase-admin/auth");
      const adminAuth = getAuth();
      const normalizedEmail = String(email).trim().toLowerCase();
      const displayName = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();

      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(normalizedEmail);
        return res.status(409).json({ error: "Un compte existe déjà avec cet email. Connectez-vous dans l'application." });
      } catch {
        userRecord = await adminAuth.createUser({ email: normalizedEmail, password: String(password).trim(), displayName });
      }

      const userId = userRecord.uid;
      const inviteCode = await createUniqueInviteCode(db);
      const coProRef = db.collection("copros").doc();
      const now = new Date().toISOString();
      const demoExpiresAt = link.demoExpiresInDays
        ? new Date(Date.now() + link.demoExpiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

      await db.collection("users").doc(userId).set({
        uid: userId, email: normalizedEmail, displayName,
        firstName: String(firstName).trim(), lastName: String(lastName).trim(),
        phone: String(phone ?? "").trim(), role: "admin",
        subscriptionStatus: "active",
        accessType: "demo",
        demoMaxCopros: link.maxCopros,
        demoMaxMembersPerCopro: link.maxMembersPerCopro,
        demoGrantedAt: now,
        ...(demoExpiresAt ? { demoExpiresAt } : {}),
        createdAt: now,
        managedCoproIds: [coProRef.id],
      });

      await coProRef.set({
        name: String(coProName).trim(), address: String(address).trim(),
        postalCode: String(postalCode).trim(), city: String(city).trim(),
        adminId: userId, adminEmail: normalizedEmail, inviteCode,
        status: "active", stripePaid: false, createdAt: now,
        activatedAt: now,
      });

      await db.collection("copros").doc(coProRef.id).collection("members").doc(userId).set({
        uid: userId, email: normalizedEmail, displayName, role: "admin", joinedAt: now,
      });

      await db.collection("inviteCodes").doc(inviteCode).set({
        coProId: coProRef.id, coProName: String(coProName).trim(), role: "prestataire", createdAt: now,
      });

      // Incrémente le compteur d'utilisation
      await linkRef.update({ usedCount: (link.usedCount ?? 0) + 1 });

      // Email de bienvenue + notification admin
      try { await sendActivationEmail(normalizedEmail, String(coProName).trim(), inviteCode); } catch {}
      try {
        await sendAdminNotification({
          type: "demo", displayName, email: normalizedEmail,
          coProName: String(coProName).trim(),
          demoExpiresInDays: link.demoExpiresInDays ?? null,
        });
      } catch {}

      return res.json({ ok: true, redirectUrl: `${getBaseUrl(req)}/trial-success` });
    } catch (e: any) {
      console.error("demo-signup error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // Activité récente : dernières inscriptions
  app.get("/api/superadmin/recent-activity", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const snap = await db.collection("users")
        .orderBy("createdAt", "desc")
        .limit(30)
        .get();
      const users = snap.docs.map((d) => {
        const u = d.data();
        return {
          uid: d.id,
          displayName: u.displayName ?? "",
          email: u.email ?? "",
          createdAt: u.createdAt ?? "",
          accessType: u.accessType ?? "trial",
          subscriptionStatus: u.subscriptionStatus ?? "",
          managedCoproIds: u.managedCoproIds ?? [],
        };
      });
      return res.json({ users });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  // Liste toutes les copros via Admin SDK (bypasse les règles Firestore)
  app.get("/api/superadmin/list-copros", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const snap = await db.collection("copros").orderBy("createdAt", "desc").get();
      const copros = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return res.json({ copros });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  // Met à jour le statut d'une copro via Admin SDK
  app.post("/api/superadmin/update-copro-status", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });
    try {
      await verifySuperAdmin(req, db);
      const { coProId, status } = req.body as { coProId?: string; status?: string };
      if (!coProId || !["pending", "active", "suspended"].includes(status ?? "")) {
        return res.status(400).json({ error: "coProId et status requis." });
      }
      await db.collection("copros").doc(coProId).update({ status });
      return res.json({ ok: true });
    } catch (e: any) {
      return res.status(e.message === "Accès refusé." ? 403 : 500).json({ error: e.message });
    }
  });

  // Envoie des rappels aux utilisateurs dont le démo expire dans les 7 prochains jours
  // Appelé par Cloud Scheduler (cron quotidien) ou manuellement via le panel
  app.post("/api/cron/demo-reminders", async (req: Request, res: Response) => {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase non configuré." });

    // Auth : soit token super admin, soit secret cron
    const cronSecret = req.headers["x-cron-secret"] ?? "";
    const isCron = cronSecret !== "" && cronSecret === (process.env.CRON_SECRET ?? "");
    if (!isCron) {
      try { await verifySuperAdmin(req, db); } catch (e: any) {
        return res.status(403).json({ error: "Accès refusé." });
      }
    }

    try {
      let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
      try { resendClient = await getUncachableResendClient(); } catch {
        return res.status(503).json({ error: "Email non configuré." });
      }

      const now = new Date();
      const in7days = new Date(now.getTime() + 7 * 86400000);
      const snap = await db.collection("demoInvites").get();

      const sent: string[] = [];
      const skipped: string[] = [];

      for (const d of snap.docs) {
        const data = d.data();
        if (!data.expiresAt) { skipped.push(d.id); continue; }
        const expiry = new Date(data.expiresAt);
        const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
        if (daysLeft <= 0 || daysLeft > 7) { skipped.push(d.id); continue; }

        const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
        await resendClient.client.emails.send({
          from: fromAddress,
          to: d.id,
          subject: `Votre accès Maintena expire dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`,
          html: `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>
    <div style="padding:32px;">
      <div style="background:#FEF3C7;color:#92400E;font-size:13px;font-weight:600;padding:8px 16px;border-radius:20px;display:inline-block;margin-bottom:20px;">
        Accès démo bientôt expiré
      </div>
      <h1 style="font-size:22px;font-weight:700;color:#0F172A;margin:0 0 12px;">
        Votre accès démo expire dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}
      </h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Votre période d'essai de <strong>Maintena</strong> se termine le <strong>${expiry.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</strong>.
        Pour continuer à gérer vos copropriétés sans interruption, souscrivez à un abonnement.
      </p>
      <a href="https://maintena-pro.fr/inscription-paiement" style="display:inline-block;background:#2563EB;color:#fff;font-size:15px;font-weight:700;padding:14px 28px;border-radius:12px;text-decoration:none;margin-bottom:24px;">
        Choisir mon abonnement
      </a>
      <p style="color:#94A3B8;font-size:12px;line-height:1.6;margin:0;">
        Des questions ? Répondez à cet email ou contactez-nous à <a href="mailto:contact@profusionnumerik.com" style="color:#2563EB;">contact@profusionnumerik.com</a>
      </p>
    </div>
    <div style="padding:16px 32px;text-align:center;border-top:1px solid #F1F5F9;">
      <p style="margin:0;color:#94A3B8;font-size:12px;">© 2026 ProFusion Numérik · <a href="https://maintena-pro.fr" style="color:#2563EB;">maintena-pro.fr</a></p>
    </div>
  </div>
</body></html>`,
        });
        sent.push(d.id);
      }

      return res.json({ ok: true, sent, skipped });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/upload-photo", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization ?? "";
      const idToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";

      const { base64, mimeType = "image/jpeg", storagePath } = req.body as {
        base64?: string;
        mimeType?: string;
        storagePath?: string;
      };

      if (!idToken) return res.status(401).json({ error: "Token requis" });
      if (!base64 || !storagePath) {
        return res.status(400).json({ error: "base64 et storagePath requis" });
      }

      const buffer = Buffer.from(base64, "base64");
      const bucketName =
        process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ??
        "maintena-3a544.firebasestorage.app";

      const adminBucket = getAdminStorage();
      if (adminBucket) {
        const file = adminBucket.file(storagePath);
        await file.save(buffer, {
          metadata: { contentType: mimeType },
          resumable: false,
        });

        await file.makePublic();
        const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
        const downloadUrl = `https://storage.googleapis.com/${bucketName}/${encodedPath}`;

        return res.json({ url: downloadUrl });
      }

      const encodedPath = encodeURIComponent(storagePath);
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o?name=${encodedPath}&uploadType=media`;

      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": mimeType,
          "Content-Length": String(buffer.length),
        },
        body: buffer,
      });

      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        return res.status(uploadRes.status).json({
          error:
            "Upload refusé. Configurez FIREBASE_SERVICE_ACCOUNT ou déployez les règles Firebase Storage.",
          detail: errBody.substring(0, 200),
        });
      }

      const uploadData: any = await uploadRes.json();
      const token = uploadData.downloadTokens ?? "";
      const encodedPathFull = storagePath
        .split("/")
        .map(encodeURIComponent)
        .join("%2F");
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPathFull}?alt=media&token=${token}`;

      return res.json({ url: downloadUrl });
    } catch (e: any) {
      console.error("upload-photo error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Push notifications helper ────────────────────────────────────────────────
  async function sendPushToMembers(
    coProId: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    const db = getAdminDb();
    if (!db) return;

    // Récupérer les UIDs des membres
    const membersSnap = await db.collection("copros").doc(coProId).collection("members").get();
    const uids = membersSnap.docs.map((d) => d.id);
    if (uids.length === 0) return;

    // Récupérer les pushTokens
    const tokens: string[] = [];
    await Promise.all(
      uids.map(async (uid) => {
        const userDoc = await db.collection("users").doc(uid).get();
        const token = userDoc.data()?.pushToken;
        if (token && typeof token === "string" && token.startsWith("ExponentPushToken")) {
          tokens.push(token);
        }
      })
    );
    if (tokens.length === 0) return;

    // Envoyer via Expo Push API (chunks de 100)
    const chunks: string[][] = [];
    for (let i = 0; i < tokens.length; i += 100) chunks.push(tokens.slice(i, i + 100));

    await Promise.all(
      chunks.map((chunk) =>
        fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(
            chunk.map((to) => ({ to, title, body, data: data ?? {}, sound: "default" }))
          ),
        }).catch((e) => console.warn("[push] chunk failed:", e))
      )
    );
  }

  app.post("/api/notify-signalement", async (req: Request, res: Response) => {
    try {
      const { adminEmail, coProName, message, senderName, apartmentNumber, photoUrl } =
        req.body as {
          adminEmail?: string;
          coProName?: string;
          message?: string;
          senderName?: string;
          apartmentNumber?: string;
          photoUrl?: string | null;
        };

      if (!adminEmail || !message) {
        return res.status(400).json({ error: "adminEmail et message requis" });
      }

      let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
      try {
        resendClient = await getUncachableResendClient();
      } catch (e) {
        console.warn("Resend not connected — signalement email non envoyé:", e);
        return res.json({ sent: false, reason: "resend_unavailable" });
      }

      const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";

      await resendClient.client.emails.send({
        from: fromAddress,
        to: adminEmail,
        subject: `Nouveau signalement · ${coProName ?? "Copropriété"}`,
        html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>
    <div style="padding:32px;">
      <div style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:20px;">
        Nouveau signalement
      </div>
      <h2 style="font-size:22px;font-weight:700;color:#0B1628;margin:0 0 8px;">
        ${escapeHtml(coProName ?? "Votre copropriété")}
      </h2>
      <div style="background:#FFFBEB;border:1px solid rgba(245,158,11,0.25);border-radius:14px;padding:18px;margin:20px 0;">
        <div style="font-size:13px;color:#92400E;font-weight:600;margin-bottom:6px;">
          De : ${escapeHtml(senderName ?? "Propriétaire")}${
            apartmentNumber ? ` · Appt ${escapeHtml(apartmentNumber)}` : ""
          }
        </div>
        <div style="font-size:15px;color:#1E293B;line-height:1.5;">${escapeHtml(
          message
        )}</div>
      </div>
      ${photoUrl ? `<img src="${photoUrl}" alt="Photo du signalement" style="width:100%;max-width:456px;border-radius:12px;margin-bottom:16px;display:block;" />` : ""}
      <p style="font-size:13px;color:#64748B;line-height:1.6;">
        Connectez-vous à l'application Maintena pour consulter et répondre à ce signalement.
      </p>
    </div>
    <div style="background:#F8FAFF;padding:20px 32px;border-top:1px solid #E2E8F0;">
      <div style="font-size:12px;color:#94A3B8;text-align:center;">
        Maintena · Gestion de copropriété professionnelle
      </div>
    </div>
  </div>
</body>
</html>`,
      });

      // Push à l'admin de la copro
      const coProId = req.body.coProId as string | undefined;
      if (coProId) {
        sendPushToMembers(
          coProId,
          `🔔 Signalement — ${coProName ?? "Copropriété"}`,
          `${senderName ?? "Un résident"} : ${message}`,
          { type: "signalement", coProId }
        ).catch(() => {});
      }

      return res.json({ sent: true });
    } catch (e: any) {
      console.error("notify-signalement error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.post("/api/notify-announcement", async (req: Request, res: Response) => {
    const { coProId, title, message, type, coProName, senderName } = req.body as {
      coProId?: string; title?: string; message?: string;
      type?: string; coProName?: string; senderName?: string;
    };

    if (!coProId || !title || !message) {
      return res.status(400).json({ error: "coProId, title et message requis" });
    }

    const db = getAdminDb();
    if (!db) return res.json({ sent: 0, reason: "firebase_unavailable" });

    // Récupérer tous les membres propriétaires
    const membersSnap = await db.collection("copros").doc(coProId).collection("members").get();
    const allMembers = membersSnap.docs.map((d) => d.data());
    console.log(`[notify-announcement] ${allMembers.length} membres total, rôles:`, allMembers.map((m) => m.role));
    const ownerEmails: string[] = allMembers
      .filter((m) => m.role === "propriétaire" && m.email && m.receiveAnnouncementEmails !== false)
      .map((m) => m.email as string);
    console.log(`[notify-announcement] ${ownerEmails.length} propriétaires à notifier`);

    if (ownerEmails.length === 0) return res.json({ sent: 0, reason: "no_owners" });

    let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
    try {
      resendClient = await getUncachableResendClient();
    } catch {
      return res.json({ sent: 0, reason: "resend_unavailable" });
    }

    const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";

    const typeColors: Record<string, string> = {
      info: "#2563EB", eau: "#0EBAAA", chauffage: "#F59E0B", travaux: "#8B5CF6", urgent: "#EF4444",
    };
    const typeLabels: Record<string, string> = {
      info: "Information", eau: "Coupure d'eau", chauffage: "Coupure de chauffage",
      travaux: "Travaux", urgent: "Urgence",
    };
    const color = typeColors[type ?? "info"] ?? "#2563EB";
    const typeLabel = typeLabels[type ?? "info"] ?? "Annonce";

    try {
      // Resend accepte un tableau d'adresses
      await resendClient.client.emails.send({
        from: fromAddress,
        to: ownerEmails,
        subject: `${typeLabel} · ${coProName ?? "Votre copropriété"}`,
        html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>
    <div style="padding:32px;">
      <div style="display:inline-block;background:${color}18;color:${color};font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;margin-bottom:20px;">
        ${escapeHtml(typeLabel)}
      </div>
      <h2 style="font-size:22px;font-weight:700;color:#0B1628;margin:0 0 6px;">
        ${escapeHtml(title)}
      </h2>
      <p style="font-size:13px;color:#64748B;margin:0 0 20px;">
        ${escapeHtml(coProName ?? "Votre copropriété")} · ${escapeHtml(senderName ?? "Le syndic")}
      </p>
      <div style="background:#F8FAFF;border-left:4px solid ${color};border-radius:0 12px 12px 0;padding:18px 20px;margin-bottom:24px;">
        <p style="font-size:15px;color:#1E293B;line-height:1.6;margin:0;">${escapeHtml(message).replace(/\n/g, "<br/>")}</p>
      </div>
      <p style="font-size:12px;color:#94A3B8;line-height:1.6;margin:0;">
        Vous recevez cet email car vous êtes inscrit comme copropriétaire sur Maintena.
      </p>
    </div>
    <div style="background:#F8FAFF;padding:20px 32px;border-top:1px solid #E2E8F0;">
      <div style="font-size:12px;color:#94A3B8;text-align:center;">Maintena · Gestion de copropriété professionnelle</div>
    </div>
  </div>
</body>
</html>`,
      });
      // Push à tous les membres de la copro
      sendPushToMembers(
        coProId,
        `📢 ${typeLabel} — ${coProName ?? "Copropriété"}`,
        title,
        { type: "announcement", coProId }
      ).catch(() => {});

      return res.json({ sent: ownerEmails.length });
    } catch (e: any) {
      console.error("notify-announcement error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.post("/api/notify-poll", async (req: Request, res: Response) => {
    const { coProId, coProName, title, options, target, createdByName } = req.body as {
      coProId?: string; coProName?: string; title?: string;
      options?: string[]; target?: string; createdByName?: string;
    };
    if (!coProId || !title || !options || !target) {
      return res.status(400).json({ error: "coProId, title, options et target requis" });
    }

    const db = getAdminDb();
    if (!db) return res.json({ sent: 0, reason: "firebase_unavailable" });

    const membersSnap = await db.collection("copros").doc(coProId).collection("members").get();
    const allMembers = membersSnap.docs.map((d) => d.data());

    // Filtrer selon la cible du sondage (même logique que le client)
    const targetEmails: string[] = allMembers
      .filter((m) => {
        if (m.role === "prestataire") return false;
        if (m.receiveAnnouncementEmails === false) return false;
        if (!m.email) return false;
        if (target === "tous") return true;
        if (target === "conseil") return m.role === "conseil";
        if (target === "propriétaires") return m.role === "conseil" || m.role === "propriétaire";
        return false;
      })
      .map((m) => m.email as string);

    if (targetEmails.length === 0) return res.json({ sent: 0, reason: "no_recipients" });

    let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
    try { resendClient = await getUncachableResendClient(); }
    catch { return res.json({ sent: 0, reason: "resend_unavailable" }); }

    const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
    const optionsHtml = (options as string[]).map((opt, i) =>
      `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:8px;background:#F8FAFF;border-radius:10px;border:1px solid #E2E8F0;">
        <div style="width:22px;height:22px;border-radius:50%;border:2px solid #2563EB;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#2563EB;">${i + 1}</div>
        <span style="font-size:14px;color:#1E293B;">${escapeHtml(opt)}</span>
      </div>`
    ).join("");

    try {
      await resendClient.client.emails.send({
        from: fromAddress,
        to: targetEmails,
        subject: `Sondage · ${coProName ?? "Votre copropriété"}`,
        html: `
<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropriété</div>
    </div>
    <div style="padding:32px;">
      <div style="display:inline-block;background:#7C3AED18;color:#7C3AED;font-size:12px;font-weight:700;padding:4px 14px;border-radius:20px;margin-bottom:20px;">Sondage</div>
      <h2 style="font-size:22px;font-weight:700;color:#0B1628;margin:0 0 6px;">${escapeHtml(title)}</h2>
      <p style="font-size:13px;color:#64748B;margin:0 0 20px;">${escapeHtml(coProName ?? "")} · ${escapeHtml(createdByName ?? "Un membre")}</p>
      <div style="margin-bottom:24px;">${optionsHtml}</div>
      <p style="font-size:13px;color:#64748B;">Ouvrez l'application Maintena pour voter.</p>
    </div>
    <div style="background:#F8FAFF;padding:20px 32px;border-top:1px solid #E2E8F0;">
      <div style="font-size:12px;color:#94A3B8;text-align:center;">Maintena · Gestion de copropriété professionnelle</div>
    </div>
  </div>
</body></html>`,
      });
      // Push à tous les membres ciblés
      if (coProId) {
        sendPushToMembers(
          coProId,
          `📊 Sondage — ${coProName ?? "Copropriété"}`,
          title,
          { type: "poll", coProId }
        ).catch(() => {});
      }

      return res.json({ sent: targetEmails.length });
    } catch (e: any) {
      console.error("notify-poll error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ─── Helpers push supplémentaires ─────────────────────────────────────────

  async function sendPushToAdmins(
    coProId: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    const db = getAdminDb();
    if (!db) return;
    const membersSnap = await db.collection("copros").doc(coProId).collection("members").get();
    const adminUids = membersSnap.docs.filter((d) => d.data().role === "admin").map((d) => d.id);
    if (adminUids.length === 0) return;
    const tokens: string[] = [];
    await Promise.all(adminUids.map(async (uid) => {
      const userDoc = await db.collection("users").doc(uid).get();
      const token = userDoc.data()?.pushToken;
      if (token && typeof token === "string" && token.startsWith("ExponentPushToken")) tokens.push(token);
    }));
    if (tokens.length === 0) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, data: data ?? {}, sound: "default" }))),
    }).catch((e) => console.warn("[push] sendPushToAdmins failed:", e));
  }

  async function sendPushToUser(
    uid: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    const db = getAdminDb();
    if (!db) return;
    const userDoc = await db.collection("users").doc(uid).get();
    const token = userDoc.data()?.pushToken;
    if (!token || typeof token !== "string" || !token.startsWith("ExponentPushToken")) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify([{ to: token, title, body, data: data ?? {}, sound: "default" }]),
    }).catch((e) => console.warn("[push] sendPushToUser failed:", e));
  }

  // ─── Intervention créée ────────────────────────────────────────────────────

  app.post("/api/notify-intervention-created", async (req: Request, res: Response) => {
    const { coProId, coProName, title, category, createdByRole } = req.body as {
      coProId?: string; coProName?: string; title?: string;
      category?: string; createdByRole?: string;
    };
    if (!coProId || !title) return res.status(400).json({ error: "coProId et title requis" });
    const db = getAdminDb();
    if (!db) return res.json({ sent: false });
    try {
      const categoryLabel = CATEGORY_LABELS_SERVER[category ?? ""] ?? category ?? "";
      if (createdByRole === "admin") {
        // Admin crée → notifie propriétaires + conseil
        const membersSnap = await db.collection("copros").doc(coProId).collection("members").get();
        const targetUids = membersSnap.docs
          .filter((d) => ["propriétaire", "conseil"].includes(d.data().role))
          .map((d) => d.id);
        const tokens: string[] = [];
        await Promise.all(targetUids.map(async (uid) => {
          const u = await db.collection("users").doc(uid).get();
          const t = u.data()?.pushToken;
          if (t && typeof t === "string" && t.startsWith("ExponentPushToken")) tokens.push(t);
        }));
        if (tokens.length > 0) {
          await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(tokens.map((to) => ({
              to, sound: "default",
              title: `🛠️ Intervention planifiée — ${coProName ?? "Copropriété"}`,
              body: categoryLabel ? `${title} · ${categoryLabel}` : title,
              data: { type: "intervention_created", coProId },
            }))),
          }).catch(() => {});
        }
      } else {
        // Prestataire crée un rapport → notifie l'admin
        await sendPushToAdmins(
          coProId,
          `📋 Rapport soumis — ${coProName ?? "Copropriété"}`,
          `Rapport d'intervention : ${title}`,
          { type: "intervention_created", coProId }
        );
      }
      return res.json({ sent: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Prestataire soumet rapport (→ en_cours) ───────────────────────────────

  app.post("/api/notify-intervention-report", async (req: Request, res: Response) => {
    const { coProId, coProName, title, providerName } = req.body as {
      coProId?: string; coProName?: string; title?: string; providerName?: string;
    };
    if (!coProId || !title) return res.status(400).json({ error: "coProId et title requis" });
    try {
      await sendPushToAdmins(
        coProId,
        `📋 Rapport à valider — ${coProName ?? "Copropriété"}`,
        `${providerName ?? "Le prestataire"} a soumis un rapport pour "${title}"`,
        { type: "intervention_report", coProId }
      );
      return res.json({ sent: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Intervention validée (→ terminée) ────────────────────────────────────

  app.post("/api/notify-intervention-done", async (req: Request, res: Response) => {
    const { coProId, coProName, title, category } = req.body as {
      coProId?: string; coProName?: string; title?: string; category?: string;
    };
    if (!coProId || !title) return res.status(400).json({ error: "coProId et title requis" });
    try {
      await sendPushToMembers(
        coProId,
        `✅ Intervention terminée — ${coProName ?? "Copropriété"}`,
        `"${title}" a été validée`,
        { type: "intervention_done", coProId }
      );
      return res.json({ sent: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Prestataire accepte ou refuse ────────────────────────────────────────

  app.post("/api/notify-provider-response", async (req: Request, res: Response) => {
    const { coProId, coProName, title, providerName, status } = req.body as {
      coProId?: string; coProName?: string; title?: string;
      providerName?: string; status?: "accepted" | "refused";
    };
    if (!coProId || !title || !status) return res.status(400).json({ error: "Paramètres manquants" });
    try {
      await sendPushToAdmins(
        coProId,
        status === "accepted"
          ? `✅ Mission acceptée — ${coProName ?? "Copropriété"}`
          : `❌ Mission refusée — ${coProName ?? "Copropriété"}`,
        `${providerName ?? "Le prestataire"} ${status === "accepted" ? "a accepté" : "a refusé"} "${title}"`,
        { type: "provider_response", coProId, status }
      );
      return res.json({ sent: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Signalement acquitté par l'admin ────────────────────────────────────

  app.post("/api/notify-signalement-response", async (req: Request, res: Response) => {
    const { creatorUid, coProName, adminResponse, signalementMessage } = req.body as {
      creatorUid?: string; coProName?: string;
      adminResponse?: string; signalementMessage?: string;
    };
    if (!creatorUid) return res.status(400).json({ error: "creatorUid requis" });
    try {
      await sendPushToUser(
        creatorUid,
        `💬 Réponse à votre signalement — ${coProName ?? "Copropriété"}`,
        adminResponse
          ? `L'admin a répondu : "${adminResponse}"`
          : "Votre signalement a été pris en compte.",
        { type: "signalement_response" }
      );
      return res.json({ sent: true });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ─── Notification de contrat de maintenance ────────────────────────────────

  app.post("/api/notify-maintenance-created", async (req: Request, res: Response) => {
    const {
      coProId, interventionId, providerEmail, providerName,
      coProName, title, frequency, totalOccurrences, startDate,
    } = req.body as {
      coProId?: string; interventionId?: string; providerEmail?: string; providerName?: string;
      coProName?: string; title?: string; frequency?: string;
      totalOccurrences?: number; startDate?: string;
    };

    if (!providerEmail || !coProName || !title) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const db = getAdminDb();
    let webLink = "";
    if (db && coProId && interventionId) {
      try {
        const token = generateGuestToken();
        const tokenHash = sha256(token);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 jours
        const baseUrl = getBaseUrl(req);
        webLink = `${baseUrl}/guest-intervention/${token}`;
        await db.collection("guestInterventionInvites").add({
          tokenHash, tokenPreview: `${token.slice(0, 8)}…`,
          coProId, interventionId,
          providerEmail: providerEmail.toLowerCase(),
          providerName: providerName ?? "",
          categoryInviteCode: null,
          activationCode: "", activationCodeUsed: false,
          status: "sent",
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      } catch (e) {
        console.warn("[MAINTENA] guest invite for maintenance notification failed:", e);
      }
    }

    const startDateStr = startDate
      ? new Date(startDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
      : "";

    const htmlBody = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:620px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <div style="background:#0B1628;padding:28px 32px 22px;">
      <div style="font-size:28px;font-weight:800;color:#fff;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:4px;">Gestion de copropriété</div>
    </div>

    <div style="padding:32px;">
      <div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;margin-bottom:20px;letter-spacing:0.05em;">
        Engagement de maintenance
      </div>

      <h1 style="font-size:22px;color:#0F172A;margin:0 0 14px;">
        Bonjour ${escapeHtml(providerName ?? "")},
      </h1>

      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 20px;">
        Vous avez été sollicité pour assurer la maintenance de la résidence
        <strong style="color:#0F172A;">${escapeHtml(coProName)}</strong>,
        conformément à votre contrat de prestation de services.
      </p>

      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:20px;margin-bottom:24px;">
        <div style="font-size:12px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">Détail de l'engagement</div>
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="font-size:13px;color:#64748B;padding:5px 0;width:45%;">Objet de la maintenance</td>
            <td style="font-size:14px;color:#0F172A;font-weight:700;">${escapeHtml(title)}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#64748B;padding:5px 0;">Fréquence</td>
            <td style="font-size:14px;color:#0F172A;font-weight:700;">${escapeHtml(frequency ?? "")}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#64748B;padding:5px 0;">Nombre d'interventions</td>
            <td style="font-size:14px;color:#0F172A;font-weight:700;">${totalOccurrences} passage${(totalOccurrences ?? 1) > 1 ? "s" : ""}</td>
          </tr>
          ${startDateStr ? `<tr>
            <td style="font-size:13px;color:#64748B;padding:5px 0;">Date de début</td>
            <td style="font-size:14px;color:#0F172A;font-weight:700;">${escapeHtml(startDateStr)}</td>
          </tr>` : ""}
        </table>
      </div>

      <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:14px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;color:#9A3412;font-weight:700;margin-bottom:10px;">📋 Vos obligations contractuelles</div>
        <ul style="margin:0;padding:0 0 0 18px;color:#C2410C;font-size:13px;line-height:1.8;">
          <li>Réaliser chaque intervention <strong>dans les délais convenus</strong></li>
          <li>Se rendre <strong>obligatoirement sur site</strong> pour chaque passage</li>
          <li>Prendre une <strong>photo de preuve sur site</strong> (obligatoire)</li>
          <li>Compléter <strong>intégralement</strong> la fiche d'intervention correspondante</li>
          <li>Transmettre votre rapport après chaque réalisation</li>
        </ul>
      </div>

      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 24px;">
        Nous comptons sur votre professionnalisme pour garantir la qualité des prestations
        attendues par les copropriétaires de la résidence <strong style="color:#0F172A;">${escapeHtml(coProName)}</strong>.
      </p>

      ${webLink ? `<div style="text-align:center;margin:28px 0;">
        <a href="${webLink}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:16px 32px;border-radius:14px;font-size:15px;font-weight:700;letter-spacing:0.02em;">
          Accéder à la première fiche d'intervention →
        </a>
      </div>
      <p style="font-size:13px;color:#94A3B8;text-align:center;margin:0 0 8px;">
        Sans création de compte requise · Accès direct et sécurisé
      </p>` : ""}

      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-top:20px;">
        Pour toute question, contactez directement le gestionnaire de la copropriété.
      </p>
    </div>
  </div>
</body></html>`;

    let resendClient: Awaited<ReturnType<typeof getUncachableResendClient>>;
    try { resendClient = await getUncachableResendClient(); }
    catch { return res.json({ sent: false, reason: "resend_unavailable" }); }

    const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";

    try {
      await resendClient.client.emails.send({
        from: fromAddress,
        to: providerEmail,
        subject: `Engagement de maintenance – ${coProName}`,
        html: htmlBody,
      });
      return res.json({ sent: true });
    } catch (e: any) {
      console.error("notify-maintenance-created error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ─── Rappel de maintenance ──────────────────────────────────────────────────

  app.post("/api/remind-maintenance", async (req: Request, res: Response) => {
    const {
      coProId, interventionId, providerEmail, providerName,
      coProName, title, nextDate, category,
    } = req.body as {
      coProId?: string; interventionId?: string; providerEmail?: string; providerName?: string;
      coProName?: string; title?: string; nextDate?: string; category?: string;
    };

    if (!providerEmail || !coProName || !title) {
      return res.status(400).json({ error: "Paramètres manquants." });
    }

    const db = getAdminDb();
    let webLink = "";
    if (db && coProId && interventionId) {
      try {
        const token = generateGuestToken();
        const tokenHash = sha256(token);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const baseUrl = getBaseUrl(req);
        webLink = `${baseUrl}/guest-intervention/${token}`;
        await db.collection("guestInterventionInvites").add({
          tokenHash, tokenPreview: `${token.slice(0, 8)}…`,
          coProId, interventionId,
          providerEmail: providerEmail.toLowerCase(),
          providerName: providerName ?? "",
          categoryInviteCode: null,
          activationCode: "", activationCodeUsed: false,
          status: "reminder",
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      } catch (e) {
        console.warn("[MAINTENA] guest invite for reminder failed:", e);
      }
    }

    const nextDateStr = nextDate
      ? new Date(nextDate).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
      : "";

    const htmlBody = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:620px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <div style="background:#0B1628;padding:28px 32px 22px;">
      <div style="font-size:28px;font-weight:800;color:#fff;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:4px;">Gestion de copropriété</div>
    </div>

    <div style="padding:32px;">
      <div style="display:inline-block;background:#FEF3C7;color:#D97706;font-size:12px;font-weight:700;padding:6px 14px;border-radius:20px;margin-bottom:20px;letter-spacing:0.05em;">
        ⏰ Rappel d'intervention
      </div>

      <h1 style="font-size:22px;color:#0F172A;margin:0 0 14px;">
        Bonjour ${escapeHtml(providerName ?? "")},
      </h1>

      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 20px;">
        Votre prochaine intervention de maintenance pour
        <strong style="color:#0F172A;">${escapeHtml(title)}</strong>
        à la résidence <strong style="color:#0F172A;">${escapeHtml(coProName)}</strong>
        approche.
      </p>

      ${nextDateStr ? `<div style="background:#FFFBEB;border:2px solid #F59E0B;border-radius:14px;padding:18px 24px;margin-bottom:24px;text-align:center;">
        <div style="font-size:12px;color:#92400E;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Date d'intervention prévue</div>
        <div style="font-size:22px;font-weight:800;color:#D97706;">${escapeHtml(nextDateStr)}</div>
      </div>` : ""}

      <div style="background:#FFF1F2;border:1px solid #FECDD3;border-radius:14px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;color:#9F1239;font-weight:700;margin-bottom:12px;">⚠️ Rappel de vos obligations</div>
        <ul style="margin:0;padding:0 0 0 18px;color:#BE123C;font-size:13px;line-height:2;">
          <li>Votre <strong>présence sur site est impérative</strong> — aucune prestation à distance n'est acceptée</li>
          <li>Une <strong>photo de preuve prise sur site est obligatoire</strong> pour valider l'intervention</li>
          <li>La fiche d'intervention doit être <strong>intégralement complétée</strong> après chaque passage</li>
          <li>Tout manquement peut engager <strong>votre responsabilité contractuelle</strong></li>
        </ul>
      </div>

      <p style="font-size:15px;color:#475569;line-height:1.7;margin:0 0 8px;">
        Cette mission fait partie de votre <strong>engagement contractuel</strong> envers la résidence
        ${escapeHtml(coProName)}. Les copropriétaires comptent sur la qualité et la régularité de vos prestations.
      </p>

      <p style="font-size:14px;color:#64748B;line-height:1.7;margin:0 0 28px;">
        Merci de prendre toutes les dispositions nécessaires pour réaliser cette maintenance
        <strong>dans les délais convenus</strong> et renseigner dûment la fiche ci-jointe.
      </p>

      ${webLink ? `<div style="text-align:center;margin:28px 0;">
        <a href="${webLink}" style="display:inline-block;background:#D97706;color:#fff;text-decoration:none;padding:16px 32px;border-radius:14px;font-size:15px;font-weight:700;letter-spacing:0.02em;">
          Ouvrir et compléter la fiche d'intervention →
        </a>
      </div>
      <p style="font-size:13px;color:#94A3B8;text-align:center;margin:0 0 8px;">
        Accès direct · sans connexion requise
      </p>` : ""}

      <p style="font-size:13px;color:#94A3B8;line-height:1.6;margin-top:20px;">
        Pour toute question, contactez directement le gestionnaire de la copropriété.
      </p>
    </div>
  </div>
</body></html>`;

    let resendClient2: Awaited<ReturnType<typeof getUncachableResendClient>>;
    try { resendClient2 = await getUncachableResendClient(); }
    catch { return res.json({ sent: false, reason: "resend_unavailable" }); }

    const fromAddress2 = resendClient2.fromEmail ?? "Maintena <onboarding@resend.dev>";

    try {
      await resendClient2.client.emails.send({
        from: fromAddress2,
        to: providerEmail,
        subject: `⏰ Rappel – Maintenance à venir · ${escapeHtml(title)} · ${coProName}`,
        html: htmlBody,
      });
      return res.json({ sent: true });
    } catch (e: any) {
      console.error("remind-maintenance error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.post("/api/guest-access/create", async (req: Request, res: Response) => {
    const { coProId, interventionId, invitedProvider, category, categoryInviteCode } = req.body as {
      coProId?: string;
      interventionId?: string;
      category?: string;
      categoryInviteCode?: string;
      invitedProvider?: {
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        company?: string;
      };
    };

    if (!coProId || !interventionId || !invitedProvider?.email) {
      return res.status(400).json({ error: "coProId, interventionId et invitedProvider.email sont requis." });
    }

    const db = getAdminDb();
    if (!db) {
      return res.status(503).json({ error: "Firebase Admin non configuré." });
    }

    try {
      const payload = await createGuestInviteRecord({
        coProId,
        interventionId,
        providerFirstName: invitedProvider.firstName,
        providerLastName: invitedProvider.lastName,
        providerEmail: invitedProvider.email,
        providerPhone: invitedProvider.phone,
        providerCompany: invitedProvider.company,
        categoryInviteCode: categoryInviteCode ?? undefined,
        req,
      });

      const interventionSnap = await db.collection("copros").doc(coProId).collection("interventions").doc(interventionId).get();
      const coproSnap = await db.collection("copros").doc(coProId).get();
      const providerName = [invitedProvider.firstName, invitedProvider.lastName].filter(Boolean).join(" ").trim() || invitedProvider.email;
      const coproName = (coproSnap.data() as any)?.name ?? "Copropriété";

      // Créer ou retrouver le compte Firebase du prestataire
      let tempPassword: string | undefined;
      let existingAccount = false;
      try {
        const adminAuth = getAuth();
        let uid: string;

        try {
          // Compte déjà existant → ne pas toucher au mot de passe
          const existing = await adminAuth.getUserByEmail(invitedProvider.email);
          uid = existing.uid;
          existingAccount = true;
        } catch {
          // Nouveau compte → créer avec mot de passe provisoire
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          tempPassword = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
          const newUser = await adminAuth.createUser({
            email: invitedProvider.email,
            password: tempPassword,
            displayName: providerName,
          });
          uid = newUser.uid;
        }

        await db.collection("users").doc(uid).set({
          uid,
          email: invitedProvider.email,
          displayName: providerName,
          firstName: invitedProvider.firstName ?? "",
          lastName: invitedProvider.lastName ?? "",
          phone: invitedProvider.phone ?? "",
          company: invitedProvider.company ?? "",
        }, { merge: true });

        await db.collection("copros").doc(coProId).collection("members").doc(uid).set({
          uid,
          email: invitedProvider.email,
          displayName: providerName,
          role: "prestataire",
          categoryFilter: category ?? null,
          joinedAt: new Date().toISOString(),
          invitedByGuest: true,
        }, { merge: true });

        // Ajouter la copro dans managedCoproIds pour qu'elle apparaisse dans le switcher de l'app
        try {
          await db.collection("users").doc(uid).update({
            managedCoproIds: FieldValue.arrayUnion(coProId),
          });
        } catch {
          await db.collection("users").doc(uid).set(
            { managedCoproIds: [coProId] },
            { merge: true }
          );
        }

        // Mettre à jour assignedToUid sur l'intervention pour que le filtre côté app fonctionne
        await db.collection("copros").doc(coProId).collection("interventions").doc(interventionId).update({
          assignedToUid: uid,
        });
      } catch (authErr) {
        console.warn("Création compte provisoire échouée:", authErr);
        tempPassword = undefined;
      }

      let emailSent = false;
      try {
        emailSent = await sendGuestInviteEmail({
          to: invitedProvider.email,
          providerName,
          coproName,
          interventionTitle: (interventionSnap.data() as any)?.title ?? "Intervention",
          interventionCategory: (interventionSnap.data() as any)?.category,
          interventionPhotos: Array.isArray((interventionSnap.data() as any)?.photos) ? (interventionSnap.data() as any).photos : [],
          webLink: payload.webLink,
          completeAccountLink: payload.completeAccountLink,
          activationCode: payload.activationCode,
          tempPassword,
          existingAccount,
        });
      } catch (emailErr: any) {
        console.error("[Maintena] sendGuestInviteEmail threw:", emailErr?.message ?? emailErr);
      }

      return res.json({
        token: payload.token,
        guestWebUrl: payload.webLink,
        completeAccountUrl: payload.completeAccountLink,
        appLink: payload.appLink,
        emailSent,
      });
    } catch (e: any) {
      console.error("guest-access/create error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // Renvoyer l'email d'invitation au prestataire (réutilise l'invite existante)
  app.post("/api/guest-access/resend", async (req: Request, res: Response) => {
    const { coProId, interventionId } = req.body as { coProId?: string; interventionId?: string };
    if (!coProId || !interventionId) {
      return res.status(400).json({ error: "coProId et interventionId requis." });
    }
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Firebase Admin non configuré." });

    try {
      // Chercher l'invite existante pour cette intervention
      const invitesSnap = await db.collection("guestInterventionInvites")
        .where("coProId", "==", coProId)
        .where("interventionId", "==", interventionId)
        .get();

      if (invitesSnap.empty) {
        return res.status(404).json({ error: "Aucune invitation trouvée pour cette intervention." });
      }

      // Trier en mémoire pour éviter l'index composite Firestore
      const sortedDocs = invitesSnap.docs.sort((a, b) => {
        const aDate = a.data().createdAt ?? "";
        const bDate = b.data().createdAt ?? "";
        return bDate > aDate ? 1 : -1;
      });
      const invite = sortedDocs[0].data();
      const providerEmail = invite.providerEmail;
      if (!providerEmail) return res.status(400).json({ error: "Email prestataire manquant." });

      const providerName = invite.providerName ||
        [invite.providerFirstName, invite.providerLastName].filter(Boolean).join(" ").trim() ||
        providerEmail;

      const coproSnap = await db.collection("copros").doc(coProId).get();
      const interventionSnap = await db.collection("copros").doc(coProId).collection("interventions").doc(interventionId).get();
      const coproName = (coproSnap.data() as any)?.name ?? "Copropriété";
      const interventionTitle = (interventionSnap.data() as any)?.title ?? "Intervention";

      // Vérifier si le compte existe déjà ou en créer un nouveau
      let tempPassword: string | undefined;
      let existingAccount = false;
      try {
        const adminAuth = getAuth();
        try {
          await adminAuth.getUserByEmail(providerEmail);
          existingAccount = true;
          // Compte existant → ne pas toucher au mot de passe
        } catch {
          // Compte inexistant → créer avec mot de passe provisoire
          const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          tempPassword = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
          await adminAuth.createUser({ email: providerEmail, password: tempPassword, displayName: providerName });
        }
      } catch { tempPassword = undefined; }

      // Conserver le code d'activation existant, ou en générer un nouveau si absent (invites anciennes)
      let activationCode: string = invite.activationCode ?? "";
      if (!activationCode) {
        const activationChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        activationCode = Array.from(
          { length: 8 },
          () => activationChars[Math.floor(Math.random() * activationChars.length)]
        ).join("");
        await invitesSnap.docs[0].ref.set(
          { activationCode, activationCodeUsed: false },
          { merge: true }
        );
      }

      const emailSent = await sendGuestInviteEmail({
        to: providerEmail,
        providerName,
        coproName,
        interventionTitle,
        interventionCategory: (interventionSnap.data() as any)?.category,
        interventionPhotos: Array.isArray((interventionSnap.data() as any)?.photos) ? (interventionSnap.data() as any).photos : [],
        webLink: invite.webLink ?? "",
        completeAccountLink: invite.completeAccountLink ?? "",
        activationCode,
        tempPassword,
        existingAccount,
      });

      return res.json({ success: true, emailSent });
    } catch (e: any) {
      console.error("guest-access/resend error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.post("/api/guest-invites", async (req: Request, res: Response) => {
    const {
      coProId,
      interventionId,
      providerFirstName,
      providerLastName,
      providerName,
      providerEmail,
      providerPhone,
      providerCompany,
    } = req.body as {
      coProId?: string;
      interventionId?: string;
      providerFirstName?: string;
      providerLastName?: string;
      providerName?: string;
      providerEmail?: string;
      providerPhone?: string;
      providerCompany?: string;
    };

    if (!coProId || !interventionId || !providerEmail) {
      return res.status(400).json({
        error: "coProId, interventionId et providerEmail sont requis.",
      });
    }

    const db = getAdminDb();
    if (!db) {
      return res.status(503).json({ error: "Firebase Admin non configuré." });
    }

    try {
      const payload = await createGuestInviteRecord({
        coProId,
        interventionId,
        providerFirstName,
        providerLastName,
        providerName,
        providerEmail,
        providerPhone,
        providerCompany,
        req,
      });

      const interventionSnap = await db
        .collection("copros")
        .doc(coProId)
        .collection("interventions")
        .doc(interventionId)
        .get();

      const coproSnap = await db.collection("copros").doc(coProId).get();

      const safeProviderName =
        providerName?.trim() ||
        [providerFirstName, providerLastName].filter(Boolean).join(" ").trim() ||
        providerEmail;

      await sendGuestInviteEmail({
        to: providerEmail,
        providerName: safeProviderName,
        coproName: (coproSnap.data() as any)?.name ?? "Copropriété",
        interventionTitle: (interventionSnap.data() as any)?.title ?? "Intervention",
        interventionCategory: (interventionSnap.data() as any)?.category,
        interventionPhotos: Array.isArray((interventionSnap.data() as any)?.photos) ? (interventionSnap.data() as any).photos : [],
        webLink: payload.webLink,
        completeAccountLink: payload.completeAccountLink,
        activationCode: payload.activationCode,
      });

      return res.json(payload);
    } catch (e: any) {
      console.error("guest-invites error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.get("/api/public/intervention/:token", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }
    return res.json(payload);
  });

  app.get("/api/public/complete-account/:token", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }

    return res.json({
      provider: payload.provider,
      links: payload.links,
      copro: payload.copro,
      intervention: {
        id: payload.intervention.id,
        title: payload.intervention.title,
        category: payload.intervention.category,
      },
    });
  });

  app.post("/api/public/complete-account/:token", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }

    const { password, activationCode } = req.body as { password?: string; activationCode?: string };

    if (!password || password.trim().length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit contenir au moins 6 caractères.",
      });
    }

    // Valider le code d'activation s'il est défini sur l'invitation
    const storedCode: string = payload.invite.data.activationCode ?? "";
    const codeAlreadyUsed: boolean = payload.invite.data.activationCodeUsed === true;

    if (storedCode) {
      if (codeAlreadyUsed) {
        return res.status(403).json({
          error: "Ce code d'activation a déjà été utilisé. Connectez-vous directement avec votre email et mot de passe.",
        });
      }
      if (!activationCode || activationCode.trim().toUpperCase() !== storedCode.toUpperCase()) {
        return res.status(400).json({
          error: "Code d'activation invalide. Vérifiez votre email d'invitation.",
        });
      }
    }

    const db = getAdminDb();
    if (!db) {
      return res.status(503).json({ error: "Base de données indisponible." });
    }

    try {
      const { getAuth } = await import("firebase-admin/auth");
      const adminAuth = getAuth();

      // Chercher le compte existant
      let userRecord: import("firebase-admin/auth").UserRecord | null = null;
      try {
        userRecord = await adminAuth.getUserByEmail(payload.provider.email);
      } catch {
        // Compte inexistant — on le crée ci-dessous
      }

      if (userRecord) {
        // Compte existant → mettre à jour le mot de passe avec celui choisi par l'utilisateur
        await adminAuth.updateUser(userRecord.uid, { password: password.trim() });
      } else {
        userRecord = await adminAuth.createUser({
          email: payload.provider.email,
          password: password.trim(),
          displayName: payload.provider.name,
        });
      }

      await db.collection("users").doc(userRecord.uid).set(
        {
          uid: userRecord.uid,
          email: payload.provider.email,
          displayName: payload.provider.name,
          firstName: payload.provider.firstName ?? "",
          lastName: payload.provider.lastName ?? "",
          phone: payload.provider.phone ?? "",
          company: payload.provider.company ?? "",
          guestCompletedAccountAt: new Date().toISOString(),
        },
        { merge: true }
      );

      await payload.invite.ref.set(
        {
          completedAccountAt: new Date().toISOString(),
          completedAccountUid: userRecord.uid,
          activationCodeUsed: storedCode ? true : false,
        },
        { merge: true }
      );

      return res.json({
        success: true,
        uid: userRecord.uid,
        email: payload.provider.email,
      });
    } catch (e: any) {
      console.error("complete-account error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  const uploadMiddleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

  app.post("/api/public/intervention/:token/photo", uploadMiddleware.single("photo"), async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }

    if (payload.intervention.guestUpdatedAt) {
      return res.status(403).json({ error: "Ce compte-rendu a déjà été transmis. Aucune modification n'est possible." });
    }

    // Accepte multipart (FormData) ou JSON base64
    let buffer: Buffer;
    let mimeType = "image/jpeg";

    if (req.file) {
      buffer = req.file.buffer;
      mimeType = req.file.mimetype || "image/jpeg";
    } else {
      const { base64, mimeType: mt = "image/jpeg" } = req.body as { base64?: string; mimeType?: string };
      if (!base64) {
        return res.status(400).json({ error: "Image manquante." });
      }
      buffer = Buffer.from(base64, "base64");
      mimeType = mt;
    }

    try {
      const bucket = getAdminStorage();
      if (!bucket) {
        return res.status(503).json({ error: "Storage Firebase Admin non configuré." });
      }

      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
      const storagePath = `copros/${payload.copro.id}/interventions/${payload.intervention.id}/completion/${fileName}`;
      const storageFile = bucket.file(storagePath);
      const downloadToken = generateDownloadToken();

      console.log(`[photo] upload ${fileName} (${buffer.length} bytes, ${mimeType})`);

      await storageFile.save(buffer, {
        metadata: {
          contentType: mimeType,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
        resumable: false,
      });

      const bucketName = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
      const url = makeFirebaseStorageUrl(bucketName, storagePath, downloadToken);
      const updatedPhotos = [...payload.intervention.completionPhotos, url];

      await payload.interventionRef.set({ completionPhotos: updatedPhotos }, { merge: true });

      console.log(`[photo] saved OK → ${url}`);
      return res.json({ success: true, url, completionPhotos: updatedPhotos });
    } catch (e: any) {
      console.error("guest photo upload error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // Refus via formulaire HTML natif (POST + redirect)
  app.post("/api/public/intervention/:token/refuse", async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const payload = await buildGuestInterventionPayload(token);
    if (payload.status !== 200) {
      return res.redirect(`/guest-intervention/${token}?error=lien_invalide`);
    }
    if (payload.intervention.providerStatus === "refused") {
      return res.redirect(`/guest-intervention/${token}`);
    }
    try {
      await payload.interventionRef.set(
        { providerStatus: "refused", providerStatusAt: new Date().toISOString() },
        { merge: true }
      );
      if (payload.copro.adminEmail) {
        try {
          const rc = await getUncachableResendClient();
          await rc.client.emails.send({
            from: rc.fromEmail ?? "Maintena <noreply@maintena-pro.fr>",
            to: payload.copro.adminEmail,
            subject: `⚠️ Mission refusée — ${payload.intervention.title}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:#991b1b;">Mission refusée par le prestataire</h2><p>Le prestataire <strong>${payload.provider.name}</strong> a refusé l'intervention <strong>${payload.intervention.title}</strong> (${payload.copro.name}).</p><p>Vous pouvez réattribuer cette intervention depuis l'application.</p></div>`,
          });
        } catch { /* mail non critique */ }
      }
      return res.redirect(`/guest-intervention/${token}`);
    } catch (e: any) {
      console.error("refuse error:", e);
      return res.redirect(`/guest-intervention/${token}?error=serveur`);
    }
  });

  // Acceptation ou refus de l'intervention par le prestataire externe
  app.post("/api/public/intervention/:token/respond", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }

    // Un prestataire qui a refusé ne peut plus changer d'avis
    if (payload.intervention.providerStatus === "refused") {
      return res.status(403).json({ error: "Vous avez refusé cette intervention. Contactez l'administrateur pour être réaffecté." });
    }

    const { action } = req.body as { action?: "accepted" | "refused" };
    if (action !== "accepted" && action !== "refused") {
      return res.status(400).json({ error: "action doit être 'accepted' ou 'refused'." });
    }
    try {
      await payload.interventionRef.set(
        {
          providerStatus: action,
          providerStatusAt: new Date().toISOString(),
          ...(action === "accepted" ? { status: "en_cours" } : {}),
        },
        { merge: true }
      );

      // Notifier l'admin par email si le prestataire refuse
      if (action === "refused" && payload.copro.adminEmail) {
        try {
          const resendClient = await getUncachableResendClient();
          const fromAddr = resendClient.fromEmail ?? "Maintena <noreply@maintena-pro.fr>";
          await resendClient.client.emails.send({
            from: fromAddr,
            to: payload.copro.adminEmail,
            subject: `⚠️ Mission refusée — ${payload.intervention.title}`,
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
                <h2 style="color:#991b1b;">Mission refusée par le prestataire</h2>
                <p>Le prestataire <strong>${payload.provider.name}</strong> a refusé l'intervention suivante :</p>
                <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0;">
                  <div style="font-weight:700;font-size:16px;color:#0f172a;">${payload.intervention.title}</div>
                  <div style="color:#64748b;margin-top:4px;">${payload.copro.name}</div>
                </div>
                <p>Vous pouvez réattribuer cette intervention à un autre prestataire depuis l'application.</p>
              </div>
            `,
          });
        } catch (mailErr) {
          console.warn("Notification refus — email admin failed:", mailErr);
        }
      }

      return res.json({ success: true, providerStatus: action });
    } catch (e: any) {
      console.error("guest respond error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.post("/api/public/intervention/:token/report", uploadMiddleware.single("photo"), async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const isFormPost = req.is("application/x-www-form-urlencoded") || !!req.is("multipart/form-data");
    const payload = await buildGuestInterventionPayload(token);

    if (payload.status !== 200) {
      if (isFormPost) return res.redirect(`/guest-intervention/${token}?error=lien_invalide`);
      return res.status(payload.status).json({ error: payload.error });
    }

    if (payload.intervention.providerStatus === "refused") {
      if (isFormPost) return res.redirect(`/guest-intervention/${token}`);
      return res.status(403).json({ error: "Vous avez refusé cette intervention. Aucun compte-rendu ne peut être soumis." });
    }

    if (payload.intervention.guestUpdatedAt) {
      if (isFormPost) return res.redirect(`/guest-intervention/${token}`);
      return res.status(403).json({ error: "Ce compte-rendu a déjà été transmis. Aucune modification n'est possible." });
    }

    const body = req.body as Record<string, any>;
    const status = body.status as string | undefined;
    const report = body.report as string | undefined;
    const completionComment = (body.completionComment as string | undefined) ?? "";
    const interventionRemaining = (body.interventionRemaining as string | undefined) ?? "";

    // completionPhotos may come as a JSON string (native form) or already parsed (JSON API)
    let completionPhotos: string[] = payload.intervention.completionPhotos;
    try {
      const raw = body.completionPhotos;
      if (Array.isArray(raw)) {
        completionPhotos = raw;
      } else if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) completionPhotos = parsed;
      }
    } catch { /* keep existing */ }

    // cleaningChecklist may come as a JSON string (native form) or already parsed (JSON API)
    let cleaningChecklist: Record<string, boolean> | null = null;
    try {
      const raw = body.cleaningChecklist;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        cleaningChecklist = raw as Record<string, boolean>;
      } else if (typeof raw === "string") {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") cleaningChecklist = parsed;
      }
    } catch { /* ignore */ }

    // Upload proof photo if submitted directly in the multipart form
    if (req.file) {
      try {
        const bucket = getAdminStorage();
        if (bucket) {
          const mimeType = req.file.mimetype || "image/jpeg";
          const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
          const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
          const storagePath = `copros/${payload.copro.id}/interventions/${payload.intervention.id}/completion/${fileName}`;
          const storageFile = bucket.file(storagePath);
          const downloadToken = generateDownloadToken();
          await storageFile.save(req.file.buffer, {
            metadata: {
              contentType: mimeType,
              metadata: { firebaseStorageDownloadTokens: downloadToken },
            },
            resumable: false,
          });
          const bucketName = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
          const photoUrl = makeFirebaseStorageUrl(bucketName, storagePath, downloadToken);
          completionPhotos = [...completionPhotos, photoUrl];
          console.log(`[report/photo] upload OK → ${photoUrl}`);
        }
      } catch (uploadErr) {
        console.error("[report/photo] upload error:", uploadErr);
      }
    }

    try {
      await payload.interventionRef.set(
        {
          status: status ?? "en_cours",
          interventionReport: report ?? "",
          completionComment,
          interventionRemaining,
          completionPhotos,
          ...(cleaningChecklist ? { cleaningChecklist } : {}),
          guestUpdatedAt: new Date().toISOString(),
          providerStatus: "accepted",
          ...(payload.intervention.providerStatus !== "accepted" ? { providerStatusAt: new Date().toISOString() } : {}),
        },
        { merge: true }
      );

      await payload.invite.ref.set(
        {
          status: "completed",
          usedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Email de confirmation au prestataire avec le récapitulatif du compte-rendu
      try {
        console.log(`[Maintena] Envoi email confirmation prestataire à ${payload.provider.email}`);
        const rc = await getUncachableResendClient();
        const categoryLabel = CATEGORY_LABELS_SERVER[payload.intervention.category] ?? payload.intervention.category;
        const photosHtml = completionPhotos.length > 0
          ? `<div style="margin-top:16px;"><div style="font-size:13px;color:#64748b;margin-bottom:8px;">Vos photos :</div><div style="display:flex;flex-wrap:wrap;gap:8px;">${completionPhotos.map(url => `<a href="${url}" target="_blank"><img src="${url}" alt="photo" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" /></a>`).join("")}</div></div>`
          : "";
        await rc.client.emails.send({
          from: rc.fromEmail ?? "Maintena <noreply@maintena-pro.fr>",
          to: payload.provider.email,
          subject: `✅ Compte-rendu transmis — ${payload.intervention.title}`,
          html: `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0B1628;padding:28px 32px 22px;">
    <div style="font-size:28px;font-weight:800;color:#fff;">Maintena</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:4px;">Gestion de copropriété</div>
  </div>
  <div style="padding:32px;">
    <div style="display:inline-block;background:#D1FAE5;color:#065F46;font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;margin-bottom:18px;">✅ Compte-rendu transmis</div>
    <h1 style="font-size:20px;color:#0F172A;margin:0 0 8px;">Bonjour ${escapeHtml(payload.provider.name)},</h1>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 20px;">Votre compte-rendu d'intervention a bien été reçu pour la copropriété <strong>${escapeHtml(payload.copro.name)}</strong>.</p>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:18px;margin-bottom:20px;">
      <div style="font-size:13px;color:#64748B;margin-bottom:4px;">Intervention</div>
      <div style="font-size:16px;font-weight:700;color:#0F172A;margin-bottom:8px;">${escapeHtml(payload.intervention.title)}</div>
      <div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;">${escapeHtml(categoryLabel)}</div>
      <div style="margin-top:14px;">
        <div style="font-size:12px;color:#64748B;margin-bottom:4px;">Votre rapport</div>
        <div style="font-size:14px;color:#0F172A;line-height:1.6;white-space:pre-wrap;">${escapeHtml(report ?? "")}</div>
      </div>
      ${photosHtml}
    </div>
    <p style="font-size:13px;color:#94A3B8;">L'administrateur de la copropriété a été notifié. Merci pour votre intervention.</p>
  </div>
</div>
</body></html>`,
        });
      } catch (mailErr) {
        console.warn("Confirmation mail prestataire failed:", mailErr);
      }

      // Notification à l'admin que le prestataire a soumis son compte-rendu
      if (payload.copro.adminEmail) {
        try {
          const rc = await getUncachableResendClient();
          const categoryLabel = CATEGORY_LABELS_SERVER[payload.intervention.category] ?? payload.intervention.category;
          const adminPhotosHtml = completionPhotos.length > 0
            ? `<div style="margin-top:12px;"><div style="font-size:12px;color:#64748b;margin-bottom:6px;">Photos du prestataire :</div><div style="display:flex;flex-wrap:wrap;gap:8px;">${completionPhotos.map(url => `<a href="${url}" target="_blank"><img src="${url}" alt="photo" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" /></a>`).join("")}</div></div>`
            : "";
          await rc.client.emails.send({
            from: rc.fromEmail ?? "Maintena <noreply@maintena-pro.fr>",
            to: payload.copro.adminEmail,
            subject: `📋 Compte-rendu reçu — ${payload.intervention.title}`,
            html: `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
<div style="max-width:600px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#0B1628;padding:28px 32px 22px;"><div style="font-size:28px;font-weight:800;color:#fff;">Maintena</div></div>
  <div style="padding:32px;">
    <div style="display:inline-block;background:#D1FAE5;color:#065F46;font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;margin-bottom:16px;">📋 Compte-rendu reçu</div>
    <h2 style="font-size:18px;color:#0F172A;margin:0 0 16px;">Le prestataire <strong>${escapeHtml(payload.provider.name)}</strong> a soumis son compte-rendu.</h2>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:14px;padding:16px;margin-bottom:16px;">
      <div style="font-size:15px;font-weight:700;color:#0F172A;">${escapeHtml(payload.intervention.title)}</div>
      <div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;margin-top:6px;">${escapeHtml(categoryLabel)}</div>
      <div style="margin-top:12px;font-size:12px;color:#64748b;">Rapport :</div>
      <div style="font-size:14px;color:#0F172A;margin-top:4px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(report ?? "")}</div>
      ${adminPhotosHtml}
    </div>
    <p style="font-size:13px;color:#94A3B8;">Retrouvez le détail dans l'application Maintena.</p>
  </div>
</div></body></html>`,
          });
        } catch (adminMailErr) {
          console.warn("Notification admin report failed:", adminMailErr);
        }
      }

      if (isFormPost) return res.redirect(`/guest-intervention/${token}`);
      return res.json({ success: true });
    } catch (e: any) {
      console.error("guest report error:", e);
      if (isFormPost) return res.redirect(`/guest-intervention/${token}?error=erreur_serveur`);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  app.get("/guest-intervention/:token", async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const payload = await buildGuestInterventionPayload(token);

    if (payload.status !== 200) {
      return res.status(payload.status).send(
        pageShell("Lien indisponible", `<div class="m-container"><div class="m-card"><h1>Lien indisponible</h1><p>${escapeHtml(payload.error)}</p></div></div>`)
      );
    }

    const pStatus = payload.intervention.providerStatus; // "pending" | "accepted" | "refused"
    const reportLocked = !!payload.intervention.guestUpdatedAt;
    const dateStr = payload.intervention.date
      ? new Date(payload.intervention.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : "Non renseignée";

    const existingPhotosHtml = payload.intervention.completionPhotos.length > 0
      ? payload.intervention.completionPhotos.map((url: string) =>
          `<a href="${escapeHtml(url)}" target="_blank" style="display:block;margin:8px 0;color:#2563eb;">📷 Voir la photo</a>`
        ).join("")
      : `<p style="color:#64748b;font-size:14px;">Aucune photo envoyée.</p>`;

    // Zones de nettoyage
    const isNettoyage = payload.intervention.category === "nettoyage";
    const effectiveBuildingConfig = payload.copro.buildingConfig ?? DEFAULT_BUILDING_CONFIG_SERVER;
    const cleaningAreas = isNettoyage
      ? generateCleaningAreasServer(effectiveBuildingConfig)
      : [];
    const checklist = payload.intervention.cleaningChecklist;

    const groupedAreas: Record<string, typeof cleaningAreas> = {};
    cleaningAreas.forEach((area) => {
      if (!groupedAreas[area.group]) groupedAreas[area.group] = [];
      groupedAreas[area.group].push(area);
    });

    const cleaningZonesHtml = cleaningAreas.length > 0 ? `
      <div style="background:#fff;border-radius:18px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,0.08);margin-bottom:20px;">
        <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:6px;">Zones de nettoyage</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:18px;">Cochez les zones effectuées lors de cette intervention.</div>
        ${Object.entries(groupedAreas).map(([group, areas]) => `
          <div style="margin-bottom:16px;">
            <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">${escapeHtml(group)}</div>
            ${areas.map(area => {
              const checked = checklist[area.id] === true;
              return `<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:background 0.15s;${checked ? "background:#f0fdf4;" : "background:#f8fafc;"}margin-bottom:6px;">
                <input type="checkbox" name="zone_${escapeHtml(area.id)}" data-zone="${escapeHtml(area.id)}" ${checked ? "checked" : ""} style="width:18px;height:18px;accent-color:#10b981;cursor:pointer;" onchange="onZoneChange(this)" />
                <span style="font-size:14px;color:#0f172a;">${escapeHtml(area.label)}</span>
              </label>`;
            }).join("")}
          </div>
        `).join("")}
        <div id="zone-count" style="font-size:13px;color:#64748b;margin-top:8px;"></div>
      </div>` : "";

    const statusOptions = [
      ["en_cours", "En cours"],
      ["termine", "Terminée"],
    ].map(([value, label]) =>
      `<option value="${value}" ${payload.intervention.status === value ? "selected" : ""}>${label}</option>`
    ).join("");

    const isRecurring = !!payload.intervention.recurrenceGroupId;

    // Bouton refus — formulaire natif (pas d'AJAX, fonctionne sans JS)
    const refuseBlock = (pStatus !== "refused" && !isRecurring && !reportLocked) ? `
      <div style="background:#fff;border-radius:18px;padding:22px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.08);margin-bottom:20px;border:1.5px solid #fee2e2;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <p style="font-size:15px;color:#64748b;margin:0;">Vous ne pouvez pas intervenir sur cette mission ?</p>
        <form method="POST" action="/api/public/intervention/${token}/refuse" onsubmit="return confirm('Confirmer le refus de cette mission ?')" style="margin:0;">
          <button type="submit" style="background:#fff;color:#ef4444;border:2px solid #ef4444;border-radius:12px;padding:12px 22px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;">
            ✗ Refuser la mission
          </button>
        </form>
      </div>` : "";

    // Bannière si déjà refusée
    const statusBanner = pStatus === "refused"
      ? `<div style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:18px;padding:22px 24px;margin-bottom:20px;display:flex;align-items:flex-start;gap:14px;"><span style="font-size:24px;flex-shrink:0;">❌</span><div><div style="font-weight:800;color:#991b1b;font-size:16px;margin-bottom:4px;">Vous avez refusé cette mission</div><div style="font-size:14px;color:#b91c1c;">L'administrateur a été notifié. Cette page n'est plus accessible.</div></div></div>`
      : "";

    const body = `
<div class="m-container">

  ${statusBanner}
  ${refuseBlock}

  <!-- Fiche intervention -->
  <div style="background:#fff;border-radius:18px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,0.08);margin-bottom:20px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
      <div style="display:inline-block;background:#dbeafe;color:#1d4ed8;border-radius:999px;padding:5px 14px;font-size:12px;font-weight:700;">Intervention</div>
      <div style="display:inline-block;background:#f1f5f9;color:#475569;border-radius:999px;padding:5px 14px;font-size:12px;font-weight:600;">${escapeHtml(CATEGORY_LABELS_SERVER[payload.intervention.category] ?? payload.intervention.category)}</div>
    </div>
    <h1 style="font-size:24px;font-weight:800;color:#0f172a;margin:0 0 6px;">${escapeHtml(payload.intervention.title)}</h1>
    <p style="color:#64748b;font-size:14px;margin:0 0 20px;">${escapeHtml(payload.copro.name)}${payload.copro.address ? ` · ${escapeHtml(payload.copro.address)}` : ""}</p>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;">
      <div style="background:#f8fafc;border-radius:12px;padding:14px;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Prestataire</div>
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(payload.provider.name)}</div>
        <div style="font-size:13px;color:#64748b;">${escapeHtml(payload.provider.email)}</div>
      </div>
      <div style="background:#f8fafc;border-radius:12px;padding:14px;">
        <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Date prévue</div>
        <div style="font-weight:600;color:#0f172a;">${escapeHtml(dateStr)}</div>
      </div>
    </div>

    <div style="background:#f8fafc;border-radius:12px;padding:14px;">
      <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Description</div>
      <div style="font-size:15px;color:#0f172a;line-height:1.6;">${escapeHtml(payload.intervention.description || "Aucune description fournie.")}</div>
    </div>
    ${payload.intervention.photos.length > 0 ? `<div style="background:#f8fafc;border-radius:12px;padding:14px;margin-top:12px;">
      <div style="font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Photos jointes par l'administrateur</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">${payload.intervention.photos.map((url: string) =>
        `<a href="${escapeHtml(url)}" target="_blank" style="display:block;"><img src="${escapeHtml(url)}" alt="photo" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;" /></a>`
      ).join("")}</div>
    </div>` : ""}
  </div>

  ${cleaningZonesHtml}

  <!-- Compte-rendu — masqué si l'intervention est refusée -->
  ${pStatus !== "refused" ? `<div style="background:#fff;border-radius:18px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,0.08);margin-bottom:20px;">
    <div style="font-size:18px;font-weight:800;color:#0f172a;margin-bottom:18px;">Compte-rendu d'intervention</div>

    ${reportLocked ? `
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:16px 18px;margin-bottom:18px;display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">✅</span>
      <div>
        <div style="font-weight:700;color:#166534;">Compte-rendu déjà soumis</div>
        <div style="font-size:13px;color:#15803d;">Ce rapport a déjà été transmis. Aucune modification n'est possible.</div>
      </div>
    </div>
    <div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Rapport</div>
      <div style="font-size:14px;color:#0f172a;">${escapeHtml(payload.intervention.interventionReport || "Aucun rapport saisi.")}</div>
    </div>
    ${payload.intervention.interventionRemaining ? `<div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:10px;">
      <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Travaux restants</div>
      <div style="font-size:14px;color:#0f172a;">${escapeHtml(payload.intervention.interventionRemaining)}</div>
    </div>` : ""}
    <div style="margin-top:16px;">
      <div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:10px;">Photos envoyées</div>
      <div>${existingPhotosHtml}</div>
    </div>
    ` : `
    <form id="report-form" method="POST" enctype="multipart/form-data" action="/api/public/intervention/${token}/report" onsubmit="handleSubmit(event); return false;">
      <input type="hidden" name="cleaningChecklist" id="cleaningChecklistInput" value="${escapeHtml(JSON.stringify(payload.intervention.cleaningChecklist || {}))}" />

      <label class="m-label" for="status">Statut</label>
      <select id="status" name="status" class="m-input">${statusOptions}</select>

      <label class="m-label" for="report">Rapport d'intervention *</label>
      <textarea id="report" name="report" class="m-input" style="min-height:120px;resize:vertical;" placeholder="Décrivez ce que vous avez réalisé...">${escapeHtml(payload.intervention.interventionReport || "")}</textarea>

      <label class="m-label" for="interventionRemaining">Travaux restants (si applicable)</label>
      <textarea id="interventionRemaining" name="interventionRemaining" class="m-input" style="min-height:80px;resize:vertical;" placeholder="Ce qu'il reste à faire...">${escapeHtml(payload.intervention.interventionRemaining || "")}</textarea>

      <label class="m-label" for="photoInput">📷 Photo de preuve (optionnel)</label>
      <input id="photoInput" type="file" name="photo" accept="image/*" class="m-input" />

      <div id="photosList" style="margin-top:10px;margin-bottom:4px;">${existingPhotosHtml}</div>

      <button type="submit" id="submitBtn" class="m-btn" style="margin-top:14px;">✓ Enregistrer le compte-rendu</button>

      <div class="m-error" id="error" style="display:none;"></div>
    </form>
    `}
  </div>` : ""}

  <!-- Créer son compte -->
  <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:18px;padding:22px;text-align:center;margin-bottom:20px;">
    <div style="font-weight:700;color:#1d4ed8;margin-bottom:6px;">Finalisez votre compte Maintena</div>
    <p style="font-size:14px;color:#3b82f6;margin:0 0 14px;">Accédez à toutes vos interventions depuis l'application.</p>
    <a href="${escapeHtml(payload.links.completeAccountLink)}" class="m-btn" style="display:inline-block;text-decoration:none;padding:12px 24px;">Créer mon compte →</a>
  </div>

</div>

<script>
  const TOKEN = '${token}';

  async function respond(action) {
    const btnRefuse = document.getElementById('btn-refuse');
    const msg = document.getElementById('respond-msg');

    if (btnRefuse) {
      btnRefuse.disabled = true;
      btnRefuse.textContent = 'Envoi en cours…';
    }

    try {
      const res = await fetch('/api/public/intervention/' + TOKEN + '/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || 'Erreur serveur (' + res.status + ')');

      window.location.reload();
    } catch (e) {
      const errMsg = (e && e.message) ? e.message : 'Erreur réseau — vérifiez votre connexion.';
      if (msg) {
        msg.textContent = errMsg;
        msg.style.display = 'block';
        msg.style.background = '#fee2e2';
        msg.style.color = '#991b1b';
      } else {
        alert('Erreur : ' + errMsg);
      }
      if (btnRefuse) {
        btnRefuse.disabled = false;
        btnRefuse.textContent = '✗ Refuser la mission';
      }
    }
  }

  // Zones de nettoyage — état local des checkboxes
  let cleaningChecklist = ${JSON.stringify(payload.intervention.cleaningChecklist)};

  function onZoneChange(checkbox) {
    const zoneId = checkbox.dataset.zone;
    cleaningChecklist[zoneId] = checkbox.checked;
    const label = checkbox.closest('label');
    if (label) label.style.background = checkbox.checked ? '#f0fdf4' : '#f8fafc';
    updateZoneCount();
  }

  function updateZoneCount() {
    const countEl = document.getElementById('zone-count');
    if (!countEl) return;
    const total = Object.keys(cleaningChecklist).length;
    const done = Object.values(cleaningChecklist).filter(Boolean).length;
    countEl.textContent = done + ' / ' + total + ' zones effectuées';
  }

  updateZoneCount();

  function handleSubmit(event) {
    if (event) event.preventDefault();
    var errorEl = document.getElementById('error');
    if (errorEl) errorEl.style.display = 'none';

    var reportEl = document.getElementById('report');
    var reportText = reportEl ? reportEl.value.trim() : '';
    if (!reportText) {
      if (errorEl) { errorEl.textContent = 'Veuillez remplir le rapport d\'intervention.'; errorEl.style.display = 'block'; }
      return false;
    }

    var checklistInput = document.getElementById('cleaningChecklistInput');
    if (checklistInput) checklistInput.value = JSON.stringify(cleaningChecklist);

    var submitBtn = document.getElementById('submitBtn');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Envoi en cours...'; }

    document.getElementById('report-form').submit();
    return false;
  }
</script>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(pageShell(`Intervention — ${escapeHtml(payload.intervention.title)}`, body, `← ${escapeHtml(payload.copro.name)}`, "/"));
  });

  app.get("/guest-complete-account/:token", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));

    if (payload.status !== 200) {
      return res.status(payload.status).send(
        pageShell("Lien indisponible", `<div class="m-container"><div class="m-card"><h1>Lien indisponible</h1><p>${escapeHtml(payload.error)}</p></div></div>`)
      );
    }

    const completeAccountToken = req.params.token;
    const hasActivationCode = !!payload.invite.data.activationCode;
    const codeAlreadyUsed = payload.invite.data.activationCodeUsed === true;

    const body = `
<div class="m-container">
  <div class="m-card" style="margin-bottom:20px;">
    <h1 style="font-size:26px;font-weight:800;color:#0f172a;margin:0 0 8px;">Finaliser mon compte</h1>
    <p style="color:#64748b;font-size:14px;margin:0;">Vos informations ont déjà été enregistrées. Entrez votre code d’activation et choisissez un mot de passe.</p>
  </div>

  ${codeAlreadyUsed ? `
  <div class="m-card">
    <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:12px;padding:18px 20px;display:flex;align-items:center;gap:14px;">
      <span style="font-size:24px;">✅</span>
      <div>
        <div style="font-weight:700;color:#065f46;margin-bottom:4px;">Compte déjà finalisé</div>
        <div style="font-size:14px;color:#047857;">Votre mot de passe a déjà été défini. Connectez-vous directement à l’application Maintena avec votre email et mot de passe.</div>
      </div>
    </div>
  </div>` : `
  <div class="m-card">
    <label class="m-label">Prénom</label>
    <input class="m-input" value="${escapeHtml(payload.provider.firstName || "")}" disabled />

    <label class="m-label">Nom</label>
    <input class="m-input" value="${escapeHtml(payload.provider.lastName || "")}" disabled />

    <label class="m-label">Email</label>
    <input class="m-input" value="${escapeHtml(payload.provider.email || "")}" disabled />

    ${hasActivationCode ? `
    <div style="background:#f0fdf4;border:2px solid #6ee7b7;border-radius:12px;padding:16px 18px;margin:18px 0 4px;">
      <div style="font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">🔑 Code d’activation</div>
      <div style="font-size:13px;color:#047857;margin-bottom:10px;">Reportez le code reçu dans votre email d’invitation (8 caractères, ex : A7XK2PBM).</div>
      <label class="m-label" for="activationCode" style="margin-top:0;">Code d’activation *</label>
      <input class="m-input" id="activationCode" type="text" placeholder="ex : A7XK2PBM" maxlength="8" autocomplete="off" style="text-transform:uppercase;letter-spacing:4px;font-size:20px;font-weight:700;font-family:monospace;" />
    </div>` : ""}

    <label class="m-label" for="password">Mot de passe</label>
    <input class="m-input" id="password" type="password" placeholder="Au moins 6 caractères" />

    <button class="m-btn" id="submitBtn">Créer mon compte</button>

    <div class="m-success" id="success" style="display:none;">Compte créé avec succès. Vous pouvez maintenant vous connecter à l’application.</div>
    <div class="m-error" id="error" style="display:none;"></div>
  </div>`}
</div>

<script>
  const btn = document.getElementById(‘submitBtn’);
  const success = document.getElementById(‘success’);
  const error = document.getElementById(‘error’);

  if (btn) btn.addEventListener(‘click’, async () => {
    if (success) success.style.display = ‘none’;
    if (error) error.style.display = ‘none’;
    const password = document.getElementById(‘password’) ? document.getElementById(‘password’).value : ‘’;
    if (!password || password.length < 6) {
      if (error) { error.textContent = ‘Le mot de passe doit contenir au moins 6 caractères.’; error.style.display = ‘block’; }
      return;
    }
    const activationCodeEl = document.getElementById(‘activationCode’);
    const activationCode = activationCodeEl ? activationCodeEl.value.trim().toUpperCase() : ‘’;
    if (activationCodeEl && !activationCode) {
      if (error) { error.textContent = ‘Veuillez entrer votre code d\\’activation (reçu par email).’; error.style.display = ‘block’; }
      return;
    }
    btn.disabled = true;
    btn.textContent = ‘Création en cours...’;
    try {
      const res = await fetch(‘/api/public/complete-account/${completeAccountToken}’, {
        method: ‘POST’,
        headers: { ‘Content-Type’: ‘application/json’ },
        body: JSON.stringify({ password, activationCode: activationCode || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ‘Erreur’);
      if (success) success.style.display = ‘block’;
      btn.style.display = ‘none’;
    } catch (e) {
      if (error) { error.textContent = e.message || ‘Erreur création compte’; error.style.display = ‘block’; }
      btn.disabled = false;
      btn.textContent = ‘Créer mon compte’;
    }
  });
</script>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(pageShell("Finaliser mon compte — Maintena", body, "← Retour", "/"));
  });

  // ── Demandes de devis ────────────────────────────────────────────────────────

  app.post("/api/demande-devis/send-requests", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization ?? "";
      const idToken = authHeader.replace("Bearer ", "");
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase Admin unavailable" });
      const { uid } = await adminAuth.verifyIdToken(idToken);

      const { coProId, demandeId, contactIds } = req.body as {
        coProId?: string; demandeId?: string; contactIds?: string[];
      };
      if (!coProId || !demandeId || !Array.isArray(contactIds) || contactIds.length === 0) {
        return res.status(400).json({ error: "coProId, demandeId et contactIds requis" });
      }
      if (contactIds.length > 3) return res.status(400).json({ error: "Maximum 3 prestataires" });

      const db = getAdminDb()!;
      const demandeRef = db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId);
      const demandeSnap = await demandeRef.get();
      if (!demandeSnap.exists) return res.status(404).json({ error: "Demande introuvable" });
      const demande = demandeSnap.data()!;

      // Vérifier que l'utilisateur est admin de cette copro
      const memberSnap = await db.collection("copros").doc(coProId).collection("members").doc(uid).get();
      if (!memberSnap.exists || !["admin", "conseil"].includes(memberSnap.data()?.role)) {
        return res.status(403).json({ error: "Non autorisé" });
      }

      const coProSnap = await db.collection("copros").doc(coProId).get();
      const coProName = coProSnap.data()?.name ?? "Copropriété";
      const coProAddress = coProSnap.data()?.address ?? "";

      const crypto = await import("crypto");
      const baseUrl = getBaseUrl(req);

      // Charger les contacts sélectionnés
      const contactSnaps = await Promise.all(
        contactIds.map((id) => db.collection("copros").doc(coProId).collection("providerContacts").doc(id).get())
      );

      // Construire les nouvelles offres (garder les offres existantes soumises)
      const existingDevis: any[] = demande.devis ?? [];
      const newDevis: any[] = existingDevis.filter((o: any) => o.submitted); // garder devis déjà reçus

      const emailsToSend: { to: string; name: string; link: string; token: string; offerId: string }[] = [];

      for (const snap of contactSnaps) {
        if (!snap.exists) continue;
        const contact = snap.data()!;
        if (!contact.email) continue;

        // Si offre déjà soumise pour ce contact, skip
        const alreadySubmitted = existingDevis.find((o: any) => o.contactId === snap.id && o.submitted);
        if (alreadySubmitted) { newDevis.push(alreadySubmitted); continue; }

        const token = crypto.default.randomBytes(20).toString("hex");
        const offerId = snap.id + "_" + Date.now();

        const offer = {
          id: offerId,
          contactId: snap.id,
          contactName: `${contact.firstName} ${contact.lastName}`,
          contactCompany: contact.company ?? "",
          contactEmail: contact.email,
          token,
          submitted: false,
        };
        newDevis.push(offer);

        // Stocker le token dans une collection dédiée pour lookup public
        await db.collection("devisTokens").doc(token).set({
          coProId, demandeId, offerId, token,
          contactName: offer.contactName,
          contactCompany: offer.contactCompany,
          createdAt: new Date().toISOString(),
        });

        emailsToSend.push({
          to: contact.email,
          name: `${contact.firstName} ${contact.lastName}`,
          link: `${baseUrl}/devis-form/${token}`,
          token, offerId,
        });
      }

      await demandeRef.update({ devis: newDevis, status: "devis_demandes" });

      // Envoyer les emails
      let resendClient: any;
      try { resendClient = await getUncachableResendClient(); } catch (e: any) {
        console.warn("[devis] Resend non disponible:", e?.message);
      }

      if (resendClient) {
        await Promise.all(emailsToSend.map(({ to, name, link }) =>
          resendClient.client.emails.send({
            from: resendClient.fromEmail ?? "Maintena <noreply@maintena-pro.fr>",
            to,
            subject: `Demande de devis — ${escapeHtml(demande.title)} (${escapeHtml(coProName)})`,
            html: `
<!DOCTYPE html><html lang="fr"><body style="font-family:sans-serif;background:#f8fafc;padding:32px 16px">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <p style="color:#0f172a;font-size:15px;margin:0 0 6px 0">Bonjour ${escapeHtml(name)},</p>

  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0">
    Nous vous sollicitons afin d'établir un devis pour la prestation décrite ci-dessous.
  </p>

  <div style="background:#f1f5f9;border-left:4px solid #2563EB;border-radius:0 10px 10px 0;padding:16px 20px;margin:0 0 24px 0">
    <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 6px 0">${escapeHtml(demande.title)}</p>
    ${demande.description ? `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 8px 0">${escapeHtml(demande.description)}</p>` : ""}
    <p style="color:#64748b;font-size:13px;margin:0">
      Résidence&nbsp;: <strong>${escapeHtml(coProName)}</strong>${coProAddress ? `&nbsp;·&nbsp;${escapeHtml(coProAddress)}` : ""}
      ${demande.urgency === "urgent" ? `&nbsp;&nbsp;<span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">⚡ Urgent</span>` : ""}
    </p>
  </div>

  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0">
    Pour nous transmettre votre réponse, merci de cliquer sur le bouton ci-dessous&nbsp;:
  </p>

  <a href="${link}" style="display:block;background:#2563EB;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-weight:700;margin:20px 0;font-size:16px;letter-spacing:0.2px">
    📎&nbsp;&nbsp;Déposer mon devis
  </a>

  <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px 0">
    Lors du dépôt de votre devis, nous vous remercions de&nbsp;:
  </p>
  <ul style="color:#374151;font-size:14px;line-height:1.8;margin:0 0 20px 0;padding-left:20px">
    <li>joindre votre devis au format PDF (ou image&nbsp;: JPG, PNG)&nbsp;;</li>
    <li>renseigner obligatoirement le <strong>montant TTC</strong> de votre offre.</li>
  </ul>

  <p style="color:#374151;font-size:14px;margin:0 0 24px 0">
    Votre devis sera automatiquement enregistré dans notre système.
  </p>

  <p style="color:#94a3b8;font-size:13px;margin:0 0 6px 0">
    Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:
  </p>
  <p style="color:#2563eb;font-size:12px;word-break:break-all;margin:0 0 24px 0">${link}</p>

  <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px 0" />
  <p style="color:#374151;font-size:14px;margin:0">
    Nous vous remercions par avance pour votre retour.<br/>
    <strong>Cordialement,</strong><br/>
    <span style="color:#64748b">L'équipe Maintena — ${escapeHtml(coProName)}</span>
  </p>

</div>
</body></html>`
          }).then((r: any) => console.log("[devis email] Envoyé à", to, r?.id ?? ""))
            .catch((e: any) => console.error("[devis email] Échec envoi à", to, ":", e?.message ?? e))
        ));
      }

      return res.json({ sent: emailsToSend.length, total: newDevis.length });
    } catch (e: any) {
      console.error("/api/demande-devis/send-requests error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Retenir un devis + notifier le prestataire par email pour signature ──
  app.post("/api/demande-devis/retain", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization ?? "";
      const idToken = authHeader.replace("Bearer ", "");
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase Admin unavailable" });
      const { uid } = await adminAuth.verifyIdToken(idToken);

      const { coProId, demandeId, offerId } = req.body as { coProId?: string; demandeId?: string; offerId?: string };
      if (!coProId || !demandeId || !offerId) return res.status(400).json({ error: "coProId, demandeId et offerId requis" });

      const db = getAdminDb()!;

      // Vérifier que l'utilisateur est admin
      const memberSnap = await db.collection("copros").doc(coProId).collection("members").doc(uid).get();
      if (!memberSnap.exists || memberSnap.data()?.role !== "admin") {
        return res.status(403).json({ error: "Seul l'administrateur peut valider un devis" });
      }

      const demandeRef = db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId);
      const demandeSnap = await demandeRef.get();
      if (!demandeSnap.exists) return res.status(404).json({ error: "Demande introuvable" });
      const demande = demandeSnap.data()!;

      const devis: any[] = demande.devis ?? [];
      const offerIdx = devis.findIndex((o: any) => o.id === offerId);
      if (offerIdx === -1) return res.status(404).json({ error: "Devis introuvable" });
      const offer = devis[offerIdx];

      // Générer un token de signature unique
      const { randomBytes } = await import("crypto");
      const signatureToken = randomBytes(24).toString("hex");

      // Mettre à jour le devis avec le token de signature
      devis[offerIdx] = { ...offer, signatureToken };
      await demandeRef.update({
        selectedDevisId: offerId,
        status: "cloture",
        closedAt: new Date().toISOString(),
        devis,
      });

      // Stocker le token de signature
      await db.collection("devisTokens").doc(signatureToken).set({
        type: "signature",
        coProId, demandeId, offerId,
        contactName: offer.contactName,
        contactEmail: offer.contactEmail,
        createdAt: new Date().toISOString(),
      });

      // Envoyer email de notification au prestataire retenu
      const coProSnap = await db.collection("copros").doc(coProId).get();
      const coProName = coProSnap.data()?.name ?? "Résidence";
      const baseUrl = getBaseUrl(req);
      const signLink = `${baseUrl}/sign-devis/${signatureToken}`;

      let resendClient: any;
      try { resendClient = await getUncachableResendClient(); } catch {}

      if (resendClient && offer.contactEmail) {
        await resendClient.client.emails.send({
          from: resendClient.fromEmail ?? "Maintena <noreply@maintena-pro.fr>",
          to: offer.contactEmail,
          subject: `Votre devis a été retenu — ${escapeHtml(demande.title)} (${escapeHtml(coProName)})`,
          html: `
<!DOCTYPE html><html lang="fr"><body style="font-family:sans-serif;background:#f8fafc;padding:32px 16px">
<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 32px;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <div style="text-align:center;margin-bottom:28px">
    <div style="display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;background:#DCFCE7;border-radius:50%;margin-bottom:12px">
      <span style="font-size:32px">🏆</span>
    </div>
    <h2 style="color:#16A34A;margin:0;font-size:22px">Votre devis a été retenu !</h2>
  </div>

  <p style="color:#374151;font-size:15px;margin:0 0 8px 0">Bonjour <strong>${escapeHtml(offer.contactName)}</strong>,</p>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 20px 0">
    Nous avons le plaisir de vous informer que votre devis a été <strong>sélectionné</strong> pour la prestation suivante&nbsp;:
  </p>

  <div style="background:#f1f5f9;border-left:4px solid #16A34A;border-radius:0 10px 10px 0;padding:16px 20px;margin:0 0 24px 0">
    <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 6px 0">${escapeHtml(demande.title)}</p>
    ${demande.description ? `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 8px 0">${escapeHtml(demande.description)}</p>` : ""}
    <p style="color:#64748b;font-size:13px;margin:0">
      Résidence&nbsp;: <strong>${escapeHtml(coProName)}</strong>
      &nbsp;&nbsp;·&nbsp;&nbsp;Montant retenu&nbsp;: <strong>${offer.priceTTC?.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) ?? "—"} TTC</strong>
    </p>
  </div>

  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 8px 0">
    Pour finaliser votre acceptation, merci de <strong>signer électroniquement</strong> le bon de commande en cliquant sur le bouton ci-dessous&nbsp;:
  </p>

  <a href="${signLink}" style="display:block;background:#16A34A;color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:12px;font-weight:700;margin:20px 0;font-size:16px">
    ✍️&nbsp;&nbsp;Signer le bon de commande
  </a>

  <p style="color:#94a3b8;font-size:13px;margin:0 0 6px 0">
    Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:
  </p>
  <p style="color:#2563eb;font-size:12px;word-break:break-all;margin:0 0 24px 0">${signLink}</p>

  <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 20px 0" />
  <p style="color:#374151;font-size:14px;margin:0">
    Nous vous remercions pour votre confiance.<br/>
    <strong>Cordialement,</strong><br/>
    <span style="color:#64748b">L'équipe Maintena — ${escapeHtml(coProName)}</span>
  </p>
</div>
</body></html>`
        }).catch((e: any) => console.error("[signature email] Échec:", e?.message));
      }

      return res.json({ ok: true, signLink });
    } catch (e: any) {
      console.error("/api/demande-devis/retain error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Signature admin/syndic (depuis l'app) ──
  app.post("/api/demande-devis/admin-sign", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers["authorization"];
      const idToken = typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/, "") : "";
      const adminAuth = getAdminAuthInstance();
      if (!adminAuth) return res.status(503).json({ error: "Firebase Admin unavailable" });
      const { uid } = await adminAuth.verifyIdToken(idToken);

      const { coProId, demandeId, offerId, svgBase64 } = req.body as {
        coProId: string; demandeId: string; offerId: string; svgBase64: string;
      };
      if (!coProId || !demandeId || !offerId || !svgBase64) {
        return res.status(400).json({ error: "Paramètres manquants" });
      }

      const db = getAdminDb();
      if (!db) return res.status(503).json({ error: "Firebase Admin unavailable" });

      const memberSnap = await db.collection("copros").doc(coProId).collection("members").doc(uid).get();
      if (!memberSnap.exists || memberSnap.data()?.role !== "admin") {
        return res.status(403).json({ error: "Accès réservé à l'administrateur" });
      }

      const demandeRef = db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId);
      const demandeSnap = await demandeRef.get();
      if (!demandeSnap.exists) return res.status(404).json({ error: "Demande introuvable" });

      const devis: any[] = demandeSnap.data()!.devis ?? [];
      const idx = devis.findIndex((o: any) => o.id === offerId);
      if (idx === -1) return res.status(404).json({ error: "Devis introuvable" });

      let adminSignatureUrl: string | undefined;
      const bucket = getAdminStorage();
      if (bucket) {
        const { randomBytes } = await import("crypto");
        const downloadToken = randomBytes(16).toString("hex");
        const storagePath = `signatures/${coProId}/${demandeId}/${offerId}_admin.svg`;
        const svgBuffer = Buffer.from(svgBase64, "base64");
        await bucket.file(storagePath).save(svgBuffer, {
          metadata: {
            contentType: "image/svg+xml",
            metadata: { firebaseStorageDownloadTokens: downloadToken },
          },
        });
        const bucketName = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
        adminSignatureUrl = makeFirebaseStorageUrl(bucketName, storagePath, downloadToken);
      }

      const adminSignedAt = new Date().toISOString();
      devis[idx] = { ...devis[idx], adminSignatureUrl, adminSignedAt };
      await demandeRef.update({ devis });

      // Récupérer les données copro pour la génération du PDF
      const coProSnap = await db.collection("copros").doc(coProId).get();
      const coProData = coProSnap.data() ?? {};

      console.log(`[admin-sign] Devis ${offerId} signé par syndic pour ${coProId}/${demandeId}`);

      // Générer le PDF signé de manière synchrone (Cloud Run throttle le CPU après res.json)
      await generateSignedDevisPdf({
        offer: devis[idx],
        demande: demandeSnap.data()!,
        coProData,
        coProId,
        demandeId,
        demandeRef,
      });

      return res.json({ ok: true, adminSignedAt, adminSignatureUrl });
    } catch (e: any) {
      console.error("/api/demande-devis/admin-sign error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });

  // ── Bon de commande signé (prestataire + syndic) ──
  app.get("/bon-de-commande/:token", async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const db = getAdminDb();
    if (!db) return res.status(503).send(pageShell("Indisponible", `<div class="m-container"><div class="m-card"><h1>Service indisponible</h1></div></div>`));

    const tokenSnap = await db.collection("devisTokens").doc(token).get();
    if (!tokenSnap.exists || tokenSnap.data()?.type !== "signature") {
      return res.status(404).send(pageShell("Lien invalide", `<div class="m-container"><div class="m-card"><h1>Lien invalide ou expiré</h1></div></div>`));
    }
    const { coProId, demandeId, offerId } = tokenSnap.data()!;

    const [demandeSnap, coProSnap] = await Promise.all([
      db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId).get(),
      db.collection("copros").doc(coProId).get(),
    ]);
    if (!demandeSnap.exists) return res.status(404).send(pageShell("Introuvable", `<div class="m-container"><div class="m-card"><h1>Demande introuvable</h1></div></div>`));

    const demande = demandeSnap.data()!;
    const copro = coProSnap.data() ?? {};
    const offer = (demande.devis ?? []).find((o: any) => o.id === offerId);
    if (!offer) return res.status(404).send(pageShell("Introuvable", `<div class="m-container"><div class="m-card"><h1>Devis introuvable</h1></div></div>`));

    const coProAddress = [copro.street, copro.postalCode, copro.city].filter(Boolean).join(", ");
    const dateAccept = offer.closedAt
      ? new Date(offer.closedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
      : demande.closedAt
      ? new Date(demande.closedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
      : new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

    const fmtDate = (iso: string) =>
      new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const fmtPrice = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

    const bothSigned = !!(offer.signedAt && offer.adminSignedAt);

    const body = `
<div style="max-width:680px;margin:0 auto;padding:24px 16px;font-family:'Helvetica Neue',Arial,sans-serif">

  <div style="text-align:center;margin-bottom:32px">
    <div style="font-size:13px;text-transform:uppercase;letter-spacing:2px;color:#64748b;margin-bottom:4px">Document officiel</div>
    <h1 style="font-size:28px;font-weight:800;color:#0f172a;margin:0">Bon de commande</h1>
    <div style="font-size:14px;color:#64748b;margin-top:6px">Acceptation de devis · ${escapeHtml(copro.name ?? "")}</div>
  </div>

  ${bothSigned ? `
  <div style="background:#DCFCE7;border:2px solid #86EFAC;border-radius:12px;padding:14px 20px;margin-bottom:24px;display:flex;align-items:center;gap:12px">
    <span style="font-size:22px">✅</span>
    <div>
      <div style="font-weight:700;color:#15803D;font-size:15px">Document signé par les deux parties</div>
      <div style="color:#166534;font-size:13px">Prestataire le ${fmtDate(offer.signedAt)} · Syndic le ${fmtDate(offer.adminSignedAt)}</div>
    </div>
  </div>` : `
  <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:12px;padding:14px 20px;margin-bottom:24px">
    <div style="font-weight:700;color:#92400E;font-size:14px">⚠️ Document en cours de signature</div>
    <div style="color:#78350F;font-size:13px;margin-top:4px">
      ${offer.signedAt ? `Prestataire : signé le ${fmtDate(offer.signedAt)}` : "Prestataire : signature en attente"}
      &nbsp;·&nbsp;
      ${offer.adminSignedAt ? `Syndic : signé le ${fmtDate(offer.adminSignedAt)}` : "Syndic : signature en attente"}
    </div>
  </div>`}

  <!-- Parties -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px">Donneur d'ordre</div>
      <div style="font-weight:700;font-size:15px;color:#0f172a">${escapeHtml(copro.name ?? "")}</div>
      ${coProAddress ? `<div style="color:#475569;font-size:13px;margin-top:4px">${escapeHtml(coProAddress)}</div>` : ""}
      <div style="color:#475569;font-size:13px;margin-top:2px">Syndic / Administrateur</div>
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:8px">Prestataire</div>
      <div style="font-weight:700;font-size:15px;color:#0f172a">${escapeHtml(offer.contactName ?? "")}</div>
      ${offer.contactCompany ? `<div style="color:#475569;font-size:13px;margin-top:4px">${escapeHtml(offer.contactCompany)}</div>` : ""}
      ${offer.contactEmail ? `<div style="color:#475569;font-size:13px;margin-top:2px">${escapeHtml(offer.contactEmail)}</div>` : ""}
    </div>
  </div>

  <!-- Objet de la prestation -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:10px">Objet de la prestation</div>
    <div style="font-weight:700;font-size:18px;color:#0f172a;margin-bottom:8px">${escapeHtml(demande.title ?? "")}</div>
    ${demande.description ? `<div style="color:#475569;font-size:14px;line-height:1.6;margin-bottom:12px">${escapeHtml(demande.description)}</div>` : ""}
    <div style="display:flex;gap:24px;margin-top:12px;padding-top:12px;border-top:1px solid #f1f5f9">
      <div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Date d'acceptation</div>
        <div style="font-weight:600;color:#0f172a;font-size:14px">${dateAccept}</div>
      </div>
      <div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:2px">Montant TTC retenu</div>
        <div style="font-weight:800;color:#0f172a;font-size:22px">${offer.priceTTC !== undefined ? fmtPrice(offer.priceTTC) : "—"}</div>
      </div>
    </div>
  </div>

  <!-- Devis original -->
  ${offer.devisFileUrl ? `
  <div style="margin-bottom:24px">
    <a href="${escapeHtml(offer.devisFileUrl)}" target="_blank" style="display:inline-flex;align-items:center;gap:8px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px 18px;text-decoration:none;color:#1D4ED8;font-weight:600;font-size:14px">
      📎 Voir le devis original (PDF)
    </a>
  </div>` : ""}

  <!-- Signatures -->
  <div style="margin-top:8px;margin-bottom:32px">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;margin-bottom:12px">Signatures</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

      <!-- Signature prestataire -->
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Prestataire</div>
        <div style="font-weight:700;color:#0f172a;margin-bottom:6px">${escapeHtml(offer.contactName ?? "")}</div>
        ${offer.signatureUrl ? `
        <div style="border:1px solid #D1FAE5;border-radius:8px;background:#F0FDF4;padding:6px;margin:10px 0">
          <img src="${escapeHtml(offer.signatureUrl)}" style="max-width:100%;max-height:120px;display:block;margin:0 auto" alt="Signature prestataire" />
        </div>
        <div style="font-size:12px;color:#16A34A">Signé le ${fmtDate(offer.signedAt)}</div>` : `
        <div style="border:1px dashed #D1D5DB;border-radius:8px;padding:20px;color:#9CA3AF;font-size:13px;margin:10px 0">
          Signature en attente
        </div>`}
      </div>

      <!-- Signature syndic -->
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;text-align:center">
        <div style="font-size:12px;color:#64748b;font-weight:600;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">Syndic / Administrateur</div>
        <div style="font-weight:700;color:#0f172a;margin-bottom:6px">${escapeHtml(copro.name ?? "")}</div>
        ${offer.adminSignatureUrl ? `
        <div style="border:1px solid #DDD6FE;border-radius:8px;background:#F5F3FF;padding:6px;margin:10px 0">
          <img src="${escapeHtml(offer.adminSignatureUrl)}" style="max-width:100%;max-height:120px;display:block;margin:0 auto" alt="Signature syndic" />
        </div>
        <div style="font-size:12px;color:#7C3AED">Signé le ${fmtDate(offer.adminSignedAt)}</div>` : `
        <div style="border:1px dashed #D1D5DB;border-radius:8px;padding:20px;color:#9CA3AF;font-size:13px;margin:10px 0">
          Signature en attente
        </div>`}
      </div>
    </div>
  </div>

  <div style="text-align:center;margin-bottom:16px">
    <button onclick="window.print()" style="background:#0f172a;color:#fff;border:none;border-radius:10px;padding:14px 28px;font-size:15px;font-weight:700;cursor:pointer">
      🖨️ Imprimer / Enregistrer en PDF
    </button>
  </div>

  <div style="text-align:center;color:#94a3b8;font-size:11px;line-height:1.6;margin-top:8px">
    Document généré par Maintena · Signature électronique conforme à l'article 1366 du Code civil<br/>
    Ce document constitue un engagement contractuel entre les deux parties.
  </div>
</div>

<style>
@media print {
  button { display: none !important; }
  body { background: white; }
}
</style>`;

    const syndicName = copro.syndicCompanyName
      ? escapeHtml(copro.syndicCompanyName)
      : `Syndicat des copropriétaires de ${escapeHtml(copro.name ?? "")}`;
    const syndicParts: string[] = [`© 2026 ${syndicName}`];
    if (copro.syndicSiret) syndicParts.push(`SIRET ${escapeHtml(copro.syndicSiret)}`);
    if (copro.syndicPhone) syndicParts.push(`<a href="tel:${escapeHtml(copro.syndicPhone.replace(/\s/g, ""))}">${escapeHtml(copro.syndicPhone)}</a>`);
    syndicParts.push(`Géré via <a href="https://maintena-pro.fr">Maintena</a>`);
    const syndicFooter = `<p>${syndicParts.join(" · ")}</p>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(pageShell(`Bon de commande — ${escapeHtml(demande.title ?? "")}`, body, "← Retour à l'accueil", "/", syndicFooter));
  });

  // ── Page de signature électronique ──
  app.get("/sign-devis/:token", async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const db = getAdminDb();
    if (!db) return res.status(503).send(pageShell("Indisponible", `<div class="m-container"><div class="m-card"><h1>Service indisponible</h1></div></div>`));

    const tokenSnap = await db.collection("devisTokens").doc(token).get();
    if (!tokenSnap.exists || tokenSnap.data()?.type !== "signature") {
      return res.status(404).send(pageShell("Lien invalide", `<div class="m-container"><div class="m-card"><h1>Lien invalide ou expiré</h1></div></div>`));
    }
    const { coProId, demandeId, offerId, contactName } = tokenSnap.data()!;

    const demandeSnap = await db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId).get();
    if (!demandeSnap.exists) return res.status(404).send(pageShell("Introuvable", `<div class="m-container"><div class="m-card"><h1>Demande introuvable</h1></div></div>`));
    const demande = demandeSnap.data()!;
    const offer = (demande.devis ?? []).find((o: any) => o.id === offerId);

    if (offer?.signedAt) {
      return res.send(pageShell("Déjà signé", `
<div class="m-container"><div class="m-card">
  <h1>✅ Bon de commande déjà signé</h1>
  <p>Vous avez signé ce bon de commande le <strong>${new Date(offer.signedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</strong>.</p>
  <p style="margin-top:12px;color:#64748b">Merci pour votre confiance.</p>
</div></div>`));
    }

    const coProSnap = await db.collection("copros").doc(coProId).get();
    const coProName = coProSnap.data()?.name ?? "Résidence";
    const coProAddress = coProSnap.data()?.address ?? "";
    const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

    const body = `
<div class="m-container">
  <div class="m-card">
    <h1>Bon de commande</h1>
    <p class="subtitle">${escapeHtml(coProName)}${coProAddress ? ` · ${escapeHtml(coProAddress)}` : ""}</p>

    <div style="background:#f1f5f9;border-left:4px solid #16A34A;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px">
      <p style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 6px 0">${escapeHtml(demande.title)}</p>
      ${demande.description ? `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 8px 0">${escapeHtml(demande.description)}</p>` : ""}
      <p style="color:#16A34A;font-size:15px;font-weight:700;margin:0">
        Montant retenu : ${offer?.priceTTC?.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) ?? "—"} TTC
      </p>
    </div>

    <p style="color:#374151;font-size:14px;margin-bottom:6px">Prestataire : <strong>${escapeHtml(contactName)}</strong></p>
    <p style="color:#374151;font-size:14px;margin-bottom:20px">Date : <strong>${today}</strong></p>

    <p style="color:#374151;font-size:15px;font-weight:600;margin-bottom:10px">Votre signature *</p>
    <p style="color:#64748b;font-size:13px;margin-bottom:12px">Signez dans le cadre ci-dessous avec votre doigt ou votre souris.</p>

    <div style="position:relative;margin-bottom:8px">
      <canvas id="sigCanvas" width="520" height="180"
        style="border:2px solid #2563eb;border-radius:12px;cursor:crosshair;touch-action:none;display:block;max-width:100%;background:#fff">
      </canvas>
      <button id="clearBtn" type="button"
        style="position:absolute;top:8px;right:8px;background:rgba(255,255,255,0.9);border:1px solid #cbd5e1;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;color:#64748b">
        Effacer
      </button>
    </div>
    <p style="color:#94a3b8;font-size:12px;margin-bottom:20px">En signant, vous acceptez les termes du bon de commande ci-dessus.</p>

    <button id="submitBtn"
      style="display:block;width:100%;background:#16A34A;color:#fff;border:none;padding:16px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:0.2px">
      ✅ Signer et valider
    </button>
    <div class="m-error" id="errMsg"></div>
    <div class="m-success" id="okMsg"></div>
  </div>
</div>
<script>
const canvas = document.getElementById("sigCanvas");
const ctx = canvas.getContext("2d");
ctx.strokeStyle = "#1e293b";
ctx.lineWidth = 2.5;
ctx.lineCap = "round";
ctx.lineJoin = "round";
let drawing = false, isEmpty = true;

function getPos(e) {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width / r.width;
  const scaleY = canvas.height / r.height;
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
}
canvas.addEventListener("mousedown",  (e) => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
canvas.addEventListener("mousemove",  (e) => { if (!drawing) return; isEmpty = false; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
canvas.addEventListener("mouseup",    () => drawing = false);
canvas.addEventListener("mouseleave", () => drawing = false);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
canvas.addEventListener("touchmove",  (e) => { e.preventDefault(); if (!drawing) return; isEmpty = false; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }, { passive: false });
canvas.addEventListener("touchend",   () => drawing = false);
document.getElementById("clearBtn").addEventListener("click", () => { ctx.clearRect(0, 0, canvas.width, canvas.height); isEmpty = true; });

document.getElementById("submitBtn").addEventListener("click", async () => {
  if (isEmpty) { const e = document.getElementById("errMsg"); e.textContent = "Veuillez signer avant de valider."; e.style.display = "block"; return; }
  const btn = document.getElementById("submitBtn");
  const errEl = document.getElementById("errMsg");
  const okEl = document.getElementById("okMsg");
  errEl.style.display = "none"; okEl.style.display = "none";
  btn.disabled = true; btn.textContent = "Envoi en cours…";
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData();
    fd.append("signature", blob, "signature.png");
    const r = await fetch("/sign-devis/${token}", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Erreur");
    okEl.textContent = "✅ Bon de commande signé avec succès. Merci !";
    okEl.style.display = "block";
    document.getElementById("sigCanvas").style.display = "none";
    document.getElementById("clearBtn").style.display = "none";
    btn.style.display = "none";
  } catch(err) {
    errEl.textContent = err.message;
    errEl.style.display = "block";
    btn.disabled = false; btn.textContent = "✅ Signer et valider";
  }
});
</script>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(pageShell("Signer le bon de commande — Maintena", body));
  });

  // ── Traitement de la signature ──
  const signatureUploadMiddleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

  app.post("/sign-devis/:token", signatureUploadMiddleware.single("signature"), async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Service indisponible" });

    const tokenSnap = await db.collection("devisTokens").doc(token).get();
    if (!tokenSnap.exists || tokenSnap.data()?.type !== "signature") {
      return res.status(404).json({ error: "Token invalide" });
    }
    const { coProId, demandeId, offerId } = tokenSnap.data()!;

    const demandeRef = db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId);
    const demandeSnap = await demandeRef.get();
    if (!demandeSnap.exists) return res.status(404).json({ error: "Demande introuvable" });

    const devis: any[] = demandeSnap.data()!.devis ?? [];
    const idx = devis.findIndex((o: any) => o.id === offerId);
    if (idx === -1) return res.status(404).json({ error: "Devis introuvable" });
    if (devis[idx].signedAt) return res.status(409).json({ error: "Déjà signé" });

    const signatureFile = (req as any).file as Express.Multer.File | undefined;
    if (!signatureFile) return res.status(400).json({ error: "Signature requise" });

    let signatureUrl: string | undefined;
    const bucket = getAdminStorage();
    if (bucket) {
      const { randomBytes } = await import("crypto");
      const downloadToken = randomBytes(16).toString("hex");
      const storagePath = `signatures/${coProId}/${demandeId}/${offerId}.png`;
      await bucket.file(storagePath).save(signatureFile.buffer, {
        metadata: {
          contentType: "image/png",
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const bucketName = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
      signatureUrl = makeFirebaseStorageUrl(bucketName, storagePath, downloadToken);
    }

    const signedAt = new Date().toISOString();
    devis[idx] = { ...devis[idx], signatureUrl, signedAt };
    await demandeRef.update({ devis });
    await db.collection("devisTokens").doc(token).update({ signedAt });

    console.log(`[signature] Devis ${offerId} signé pour ${coProId}/${demandeId}`);
    return res.json({ ok: true, signedAt });
  });

  // Formulaire public pour les prestataires
  app.get("/devis-form/:token", async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const db = getAdminDb();
    if (!db) return res.status(503).send(pageShell("Indisponible", `<div class="m-container"><div class="m-card"><h1>Service indisponible</h1></div></div>`));

    const tokenSnap = await db.collection("devisTokens").doc(token).get();
    if (!tokenSnap.exists) {
      return res.status(404).send(pageShell("Lien invalide", `<div class="m-container"><div class="m-card"><h1>Lien invalide</h1><p>Ce lien de devis est invalide ou a expiré.</p></div></div>`));
    }
    const tokenData = tokenSnap.data()!;
    const { coProId, demandeId } = tokenData;

    const demandeSnap = await db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId).get();
    if (!demandeSnap.exists) {
      return res.status(404).send(pageShell("Demande introuvable", `<div class="m-container"><div class="m-card"><h1>Demande introuvable</h1></div></div>`));
    }
    const demande = demandeSnap.data()!;
    const offer = (demande.devis ?? []).find((o: any) => o.token === token);
    if (!offer) return res.status(404).send(pageShell("Lien invalide", `<div class="m-container"><div class="m-card"><h1>Lien invalide</h1></div></div>`));

    if (offer.submitted) {
      return res.send(pageShell("Devis déjà soumis", `
<div class="m-container"><div class="m-card">
  <h1>✅ Devis déjà soumis</h1>
  <p>Vous avez déjà soumis un devis de <strong>${offer.priceTTC?.toLocaleString("fr-FR")} € TTC</strong> pour cette demande.</p>
  <p style="margin-top:12px;color:#64748b">Merci pour votre réponse.</p>
</div></div>`));
    }

    const coProSnap = await db.collection("copros").doc(coProId).get();
    const coProName = coProSnap.data()?.name ?? "Résidence";
    const coProAddress = coProSnap.data()?.address ?? "";

    const body = `
<div class="m-container">
  <div class="m-card">
    <h1>Demande de devis</h1>
    <p class="subtitle">${escapeHtml(coProName)}${coProAddress ? ` · ${escapeHtml(coProAddress)}` : ""}</p>

    <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:24px">
      <strong style="font-size:16px;color:#0f172a">${escapeHtml(demande.title)}</strong>
      ${demande.description ? `<p style="color:#475569;margin-top:8px;font-size:14px">${escapeHtml(demande.description)}</p>` : ""}
      ${demande.urgency === "urgent" ? `<span style="display:inline-block;margin-top:8px;background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700">⚡ Urgent</span>` : ""}
    </div>

    <p style="color:#374151;margin-bottom:20px">Bonjour <strong>${escapeHtml(tokenData.contactName)}</strong>, veuillez renseigner votre devis ci-dessous.</p>

    <form id="devisForm" enctype="multipart/form-data">
      <label class="m-label">Prix TTC *</label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
        <input class="m-input" type="number" id="priceTTC" name="priceTTC" min="0" step="0.01" placeholder="1 250,00" required style="flex:1;margin-bottom:0" />
        <span style="font-weight:700;font-size:18px;color:#64748b">€</span>
      </div>

      <label class="m-label">Document devis *<span style="font-size:12px;font-weight:400;color:#94a3b8"> (PDF, image — max 10 Mo)</span></label>
      <label id="fileLabel" style="display:flex;align-items:center;gap:10px;border:2px dashed #cbd5e1;border-radius:10px;padding:16px;cursor:pointer;background:#f8fafc;margin-bottom:16px;transition:border-color .2s">
        <span style="font-size:24px">📎</span>
        <span id="fileName" style="color:#64748b;font-size:14px">Cliquez pour choisir un fichier…</span>
        <input type="file" id="devisFile" name="devisFile" accept=".pdf,.jpg,.jpeg,.png,.webp" required style="display:none" />
      </label>

      <label class="m-label">Commentaire / Détail</label>
      <textarea class="m-input" id="description" name="description" rows="3" placeholder="Matériaux utilisés, délai d'intervention, conditions…" style="resize:vertical"></textarea>

      <button class="m-btn" type="submit">Envoyer mon devis</button>
    </form>
    <div class="m-error" id="errMsg"></div>
    <div class="m-success" id="okMsg"></div>
  </div>
</div>
<script>
document.getElementById("devisFile").addEventListener("change", function() {
  document.getElementById("fileName").textContent = this.files[0]?.name ?? "Aucun fichier";
  document.getElementById("fileLabel").style.borderColor = this.files[0] ? "#2563eb" : "#cbd5e1";
});
document.getElementById("devisForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  const btn = this.querySelector("button");
  const errEl = document.getElementById("errMsg");
  const okEl = document.getElementById("okMsg");
  errEl.style.display = "none"; okEl.style.display = "none";
  const price = parseFloat(document.getElementById("priceTTC").value);
  const file = document.getElementById("devisFile").files[0];
  if (!price || price <= 0) { errEl.textContent = "Veuillez saisir un montant TTC valide."; errEl.style.display="block"; return; }
  if (!file) { errEl.textContent = "Veuillez joindre votre document devis."; errEl.style.display="block"; return; }
  if (file.size > 10 * 1024 * 1024) { errEl.textContent = "Fichier trop volumineux (max 10 Mo)."; errEl.style.display="block"; return; }
  btn.disabled = true; btn.textContent = "Envoi en cours…";
  try {
    const fd = new FormData();
    fd.append("priceTTC", String(price));
    fd.append("description", document.getElementById("description").value);
    fd.append("devisFile", file);
    const r = await fetch("/devis-form/${escapeHtml(token)}", { method:"POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Erreur");
    okEl.textContent = "✅ Devis soumis avec succès. Merci !";
    okEl.style.display = "block";
    this.style.display = "none";
  } catch(err) {
    errEl.textContent = err.message;
    errEl.style.display = "block";
    btn.disabled = false; btn.textContent = "Envoyer mon devis";
  }
});
</script>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(pageShell("Soumettre mon devis — Maintena", body, "← Accueil", "/"));
  });

  const devisUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"];
      cb(null, allowed.includes(file.mimetype));
    },
  });

  app.post("/devis-form/:token", devisUploadMiddleware.single("devisFile"), async (req: Request, res: Response) => {
    const token = req.params.token as string;
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: "Service indisponible" });

    const tokenSnap = await db.collection("devisTokens").doc(token).get();
    if (!tokenSnap.exists) return res.status(404).json({ error: "Token invalide" });
    const { coProId, demandeId, offerId } = tokenSnap.data()!;

    const demandeRef = db.collection("copros").doc(coProId).collection("demandesDevis").doc(demandeId);
    const demandeSnap = await demandeRef.get();
    if (!demandeSnap.exists) return res.status(404).json({ error: "Demande introuvable" });

    const devis: any[] = demandeSnap.data()!.devis ?? [];
    const idx = devis.findIndex((o: any) => o.token === token);
    if (idx === -1) return res.status(404).json({ error: "Offre introuvable" });
    if (devis[idx].submitted) return res.status(409).json({ error: "Devis déjà soumis" });

    const priceTTC = parseFloat(req.body.priceTTC);
    if (isNaN(priceTTC) || priceTTC <= 0) return res.status(400).json({ error: "Prix TTC invalide" });

    const uploadedFile = (req as any).file as Express.Multer.File | undefined;
    if (!uploadedFile) return res.status(400).json({ error: "Document devis requis" });

    // Upload du fichier dans Firebase Storage
    let devisFileUrl: string | undefined;
    const bucket = getAdminStorage();
    if (bucket) {
      const ext = uploadedFile.originalname.split(".").pop() ?? "pdf";
      const storagePath = `devis/${coProId}/${demandeId}/${offerId ?? token}.${ext}`;
      const { randomBytes } = await import("crypto");
      const downloadToken = randomBytes(16).toString("hex");
      const fileRef = bucket.file(storagePath);
      await fileRef.save(uploadedFile.buffer, {
        metadata: {
          contentType: uploadedFile.mimetype,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      });
      const bucketName = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
      devisFileUrl = makeFirebaseStorageUrl(bucketName, storagePath, downloadToken);
    }

    devis[idx] = {
      ...devis[idx],
      priceTTC,
      description: (req.body.description ?? "").trim(),
      ...(devisFileUrl ? { devisFileUrl } : {}),
      submitted: true,
      submittedAt: new Date().toISOString(),
    };

    const allSubmitted = devis.every((o: any) => o.submitted);
    const anySubmitted = devis.some((o: any) => o.submitted);
    const newStatus = allSubmitted ? "devis_recus" : anySubmitted ? "devis_recus" : "devis_demandes";

    await demandeRef.update({ devis, status: newStatus });
    await db.collection("devisTokens").doc(token).update({ submittedAt: new Date().toISOString() });

    return res.json({ ok: true });
  });

  // ─── Page d'invitation (rejoindre une copropriété via lien partagé) ──────────
  app.get("/rejoindre/:code", async (req: Request, res: Response) => {
    const code = String(req.params.code).toUpperCase().trim();
    const db = getAdminDb();

    let coProName = "";
    let role = "";
    let categoryLabel = "";

    if (db) {
      try {
        const codeDoc = await db.collection("inviteCodes").doc(code).get();
        if (codeDoc.exists) {
          const data = codeDoc.data()!;
          coProName = data.coProName || data.coProId || "";
          role = data.role || "";
          if (data.category && CATEGORY_LABELS_SERVER[data.category]) {
            categoryLabel = CATEGORY_LABELS_SERVER[data.category];
          }
        }
      } catch { /* code non trouvé — page générique */ }
    }

    const isPrestataire = role === "prestataire";
    const roleLabel = role === "propriétaire" ? "Propriétaire"
      : role === "conseil" ? "Conseil syndical"
      : role === "collaborateur" ? "Collaborateur"
      : isPrestataire ? `Prestataire${categoryLabel ? ` — ${categoryLabel}` : ""}`
      : "";
    const roleColor = isPrestataire ? "#7C3AED"
      : role === "conseil" ? "#0891B2"
      : role === "propriétaire" ? "#059669"
      : "#2563EB";

    const webAppUrl = "https://maintena-pro.fr";
    const googlePlayUrl = "https://play.google.com/store/apps/details?id=com.profusionnumerik.maintena";

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Rejoindre Maintena${coProName ? ` — ${coProName}` : ""}</title>
  <meta name="description" content="Vous avez été invité à rejoindre${coProName ? ` ${coProName}` : " une copropriété"} sur Maintena.">
  <meta property="og:title" content="Invitation Maintena${coProName ? ` — ${coProName}` : ""}">
  <meta property="og:description" content="Votre invitation est prête. Téléchargez l'application et entrez le code pour rejoindre.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --navy: #0B1628; --blue: #2563EB; --blue-light: #EFF6FF;
      --green: #10B981; --purple: #7C3AED; --amber: #F59E0B;
      --text: #0f172a; --muted: #64748b; --border: #e2e8f0;
      --bg: #f4f7ff; --white: #fff;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }

    /* NAV */
    nav {
      background: var(--navy); padding: 16px 20px;
      display: flex; align-items: center; gap: 10px;
    }
    .logo-circle {
      width: 36px; height: 36px; border-radius: 10px;
      background: var(--blue); display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0;
    }
    nav span { color: #fff; font-size: 17px; font-weight: 700; letter-spacing: -0.3px; }
    nav small { color: rgba(255,255,255,0.45); font-size: 12px; margin-left: auto; }

    /* MAIN */
    main { max-width: 480px; margin: 0 auto; padding: 24px 16px 40px; }

    /* HERO */
    .hero {
      background: var(--navy); border-radius: 20px;
      padding: 28px 24px; margin-bottom: 16px;
      text-align: center; color: white;
    }
    .hero-icon {
      width: 64px; height: 64px; border-radius: 20px;
      background: rgba(37,99,235,0.25); border: 1px solid rgba(37,99,235,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 30px; margin: 0 auto 16px;
    }
    .hero h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.25; }
    .hero h1 span { color: rgba(255,255,255,0.55); font-weight: 400; font-size: 16px; display: block; margin-top: 6px; }
    .role-badge {
      display: inline-flex; align-items: center; gap: 6px;
      margin-top: 14px; padding: 6px 14px; border-radius: 20px;
      font-size: 12px; font-weight: 700; letter-spacing: 0.3px;
    }

    /* CODE CARD */
    .code-card {
      background: var(--white); border-radius: 20px;
      border: 1px solid var(--border); padding: 24px; margin-bottom: 16px;
      box-shadow: 0 4px 20px rgba(15,23,42,0.07);
    }
    .code-label {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: var(--muted); text-align: center; margin-bottom: 12px;
    }
    .code-display {
      background: var(--blue-light); border: 2px solid var(--blue);
      border-radius: 16px; padding: 20px; text-align: center;
      font-size: 38px; font-weight: 800; letter-spacing: 10px;
      color: var(--blue); font-family: 'SF Mono', 'Fira Code', monospace;
      margin-bottom: 12px; cursor: pointer; user-select: all;
      -webkit-user-select: all;
    }
    .copy-btn {
      width: 100%; padding: 14px; border: none; border-radius: 12px;
      background: var(--blue); color: white; font-size: 15px; font-weight: 700;
      cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;
      transition: background .2s, transform .15s;
    }
    .copy-btn:active { transform: scale(0.97); }
    .copy-btn.copied { background: var(--green); }
    .copy-hint { text-align: center; font-size: 12px; color: var(--muted); margin-top: 10px; }

    /* STEPS */
    .steps { background: var(--white); border-radius: 20px; border: 1px solid var(--border); overflow: hidden; margin-bottom: 16px; }
    .steps-title { padding: 16px 20px 12px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); }
    .step {
      display: flex; align-items: flex-start; gap: 14px;
      padding: 14px 20px; border-top: 1px solid var(--border);
    }
    .step-num {
      width: 28px; height: 28px; border-radius: 50%;
      background: var(--blue); color: #fff; font-size: 13px; font-weight: 800;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px;
    }
    .step-content h3 { font-size: 14px; font-weight: 700; color: var(--text); }
    .step-content p { font-size: 13px; color: var(--muted); margin-top: 3px; line-height: 1.5; }

    /* CTA BUTTONS */
    .cta-section { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
    .btn-primary {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 17px 20px; border-radius: 16px; border: none; cursor: pointer;
      font-size: 16px; font-weight: 700; text-decoration: none;
      background: var(--navy); color: white;
      transition: opacity .2s, transform .15s;
    }
    .btn-primary:active { transform: scale(0.97); }
    .btn-secondary {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      padding: 15px 20px; border-radius: 16px; cursor: pointer;
      font-size: 15px; font-weight: 600; text-decoration: none;
      background: var(--white); color: var(--navy);
      border: 1.5px solid var(--border);
      transition: border-color .2s;
    }
    .btn-icon { font-size: 20px; }
    .btn-label { display: flex; flex-direction: column; align-items: flex-start; }
    .btn-label small { font-size: 11px; font-weight: 400; opacity: 0.7; }
    .btn-label strong { font-size: 15px; }

    /* WHAT IS */
    .what-is {
      background: rgba(37,99,235,0.05); border: 1px solid rgba(37,99,235,0.15);
      border-radius: 16px; padding: 16px 18px; margin-bottom: 16px;
    }
    .what-is h3 { font-size: 13px; font-weight: 700; color: var(--blue); margin-bottom: 8px; }
    .what-is p { font-size: 13px; color: var(--muted); line-height: 1.6; }
    .what-is ul { padding-left: 18px; margin-top: 8px; font-size: 13px; color: var(--muted); line-height: 1.8; }

    footer { text-align: center; font-size: 11px; color: var(--muted); padding-top: 8px; }
  </style>
</head>
<body>
  <nav>
    <div class="logo-circle">M</div>
    <span>Maintena</span>
    <small>La preuve que votre résidence est entretenue</small>
  </nav>

  <main>
    <div class="hero">
      <div class="hero-icon">🏢</div>
      <h1>
        Vous êtes invité${isPrestataire ? "(e)" : "(e)"}
        ${coProName
          ? `<span>à rejoindre <strong>${coProName}</strong></span>`
          : "<span>à rejoindre une copropriété</span>"
        }
      </h1>
      ${roleLabel
        ? `<div class="role-badge" style="background:${roleColor}22;color:${roleColor};border:1px solid ${roleColor}44">${roleLabel}</div>`
        : ""
      }
    </div>

    <div class="code-card">
      <div class="code-label">Votre code d'invitation</div>
      <div class="code-display" id="code" onclick="copyCode()">${code}</div>
      <button class="copy-btn" id="copy-btn" onclick="copyCode()">
        <span id="copy-icon">📋</span>
        <span id="copy-text">Copier le code</span>
      </button>
      <p class="copy-hint">Vous aurez besoin de ce code lors de votre inscription</p>
    </div>

    <div class="steps">
      <div class="steps-title">Comment rejoindre</div>
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>${isPrestataire ? "Téléchargez Maintena" : "Téléchargez l'application"}</h3>
          <p>${isPrestataire ? "Disponible sur Android (Google Play) et sur le web" : "Disponible sur Android et directement sur votre navigateur"}</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>Créez votre compte</h3>
          <p>Renseignez votre nom, email et mot de passe. C'est gratuit.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>Entrez le code ci-dessus</h3>
          <p>Une fois connecté, entrez le code <strong>${code}</strong> dans "Rejoindre une résidence".</p>
        </div>
      </div>
    </div>

    <div class="cta-section">
      <a class="btn-primary" href="${googlePlayUrl}" target="_blank" rel="noopener">
        <span class="btn-icon">📱</span>
        <span class="btn-label">
          <small>Télécharger sur</small>
          <strong>Google Play (Android)</strong>
        </span>
      </a>
      <a class="btn-secondary" href="${webAppUrl}" target="_blank" rel="noopener">
        <span class="btn-icon">🌐</span>
        <span class="btn-label">
          <small>Ou accéder directement via</small>
          <strong>Navigateur web</strong>
        </span>
      </a>
    </div>

    <div class="what-is">
      <h3>Qu'est-ce que Maintena ?</h3>
      <p>
        ${isPrestataire
          ? "Maintena est l'application utilisée par votre client syndic pour suivre et tracer toutes les interventions de la résidence."
          : "Maintena vous permet de suivre l'entretien de votre résidence : interventions, alertes, signalements et contrôle des comptes."
        }
      </p>
      <ul>
        ${isPrestataire ? `
          <li>Recevez vos interventions directement</li>
          <li>Déclarez votre passage en 30 secondes</li>
          <li>Photos + rapport = preuve de votre travail</li>
        ` : `
          <li>Carnet d'entretien (ascenseur, VMC, portail…)</li>
          <li>Signalement de problèmes</li>
          <li>Annonces et alertes de la résidence</li>
        `}
      </ul>
    </div>

    <footer>
      &copy; ${new Date().getFullYear()} Maintena · Profusion Numérik · <a href="https://maintena-pro.fr" style="color:inherit">maintena-pro.fr</a>
    </footer>
  </main>

  <script>
    function copyCode() {
      const code = "${code}";
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(onCopied).catch(fallback);
      } else { fallback(); }
      function fallback() {
        const el = document.getElementById("code");
        const range = document.createRange();
        range.selectNode(el);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand("copy");
        window.getSelection().removeAllRanges();
        onCopied();
      }
      function onCopied() {
        const btn = document.getElementById("copy-btn");
        const icon = document.getElementById("copy-icon");
        const text = document.getElementById("copy-text");
        btn.classList.add("copied");
        icon.textContent = "✅";
        text.textContent = "Code copié !";
        setTimeout(() => {
          btn.classList.remove("copied");
          icon.textContent = "📋";
          text.textContent = "Copier le code";
        }, 2500);
      }
    }
  </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // ─── Page marketing générique pour les prestataires ──────────────────────────
  app.get("/prestataire", (_req: Request, res: Response) => {
    const googlePlayUrl = "https://play.google.com/store/apps/details?id=com.profusionnumerik.maintena";
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Maintena · Espace prestataire</title>
  <meta name="description" content="Maintena est l'application de suivi des interventions utilisée par les syndics. Rejoignez vos clients sur Maintena pour recevoir et déclarer vos interventions facilement.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --navy: #0B1628; --blue: #2563EB; --green: #10B981; --purple: #7C3AED; --text: #0f172a; --muted: #64748b; --border: #e2e8f0; --bg: #f4f7ff; --white: #fff; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    nav { background: var(--navy); padding: 16px 20px; display: flex; align-items: center; gap: 10px; }
    .logo-circle { width: 36px; height: 36px; border-radius: 10px; background: var(--blue); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0; }
    nav span { color: #fff; font-size: 17px; font-weight: 700; }
    main { max-width: 480px; margin: 0 auto; padding: 28px 16px 48px; }
    .hero-card { background: var(--navy); border-radius: 22px; padding: 32px 24px; margin-bottom: 20px; text-align: center; }
    .hero-badge { display: inline-block; background: rgba(124,58,237,0.25); color: #c084fc; border: 1px solid rgba(124,58,237,0.4); border-radius: 20px; padding: 6px 16px; font-size: 12px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 18px; }
    .hero-card h1 { color: #fff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; line-height: 1.2; }
    .hero-card p { color: rgba(255,255,255,0.55); font-size: 14px; margin-top: 12px; line-height: 1.6; }
    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
    .stat-card { background: var(--white); border-radius: 16px; border: 1px solid var(--border); padding: 16px 12px; text-align: center; }
    .stat-num { font-size: 24px; font-weight: 800; color: var(--blue); }
    .stat-label { font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.4; }
    .features { background: var(--white); border-radius: 20px; border: 1px solid var(--border); overflow: hidden; margin-bottom: 20px; }
    .feature { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--border); }
    .feature:last-child { border-bottom: none; }
    .feature-icon { font-size: 22px; flex-shrink: 0; margin-top: 1px; }
    .feature h3 { font-size: 14px; font-weight: 700; }
    .feature p { font-size: 13px; color: var(--muted); margin-top: 3px; line-height: 1.5; }
    .cta-card { background: linear-gradient(135deg, var(--blue) 0%, #1D4ED8 100%); border-radius: 20px; padding: 24px; text-align: center; margin-bottom: 16px; }
    .cta-card h2 { color: #fff; font-size: 18px; font-weight: 800; margin-bottom: 8px; }
    .cta-card p { color: rgba(255,255,255,0.75); font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
    .btn-primary { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 16px 20px; border-radius: 14px; font-size: 15px; font-weight: 700; text-decoration: none; background: #fff; color: var(--blue); margin-bottom: 10px; }
    .btn-secondary { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 20px; border-radius: 14px; font-size: 14px; font-weight: 600; text-decoration: none; background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); border: 1px solid rgba(255,255,255,0.25); }
    .howto { background: var(--white); border-radius: 20px; border: 1px solid var(--border); padding: 20px 18px; margin-bottom: 16px; }
    .howto h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: var(--muted); margin-bottom: 14px; }
    .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .step:last-child { margin-bottom: 0; }
    .step-num { width: 26px; height: 26px; border-radius: 50%; background: var(--blue); color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .step p { font-size: 13px; color: var(--text); line-height: 1.5; }
    .step p strong { color: var(--navy); }
    footer { text-align: center; font-size: 11px; color: var(--muted); }
    footer a { color: inherit; }
  </style>
</head>
<body>
  <nav>
    <div class="logo-circle">M</div>
    <span>Maintena</span>
  </nav>
  <main>
    <div class="hero-card">
      <div class="hero-badge">ESPACE PRESTATAIRE</div>
      <h1>Recevez vos interventions directement sur votre téléphone</h1>
      <p>Votre client syndic utilise Maintena pour suivre les interventions de sa résidence. Rejoignez-le pour déclarer vos passages facilement.</p>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-num">30s</div>
        <div class="stat-label">Pour déclarer une intervention</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">0€</div>
        <div class="stat-label">Compte prestataire gratuit</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">100%</div>
        <div class="stat-label">Vos passages tracés</div>
      </div>
    </div>

    <div class="features">
      <div class="feature">
        <span class="feature-icon">📲</span>
        <div>
          <h3>Recevez vos missions</h3>
          <p>Le syndic vous notifie directement via l'application pour chaque nouvelle intervention planifiée.</p>
        </div>
      </div>
      <div class="feature">
        <span class="feature-icon">📷</span>
        <div>
          <h3>Déclarez votre passage en photos</h3>
          <p>Prenez des photos avant/après et rédigez un bref rapport. La preuve de votre intervention est horodatée automatiquement.</p>
        </div>
      </div>
      <div class="feature">
        <span class="feature-icon">✅</span>
        <div>
          <h3>Clôturez en un tap</h3>
          <p>Marquez l'intervention comme terminée depuis votre téléphone. Le syndic est notifié instantanément.</p>
        </div>
      </div>
      <div class="feature">
        <span class="feature-icon">📋</span>
        <div>
          <h3>Historique complet</h3>
          <p>Retrouvez toutes vos interventions passées avec photos, rapports et dates pour justifier votre travail.</p>
        </div>
      </div>
    </div>

    <div class="cta-card">
      <h2>Votre compte prestataire est gratuit</h2>
      <p>Demandez le code d'invitation à votre client syndic, puis téléchargez l'application.</p>
      <a class="btn-primary" href="${googlePlayUrl}" target="_blank" rel="noopener">
        📱 Télécharger sur Google Play
      </a>
      <a class="btn-secondary" href="https://maintena-pro.fr" target="_blank" rel="noopener">
        🌐 Accéder via le navigateur
      </a>
    </div>

    <div class="howto">
      <h3>Comment démarrer</h3>
      <div class="step">
        <div class="step-num">1</div>
        <p><strong>Obtenez votre code</strong> — Demandez le code d'invitation spécifique à votre domaine (ex: code nettoyage, ascenseur…) à votre client syndic.</p>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <p><strong>Téléchargez Maintena</strong> — Sur Android via Google Play ou directement sur le navigateur web.</p>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <p><strong>Créez votre compte</strong> — Gratuit, en 2 minutes. Entrez le code d'invitation pour rejoindre la résidence de votre client.</p>
      </div>
    </div>

    <footer>
      &copy; ${new Date().getFullYear()} Maintena · Profusion Numérik · <a href="https://maintena-pro.fr">maintena-pro.fr</a>
    </footer>
  </main>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // ─────────────────────────────────────────────────────────────────────────────

  const db = getAdminDb();
  if (db) {
    console.log("[Firebase Admin] Firestore OK — Admin Storage uploads enabled");
  } else {
    console.warn(
      "[Firebase Admin] NOT initialized — photo uploads will fail. Check FIREBASE_SERVICE_ACCOUNT secret."
    );
  }

  // SPA fallback — serve Expo web app index.html for unknown GET routes
  const staticBuildIndex = path.resolve(process.cwd(), "static-build", "index.html");
  if (fs.existsSync(staticBuildIndex)) {
    // Route explicite /web → point d'entrée principal de l'app web
    app.get("/web", (_req: Request, res: Response) => res.sendFile(staticBuildIndex));

    app.get("/*path", (req: Request, res: Response) => {
      if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
      res.sendFile(staticBuildIndex);
    });
  }

  const httpServer = createServer(app);
  return httpServer;
}