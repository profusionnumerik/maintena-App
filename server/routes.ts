import { getAuth } from "firebase-admin/auth";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Stripe from "stripe";
import { getUncachableResendClient } from "./resend-client";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage, getDownloadURL } from "firebase-admin/storage";

// Inline depuis shared/types pour éviter les problèmes d'import dans le bundle esbuild
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

function pageShell(title: string, body: string, backLabel = "← Retour à l'accueil", backHref = "/") {
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
    <p>© 2026 ProFusion Numérik · SIREN 932 117 500 · <a href="tel:0668183092">06 68 18 30 92</a> · <a href="mailto:contact@profusionnumerik.com">contact@profusionnumerik.com</a> · <a href="/privacy-policy">Confidentialité</a></p>
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

async function sendGuestInviteEmail(params: {
  to: string;
  providerName: string;
  coproName: string;
  interventionTitle: string;
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
        <div style="font-size:16px;color:#0F172A;font-weight:700;">
          ${escapeHtml(params.interventionTitle)}
        </div>
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
      selectedPlan === "pro"      ? (process.env.STRIPE_PRICE_ID_PRO      || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "business" ? (process.env.STRIPE_PRICE_ID_BUSINESS || process.env.STRIPE_PRICE_ID) :
                                    (process.env.STRIPE_PRICE_ID_STARTER  || process.env.STRIPE_PRICE_ID);
    if (!priceId) {
      return res.status(503).json({
        error: "Configuration Stripe incomplète (STRIPE_PRICE_ID manquant).",
      });
    }

    try {
      const baseUrl = getBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: adminEmail ?? undefined,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: {
          coProId,
          userId,
          adminEmail: adminEmail ?? "",
          coProName: coProName ?? "",
          inviteCode: inviteCode ?? "",
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
      selectedPlan === "pro"      ? (process.env.STRIPE_PRICE_ID_PRO      || process.env.STRIPE_PRICE_ID) :
      selectedPlan === "business" ? (process.env.STRIPE_PRICE_ID_BUSINESS || process.env.STRIPE_PRICE_ID) :
                                    (process.env.STRIPE_PRICE_ID_STARTER  || process.env.STRIPE_PRICE_ID);
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
      const trialEndsAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // TEST: 15min

      await db.collection("users").doc(userId).set({
        uid: userId,
        email: normalizedEmail,
        displayName,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        phone: String(phone ?? "").trim(),
        role: "admin",
        subscriptionStatus: "trialing",
        trialEndsAt,
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
        status: "pending",
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

        const customerId =
          typeof session.customer === "string" ? session.customer : "";

        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : "";

        let expiresAtStr: string | null = null;

        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const periodEndUnix = (subscription as any).current_period_end;
            if (periodEndUnix) {
              expiresAtStr = new Date(periodEndUnix * 1000).toISOString();
            }
          } catch (e) {
            console.error("subscription retrieve error:", e);
          }
        }

        const now = new Date().toISOString();

        if (userId) {
          await db.collection("users").doc(userId).set(
            {
              subscriptionStatus: "active",
              subscriptionActivatedAt: now,
              subscriptionExpiresAt: expiresAtStr,
              stripeSessionId: session.id,
              stripeCustomerId: customerId || null,
              stripeSubscriptionId: subscriptionId || null,
            },
            { merge: true }
          );
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

      const trialEndsAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // TEST: 15min
      await db.collection("users").doc(uid).set(
        { subscriptionStatus: "trialing", trialEndsAt },
        { merge: true }
      );

      return res.json({ ok: true, trialEndsAt });
    } catch (e: any) {
      console.error("start-trial error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
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
      <p>L'accès complet au service nécessite un abonnement payant. Les tarifs et conditions sont affichés lors de l'inscription. L'abonnement est sans engagement et résiliable à tout moment.</p>

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
        Après l’essai, à partir de 7,99 €/mois · Résiliable à tout moment<br/>
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

  // Ancienne inscription avec paiement direct (pour ceux qui veulent payer sans essai)
  app.get("/inscription-paiement", (req: Request, res: Response) => {
    const queryPlan = String(req.query?.plan ?? "starter").trim().toLowerCase();
    const initialPlan = ["pro", "business"].includes(queryPlan) ? queryPlan : "starter";
    const html = pageShell("Créer mon espace syndic — Abonnement direct", `
  <style>
    .plan-toggle { display:flex; gap:0; margin-bottom:24px; border-radius:12px; overflow:hidden; border:1px solid var(--border); }
    .plan-btn { flex:1; padding:14px 12px; background:transparent; color:var(--muted); border:none; cursor:pointer; font-size:14px; font-weight:600; font-family:inherit; transition:background 0.15s, color 0.15s; text-align:center; line-height:1.3; }
    .plan-btn.active { background:var(--blue); color:#fff; }
    .plan-btn:not(.active):hover { background:rgba(255,255,255,0.06); color:var(--text); }
    .plan-btn small { display:block; font-size:11px; font-weight:400; opacity:0.8; margin-top:2px; }
  </style>
  <div class="m-container">
    <div class="m-card">
      <p style="text-align:center;margin-bottom:16px;"><a href="/inscription" style="color:var(--blue);font-size:0.88rem;">← Retour à l’essai gratuit</a></p>
      <h1>Abonnement direct</h1>
      <p class="subtitle">Créez votre compte et activez votre abonnement immédiatement via Stripe.</p>
      <div class="plan-toggle" id="plan-toggle" role="group">
        <button type="button" class="plan-btn${initialPlan === "starter" ? " active" : ""}" data-plan="starter">Starter<small>1–5 copros · 7,99 €/mois</small></button>
        <button type="button" class="plan-btn${initialPlan === "pro" ? " active" : ""}" data-plan="pro">Pro<small>4–15 copros · 14,99 €/mois</small></button>
        <button type="button" class="plan-btn${initialPlan === "business" ? " active" : ""}" data-plan="business">Business<small>16–30 copros · 19,99 €/mois</small></button>
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
        <button class="m-btn" type="submit" id="submit-btn">Continuer → ${initialPlan === "pro" ? "14,99 €/mois" : initialPlan === "business" ? "19,99 €/mois" : "7,99 €/mois"}</button>
        <div class="m-error" id="error"></div>
      </form>
      <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--muted);">🔒 Paiement sécurisé via Stripe · Résiliation à tout moment</p>
    </div>
  </div>
  <script>
    var currentPlan = "${initialPlan}";
    var planLabels = { starter: "Continuer → 7,99 €/mois", pro: "Continuer → 14,99 €/mois", business: "Continuer → 19,99 €/mois" };
    var form = document.getElementById("signup-form");
    var errorBox = document.getElementById("error");
    var btn = document.getElementById("submit-btn");
    document.querySelectorAll("#plan-toggle .plan-btn").forEach(function(b) {
      b.addEventListener("click", function() { currentPlan = b.dataset.plan; document.querySelectorAll("#plan-toggle .plan-btn").forEach(function(x){x.classList.toggle("active",x===b);}); btn.textContent = planLabels[currentPlan]; });
    });
    var phoneInput = document.getElementById("phone");
    phoneInput.addEventListener("input", function() { var d = phoneInput.value.replace(/\\D/g,"").slice(0,10); phoneInput.value = d.replace(/(\\d{2})(?=\\d)/g,"$1 ").trim(); });
    form.addEventListener("submit", async function(e) {
      e.preventDefault(); errorBox.style.display="none"; btn.textContent="Chargement…"; btn.disabled=true;
      var body = { firstName:document.getElementById("firstName").value.trim(), lastName:document.getElementById("lastName").value.trim(), email:document.getElementById("email").value.trim().toLowerCase(), phone:document.getElementById("phone").value.replace(/\\s/g,"").trim(), password:document.getElementById("password").value, coProName:document.getElementById("coProName").value.trim(), address:document.getElementById("address").value.trim(), postalCode:document.getElementById("postalCode").value.trim(), city:document.getElementById("city").value.trim(), plan:currentPlan };
      try { var r = await fetch("/api/web-signup-checkout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); var d = await r.json(); if(!r.ok) throw new Error(d.error||"Erreur"); if(d.url){window.location.href=d.url;return;} throw new Error("Session Stripe introuvable"); }
      catch(err) { errorBox.textContent=err.message||"Erreur inconnue"; errorBox.style.display="block"; btn.textContent=planLabels[currentPlan]; btn.disabled=false; }
    });
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
      return res.json({ sent: targetEmails.length });
    } catch (e: any) {
      console.error("notify-poll error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
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
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();

      if (invitesSnap.empty) {
        return res.status(404).json({ error: "Aucune invitation trouvée pour cette intervention." });
      }

      const invite = invitesSnap.docs[0].data();
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

  app.post("/api/public/intervention/:token/photo", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }

    if (payload.intervention.guestUpdatedAt) {
      return res.status(403).json({ error: "Ce compte-rendu a déjà été transmis. Aucune modification n'est possible." });
    }

    const { base64, mimeType = "image/jpeg" } = req.body as {
      base64?: string;
      mimeType?: string;
    };

    if (!base64) {
      return res.status(400).json({ error: "Image manquante." });
    }

    try {
      const bucket = getAdminStorage();
      if (!bucket) {
        return res.status(503).json({
          error: "Storage Firebase Admin non configuré.",
        });
      }

      const extension =
        mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
          ? "webp"
          : "jpg";

      const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
      const storagePath = `copros/${payload.copro.id}/interventions/${payload.intervention.id}/completion/${fileName}`;
      const file = bucket.file(storagePath);

      const buffer = Buffer.from(base64, "base64");

      await file.save(buffer, {
        metadata: { contentType: mimeType },
        resumable: false,
      });

      const url = await getDownloadURL(file);
      const updatedPhotos = [...payload.intervention.completionPhotos, url];

      await payload.interventionRef.set(
        { completionPhotos: updatedPhotos },
        { merge: true }
      );

      return res.json({
        success: true,
        url,
        completionPhotos: updatedPhotos,
      });
    } catch (e: any) {
      console.error("guest photo upload error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
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

  app.post("/api/public/intervention/:token/report", async (req: Request, res: Response) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }

    if (payload.intervention.providerStatus === "refused") {
      return res.status(403).json({ error: "Vous avez refusé cette intervention. Aucun compte-rendu ne peut être soumis." });
    }

    if (payload.intervention.guestUpdatedAt) {
      return res.status(403).json({ error: "Ce compte-rendu a déjà été transmis. Aucune modification n'est possible." });
    }

    const {
      status,
      report,
      completionComment,
      interventionRemaining,
      completionPhotos,
      cleaningChecklist,
    } = req.body as {
      status?: "planifie" | "en_cours" | "termine";
      report?: string;
      completionComment?: string;
      interventionRemaining?: string;
      completionPhotos?: string[];
      cleaningChecklist?: Record<string, boolean>;
    };

    try {
      await payload.interventionRef.set(
        {
          status: status ?? "en_cours",
          interventionReport: report ?? "",
          completionComment: completionComment ?? "",
          interventionRemaining: interventionRemaining ?? "",
          completionPhotos: Array.isArray(completionPhotos)
            ? completionPhotos
            : payload.intervention.completionPhotos,
          ...(cleaningChecklist && typeof cleaningChecklist === "object" ? { cleaningChecklist } : {}),
          guestUpdatedAt: new Date().toISOString(),
          // Soumettre un rapport implique l'acceptation
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

      return res.json({ success: true });
    } catch (e: any) {
      console.error("guest report error:", e);
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

    // Bouton refus — uniquement pour missions non-récurrentes non-refusées
    const refuseBlock = (pStatus !== "refused" && !isRecurring && !reportLocked) ? `
      <div id="confirm-block" style="background:#fff;border-radius:18px;padding:22px 28px;box-shadow:0 4px 24px rgba(0,0,0,0.08);margin-bottom:20px;border:1.5px solid #fee2e2;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <p style="font-size:15px;color:#64748b;margin:0;">Vous ne pouvez pas intervenir sur cette mission ?</p>
        <button id="btn-refuse" onclick="respond('refused')" style="background:#fff;color:#ef4444;border:2px solid #ef4444;border-radius:12px;padding:12px 22px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;">
          ✗ Refuser la mission
        </button>
        <div id="respond-msg" style="display:none;width:100%;padding:10px 12px;border-radius:10px;font-size:14px;"></div>
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
    <div style="display:inline-block;background:#dbeafe;color:#1d4ed8;border-radius:999px;padding:5px 14px;font-size:12px;font-weight:700;margin-bottom:14px;">Intervention</div>
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
    <form id="report-form">
      <label class="m-label" for="status">Statut</label>
      <select id="status" name="status" class="m-input">${statusOptions}</select>

      <label class="m-label" for="report">Rapport d'intervention *</label>
      <textarea id="report" name="report" class="m-input" style="min-height:120px;resize:vertical;" placeholder="Décrivez ce que vous avez réalisé...">${escapeHtml(payload.intervention.interventionReport || "")}</textarea>

      <label class="m-label" for="interventionRemaining">Travaux restants (si applicable)</label>
      <textarea id="interventionRemaining" name="interventionRemaining" class="m-input" style="min-height:80px;resize:vertical;" placeholder="Ce qu'il reste à faire...">${escapeHtml(payload.intervention.interventionRemaining || "")}</textarea>

      <label class="m-label" for="photoInput">📷 Photo de preuve *</label>
      <input id="photoInput" type="file" accept="image/*" class="m-input" />

      <div id="photosList" style="margin-top:10px;margin-bottom:4px;">${existingPhotosHtml}</div>

      <button type="submit" id="submitBtn" class="m-btn" style="margin-top:14px;">✓ Enregistrer le compte-rendu</button>

      <div class="m-success" id="success">Compte-rendu enregistré avec succès !</div>
      <div class="m-error" id="error"></div>
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
    const btnAccept = document.getElementById('btn-accept');
    const btnRefuse = document.getElementById('btn-refuse');
    const msg = document.getElementById('respond-msg');

    if (btnAccept) btnAccept.disabled = true;
    if (btnRefuse) btnRefuse.disabled = true;

    try {
      const res = await fetch('/api/public/intervention/' + TOKEN + '/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      // Recharger la page pour refléter le nouveau statut
      window.location.reload();
    } catch (e) {
      if (msg) {
        msg.textContent = e.message || 'Erreur réseau';
        msg.style.display = 'block';
        msg.style.background = '#fee2e2';
        msg.style.color = '#991b1b';
      }
      if (btnAccept) btnAccept.disabled = false;
      if (btnRefuse) btnRefuse.disabled = false;
    }
  }

  let completionPhotos = ${JSON.stringify(payload.intervention.completionPhotos || [])};
  const photosList = document.getElementById('photosList');
  const success = document.getElementById('success');
  const error = document.getElementById('error');

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

  function renderPhotos() {
    const list = document.getElementById('photosList');
    if (!list) return;
    if (!completionPhotos.length) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = completionPhotos.map((url) =>
      '<a href="' + url + '" target="_blank" style="display:flex;align-items:center;gap:6px;margin:4px 0;color:#2563eb;font-size:13px;">📷 Voir la photo</a>'
    ).join('');
  }

  async function uploadPhotoIfSelected() {
    const input = document.getElementById('photoInput');
    const file = input && input.files[0];
    if (!file) return; // pas de photo sélectionnée → on passe
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
      reader.onload = async () => {
        try {
          const result = String(reader.result || '');
          const base64 = result.includes(',') ? result.split(',')[1] : result;
          const res = await fetch('/api/public/intervention/' + TOKEN + '/photo', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64, mimeType: file.type || 'image/jpeg' }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erreur upload photo');
          completionPhotos = data.completionPhotos || completionPhotos;
          renderPhotos();
          resolve();
        } catch (e) { reject(e); }
      };
      reader.readAsDataURL(file);
    });
  }

  const reportForm = document.getElementById('report-form');
  if (reportForm) reportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const success = document.getElementById('success');
    const error = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');
    success.style.display = 'none'; error.style.display = 'none';

    const reportText = document.getElementById('report').value.trim();
    if (!reportText) {
      error.textContent = 'Veuillez remplir le rapport d\'intervention.';
      error.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi en cours...';

    try {
      // 1. Upload la photo si une est sélectionnée
      await uploadPhotoIfSelected();

      // 2. Soumettre le rapport avec tout
      const body = {
        status: document.getElementById('status').value,
        report: reportText,
        completionComment: '',
        interventionRemaining: document.getElementById('interventionRemaining').value,
        completionPhotos,
        cleaningChecklist: Object.keys(cleaningChecklist).length > 0 ? cleaningChecklist : undefined,
      };
      const res = await fetch('/api/public/intervention/' + TOKEN + '/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');

      success.textContent = 'Compte-rendu enregistré avec succès !';
      success.style.display = 'block';
      // Verrouiller le formulaire
      reportForm.querySelectorAll('input, textarea, select, button').forEach(el => {
        el.disabled = true;
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      error.textContent = e.message || 'Erreur';
      error.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = '✓ Enregistrer le compte-rendu';
    }
  });
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