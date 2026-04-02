// server/index.ts
import express from "express";

// server/routes.ts
import { getAuth } from "firebase-admin/auth";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import Stripe from "stripe";

// server/resend-client.ts
import { Resend } from "resend";
var connectionSettings;
async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? "repl " + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? "depl " + process.env.WEB_REPL_RENEWAL : null;
  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }
  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=resend",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken
      }
    }
  ).then((res) => res.json()).then((data) => data.items?.[0]);
  if (!connectionSettings || !connectionSettings.settings.api_key) {
    throw new Error("Resend not connected");
  }
  return {
    apiKey: connectionSettings.settings.api_key,
    fromEmail: connectionSettings.settings.from_email ?? "Maintena <onboarding@resend.dev>"
  };
}
async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

// server/routes.ts
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage, getDownloadURL } from "firebase-admin/storage";
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-02-25.clover"
  });
}
function getAdminDb() {
  if (getApps().length === 0) {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      console.warn("[Firebase Admin] FIREBASE_SERVICE_ACCOUNT non d\xE9fini.");
      return null;
    }
    try {
      let serviceAccount = null;
      const raw = serviceAccountStr;
      const trimmed = raw.trim();
      const candidates = [
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
        raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").trim(),
        raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "").trim().replace(/\\n/g, "\n")
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
          } catch {
          }
        }
      }
      if (!serviceAccount || !serviceAccount.project_id) {
        console.error(
          "[Firebase Admin] Parsing \xE9chou\xE9. D\xE9but du secret:",
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
    const bucket = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
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
async function extractAuthenticatedUser(req) {
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
async function deleteUserData(uid) {
  const db = getAdminDb();
  const adminAuth = getAdminAuthInstance();
  if (!db || !adminAuth) throw new Error("Firebase Admin indisponible");
  const batch = db.batch();
  batch.delete(db.collection("users").doc(uid));
  const coprosSnap = await db.collection("copros").get();
  for (const coproDoc of coprosSnap.docs) {
    const members = await db.collection("copros").doc(coproDoc.id).collection("members").where("uid", "==", uid).get();
    members.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  }
  await batch.commit();
  await adminAuth.deleteUser(uid);
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function generateGuestToken() {
  return randomBytes(32).toString("hex");
}
function generateInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
async function createUniqueInviteCode(db) {
  for (let i = 0; i < 20; i++) {
    const code = generateInviteCode(6);
    const snap = await db.collection("inviteCodes").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new Error("Impossible de g\xE9n\xE9rer un code d'invitation unique.");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function getBaseUrl(req) {
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
function getAppDownloadUrl() {
  return process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL || process.env.APP_WEB_BASE_URL || "";
}
async function getGuestInviteByToken(token) {
  const db = getAdminDb();
  if (!db) return null;
  const tokenHash = sha256(token);
  const snap = await db.collection("guestInterventionInvites").where("tokenHash", "==", tokenHash).limit(1).get();
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() };
}
async function createGuestInviteRecord(params) {
  const db = getAdminDb();
  if (!db) {
    throw new Error("Firebase Admin n'est pas configur\xE9.");
  }
  const token = generateGuestToken();
  const tokenHash = sha256(token);
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1e3);
  const baseUrl = getBaseUrl(params.req);
  const webLink = `${baseUrl}/guest-intervention/${token}`;
  const completeAccountLink = `${baseUrl}/guest-complete-account/${token}`;
  const docRef = await db.collection("guestInterventionInvites").add({
    tokenHash,
    tokenPreview: `${token.slice(0, 8)}\u2026`,
    coProId: params.coProId,
    interventionId: params.interventionId,
    providerFirstName: params.providerFirstName ?? "",
    providerLastName: params.providerLastName ?? "",
    providerName: params.providerName ?? [params.providerFirstName, params.providerLastName].filter(Boolean).join(" ").trim(),
    providerEmail: params.providerEmail.toLowerCase(),
    providerPhone: params.providerPhone ?? "",
    providerCompany: params.providerCompany ?? "",
    status: "sent",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    webLink,
    completeAccountLink
  });
  return {
    inviteId: docRef.id,
    token,
    webLink,
    completeAccountLink,
    appLink: getAppDownloadUrl(),
    expiresAt: expiresAt.toISOString()
  };
}
async function buildGuestInterventionPayload(token) {
  const invite = await getGuestInviteByToken(token);
  if (!invite) {
    return { error: "Lien invalide ou introuvable.", status: 404 };
  }
  const expiresAtRaw = invite.data.expiresAt;
  const expiresAt = expiresAtRaw?.toDate ? expiresAtRaw.toDate() : new Date(expiresAtRaw);
  if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
    return { error: "Ce lien a expir\xE9.", status: 410 };
  }
  const db = getAdminDb();
  if (!db) {
    return { error: "Base de donn\xE9es indisponible.", status: 503 };
  }
  const interventionRef = db.collection("copros").doc(invite.data.coProId).collection("interventions").doc(invite.data.interventionId);
  const interventionSnap = await interventionRef.get();
  if (!interventionSnap.exists) {
    return { error: "Intervention introuvable.", status: 404 };
  }
  const intervention = interventionSnap.data();
  const coproSnap = await db.collection("copros").doc(invite.data.coProId).get();
  const copro = coproSnap.exists ? coproSnap.data() : null;
  const providerName = invite.data.providerName || [invite.data.providerFirstName, invite.data.providerLastName].filter(Boolean).join(" ").trim() || invite.data.providerEmail || "Intervenant";
  return {
    status: 200,
    invite,
    interventionRef,
    intervention: {
      id: interventionSnap.id,
      title: intervention.title ?? "Intervention",
      description: intervention.description ?? "",
      category: intervention.category ?? "divers",
      status: intervention.status ?? "planifie",
      date: intervention.date?.toDate ? intervention.date.toDate().toISOString() : intervention.date ?? null,
      completionComment: intervention.completionComment ?? "",
      interventionReport: intervention.interventionReport ?? "",
      interventionRemaining: intervention.interventionRemaining ?? "",
      completionPhotos: Array.isArray(intervention.completionPhotos) ? intervention.completionPhotos : []
    },
    copro: {
      id: invite.data.coProId,
      name: copro?.name ?? "Copropri\xE9t\xE9",
      address: copro?.address ?? [copro?.street, copro?.postalCode, copro?.city].filter(Boolean).join(", ")
    },
    provider: {
      firstName: invite.data.providerFirstName ?? "",
      lastName: invite.data.providerLastName ?? "",
      name: providerName,
      email: invite.data.providerEmail ?? "",
      phone: invite.data.providerPhone ?? "",
      company: invite.data.providerCompany ?? ""
    },
    links: {
      webLink: invite.data.webLink ?? "",
      completeAccountLink: invite.data.completeAccountLink ?? "",
      appLink: getAppDownloadUrl()
    }
  };
}
async function sendActivationEmail(adminEmail, coProName, inviteCode) {
  let resendClient;
  try {
    resendClient = await getUncachableResendClient();
  } catch (e) {
    console.warn("Resend not connected \u2014 email non envoy\xE9:", e);
    return;
  }
  const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
  await resendClient.client.emails.send({
    from: fromAddress,
    to: adminEmail,
    subject: `Votre copropri\xE9t\xE9 "${coProName}" est activ\xE9e !`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropri\xE9t\xE9</div>
    </div>

    <div style="padding:32px;">
      <div style="background:#D1FAE5;color:#065F46;font-size:13px;font-weight:600;
        padding:8px 16px;border-radius:20px;display:inline-block;margin-bottom:20px;">
        Copropri\xE9t\xE9 activ\xE9e
      </div>

      <h1 style="font-size:22px;font-weight:700;color:#0F172A;margin:0 0 12px;">
        Bienvenue sur Maintena !
      </h1>
      <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
        Votre copropri\xE9t\xE9 <strong>${escapeHtml(coProName)}</strong> est maintenant active.
        Partagez le code ci-dessous \xE0 vos prestataires pour qu'ils rejoignent votre espace.
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
          Partagez ce code \xE0 vos prestataires
        </div>
      </div>

      <div style="background:#EFF6FF;border-radius:12px;padding:16px;">
        <div style="font-size:13px;color:#1D4ED8;font-weight:600;margin-bottom:4px;">
          Comment inviter un prestataire ?
        </div>
        <div style="font-size:13px;color:#3B82F6;line-height:1.5;">
          Dans l'app Maintena \u2192 Cr\xE9er un compte \u2192 "Rejoindre avec un code" \u2192 saisir <strong>${escapeHtml(
      inviteCode
    )}</strong>
        </div>
      </div>
    </div>

    <div style="padding:20px 32px;border-top:1px solid #F1F5F9;text-align:center;">
      <p style="font-size:12px;color:#94A3B8;margin:0;">
        Maintena \u2014 Gestion professionnelle de copropri\xE9t\xE9
      </p>
    </div>
  </div>
</body>
</html>
    `
  });
  console.log(
    `Activation email sent to ${adminEmail} for copro "${coProName}" (code: ${inviteCode})`
  );
}
async function sendGuestInviteEmail(params) {
  let resendClient;
  try {
    resendClient = await getUncachableResendClient();
  } catch (e) {
    console.warn("Resend non disponible \u2014 email prestataire non envoy\xE9:", e);
    return;
  }
  const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
  await resendClient.client.emails.send({
    from: fromAddress,
    to: params.to,
    subject: `Intervention Maintena - ${params.coproName}`,
    html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:620px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:28px 32px 22px;">
      <div style="font-size:28px;font-weight:800;color:#fff;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.45);margin-top:4px;">Gestion de copropri\xE9t\xE9</div>
    </div>

    <div style="padding:32px;">
      <div style="display:inline-block;background:#DBEAFE;color:#1D4ED8;font-size:12px;font-weight:700;padding:6px 12px;border-radius:20px;margin-bottom:18px;">
        Invitation prestataire
      </div>

      <h1 style="font-size:22px;color:#0F172A;margin:0 0 12px;">
        Bonjour ${escapeHtml(params.providerName)},
      </h1>

      <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 18px;">
        Vous avez \xE9t\xE9 invit\xE9 \xE0 compl\xE9ter une fiche d\u2019intervention pour la copropri\xE9t\xE9
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
          Ouvrir la fiche d\u2019intervention
        </a>
      </p>

      <p style="font-size:14px;color:#64748B;line-height:1.6;">
        Vous pouvez remplir la fiche directement sur le web, sans cr\xE9er de compte.
      </p>

      <p style="font-size:14px;color:#64748B;line-height:1.6;margin-top:16px;">
        Si vous souhaitez cr\xE9er votre compte Maintena plus tard :
      </p>

      <p style="word-break:break-all;">
        <a href="${params.completeAccountLink}" style="color:#2563EB;">
          ${params.completeAccountLink}
        </a>
      </p>
    </div>
  </div>
</body>
</html>
    `
  });
}
async function registerRoutes(app2) {
  app2.get("/", (_req, res) => {
    const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Maintena \u2014 \xE9dit\xE9e par Profusion Num\xE9rik</title>
    <meta
      name="description"
      content="Maintena est une application de gestion de copropri\xE9t\xE9s destin\xE9e aux syndics, \xE9dit\xE9e par Profusion Num\xE9rik."
    />
    <style>
      :root {
        --bg: #081225;
        --bg-soft: #0f1c36;
        --card: #ffffff;
        --text: #0f172a;
        --muted: #475569;
        --line: #dbe3ee;
        --primary: #1d4ed8;
        --primary-dark: #153ea8;
        --accent: #0ea5a4;
        --white: #ffffff;
        --shadow: 0 20px 50px rgba(0, 0, 0, 0.18);
        --radius: 20px;
      }

      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }

      body {
        margin: 0;
        font-family: Arial, Helvetica, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(29, 78, 216, 0.22), transparent 35%),
          linear-gradient(135deg, var(--bg), var(--bg-soft));
        color: var(--white);
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .container {
        width: min(1100px, calc(100% - 32px));
        margin: 0 auto;
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 50;
        backdrop-filter: blur(10px);
        background: rgba(8, 18, 37, 0.72);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }

      .topbar-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 72px;
        gap: 16px;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 700;
        font-size: 1.05rem;
      }

      .brand-badge {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, var(--primary), var(--accent));
        color: var(--white);
        font-weight: 700;
        box-shadow: var(--shadow);
      }

      .nav {
        display: flex;
        gap: 18px;
        flex-wrap: wrap;
      }

      .nav a {
        font-size: 0.96rem;
        color: rgba(255, 255, 255, 0.88);
      }

      .nav a:hover {
        color: var(--white);
      }

      .hero {
        padding: 84px 0 48px;
      }

      .hero-grid {
        display: grid;
        grid-template-columns: 1.2fr 0.9fr;
        gap: 28px;
        align-items: center;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 0.92rem;
        color: rgba(255, 255, 255, 0.9);
      }

      h1 {
        margin: 18px 0 16px;
        font-size: clamp(2.2rem, 5vw, 4rem);
        line-height: 1.05;
      }

      .hero p {
        margin: 0 0 24px;
        font-size: 1.08rem;
        line-height: 1.7;
        color: rgba(255, 255, 255, 0.86);
        max-width: 720px;
      }

      .hero-actions {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
      }

      .btn {
        border: 0;
        border-radius: 14px;
        padding: 14px 20px;
        font-size: 1rem;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.18s ease, opacity 0.18s ease, background 0.18s ease;
      }

      .btn:hover {
        transform: translateY(-1px);
      }

      .btn-primary {
        background: var(--primary);
        color: var(--white);
      }

      .btn-primary:hover {
        background: var(--primary-dark);
      }

      .btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        color: var(--white);
        border: 1px solid rgba(255, 255, 255, 0.14);
      }

      .hero-card {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 24px;
        padding: 22px;
        box-shadow: var(--shadow);
      }

      .hero-card-title {
        font-size: 1.1rem;
        font-weight: 700;
        margin: 0 0 14px;
      }

      .hero-list {
        display: grid;
        gap: 10px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .hero-list li {
        background: rgba(255, 255, 255, 0.06);
        border-radius: 14px;
        padding: 12px 14px;
        color: rgba(255, 255, 255, 0.92);
      }

      .section {
        padding: 34px 0;
      }

      .grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }

      .card {
        background: var(--card);
        color: var(--text);
        border-radius: var(--radius);
        padding: 24px;
        box-shadow: var(--shadow);
      }

      .card h2,
      .card h3 {
        margin-top: 0;
        color: var(--text);
      }

      .card p,
      .card li {
        color: var(--muted);
        line-height: 1.7;
      }

      .features {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 18px;
      }

      .feature {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
      }

      .price-box {
        border: 1px solid #cfe0ff;
        background: #f7faff;
        border-radius: 18px;
        padding: 18px;
        margin-top: 16px;
      }

      .price {
        font-size: 2rem;
        font-weight: 800;
        color: var(--text);
        margin: 8px 0;
      }

      .small {
        font-size: 0.95rem;
        color: var(--muted);
      }

      .legal-list,
      .contact-list {
        margin: 14px 0 0;
        padding-left: 18px;
      }

      .footer {
        padding: 28px 0 46px;
        color: rgba(255, 255, 255, 0.74);
      }

      .footer-box {
        border-top: 1px solid rgba(255, 255, 255, 0.12);
        padding-top: 20px;
        font-size: 0.95rem;
        line-height: 1.7;
      }

      .pill {
        display: inline-block;
        padding: 6px 10px;
        border-radius: 999px;
        background: #eff6ff;
        color: var(--primary);
        font-size: 0.86rem;
        font-weight: 700;
      }

      @media (max-width: 860px) {
        .hero-grid,
        .grid-2,
        .features {
          grid-template-columns: 1fr;
        }

        .topbar-inner {
          flex-direction: column;
          align-items: flex-start;
          padding: 10px 0;
        }

        .nav {
          gap: 12px;
        }

        .hero {
          padding-top: 48px;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="container topbar-inner">
        <a href="#top" class="brand">
          <span class="brand-badge">M</span>
          <span>Maintena</span>
        </a>

        <nav class="nav">
          <a href="#presentation">Pr\xE9sentation</a>
          <a href="#fonctionnalites">Fonctionnalit\xE9s</a>
          <a href="#offre">Offre</a>
          <a href="#contact">Contact</a>
          <a href="#legal">Informations l\xE9gales</a>
        </nav>
      </div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="container hero-grid">
          <div>
            <span class="eyebrow">Application \xE9dit\xE9e par Profusion Num\xE9rik</span>
            <h1>Maintena</h1>
            <p>
              Maintena est une application professionnelle de gestion de copropri\xE9t\xE9s,
              destin\xE9e aux syndics. Elle permet de centraliser les informations,
              suivre les interventions, g\xE9rer les prestataires et am\xE9liorer
              l\u2019organisation au quotidien.
            </p>

            <div class="hero-actions">
              <a class="btn btn-primary" href="/inscription">S\u2019inscrire et activer Maintena</a>
              <a class="btn btn-secondary" href="#contact">Nous contacter</a>
            </div>
          </div>

          <aside class="hero-card">
            <h2 class="hero-card-title">Informations cl\xE9s</h2>
            <ul class="hero-list">
              <li><strong>\xC9diteur :</strong> Profusion Num\xE9rik</li>
              <li><strong>Produit :</strong> Maintena</li>
              <li><strong>Type d\u2019offre :</strong> abonnement annuel</li>
              <li><strong>Public vis\xE9 :</strong> syndics et gestionnaires de copropri\xE9t\xE9s</li>
              <li><strong>Paiement :</strong> s\xE9curis\xE9 via Stripe</li>
            </ul>
          </aside>
        </div>
      </section>

      <section class="section" id="presentation">
        <div class="container grid-2">
          <article class="card">
            <span class="pill">Pr\xE9sentation</span>
            <h2>Qui exploite Maintena ?</h2>
            <p>
              <strong>Profusion Num\xE9rik</strong> est une entreprise sp\xE9cialis\xE9e dans
              la cr\xE9ation de contenus digitaux et de solutions num\xE9riques.
            </p>
            <p>
              <strong>Maintena</strong> est une application \xE9dit\xE9e et exploit\xE9e par
              Profusion Num\xE9rik. Maintena n\u2019est pas une soci\xE9t\xE9 distincte, mais un
              produit num\xE9rique commercialis\xE9 par Profusion Num\xE9rik.
            </p>
          </article>

          <article class="card">
            <span class="pill">Objectif</span>
            <h2>\xC0 quoi sert Maintena ?</h2>
            <p>
              Maintena aide les syndics \xE0 structurer le suivi de leurs copropri\xE9t\xE9s,
              \xE0 centraliser les demandes et \xE0 mieux coordonner les prestataires
              intervenant sur site.
            </p>
            <p>
              L\u2019application a pour objectif de simplifier la gestion quotidienne,
              r\xE9duire les \xE9changes dispers\xE9s et am\xE9liorer la tra\xE7abilit\xE9.
            </p>
          </article>
        </div>
      </section>

      <section class="section" id="fonctionnalites">
        <div class="container">
          <article class="card">
            <span class="pill">Fonctionnalit\xE9s</span>
            <h2>Ce que permet l\u2019application</h2>
            <div class="features">
              <div class="feature">
                <h3>Gestion des copropri\xE9t\xE9s</h3>
                <p>Centralisation des informations li\xE9es aux immeubles et aux acc\xE8s.</p>
              </div>
              <div class="feature">
                <h3>Suivi des interventions</h3>
                <p>Cr\xE9ation, suivi et historique des interventions techniques.</p>
              </div>
              <div class="feature">
                <h3>Gestion des prestataires</h3>
                <p>Organisation des intervenants et meilleure coordination op\xE9rationnelle.</p>
              </div>
              <div class="feature">
                <h3>Acc\xE8s s\xE9curis\xE9</h3>
                <p>Acc\xE8s r\xE9serv\xE9 aux utilisateurs autoris\xE9s selon leur r\xF4le.</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section class="section" id="offre">
        <div class="container grid-2">
          <article class="card">
            <span class="pill">Offre</span>
            <h2>Abonnement Maintena</h2>
            <div class="price-box">
              <div class="small">Tarif</div>
              <div class="price">169 \u20AC / an</div>
              <div class="small">
                Offre de lancement : une tablette peut \xEAtre offerte aux premiers
                clients, selon disponibilit\xE9 et selon les conditions de l\u2019offre.
              </div>
            </div>

            <p>
              L\u2019abonnement donne acc\xE8s \xE0 l\u2019utilisation de la solution Maintena
              dans le cadre de l\u2019activit\xE9 professionnelle du client.
            </p>
          </article>

          <article class="card">
            <span class="pill">Paiement</span>
            <h2>Paiement s\xE9curis\xE9</h2>
            <p>
              Les paiements sont trait\xE9s de mani\xE8re s\xE9curis\xE9e via Stripe.
            </p>
            <p>
              L\u2019inscription se fait en ligne, puis le paiement permet d\u2019activer
              l\u2019espace syndic et la copropri\xE9t\xE9.
            </p>

            <button class="btn btn-primary" type="button" onclick="window.location.href='/inscription'">
              Acc\xE9der \xE0 l\u2019inscription
            </button>
          </article>
        </div>
      </section>

      <section class="section" id="contact">
        <div class="container grid-2">
          <article class="card">
            <span class="pill">Contact</span>
            <h2>Coordonn\xE9es</h2>
            <ul class="contact-list">
              <li><strong>Entreprise :</strong> Profusion Num\xE9rik</li>
              <li><strong>Email :</strong> <a href="mailto:contact@profusionnumerik.com">contact@profusionnumerik.com</a></li>
              <li><strong>Adresse :</strong> \xC0 compl\xE9ter</li>
            </ul>
            <p>
              Pense \xE0 remplacer l\u2019adresse et l\u2019email par tes vraies informations avant publication.
            </p>
          </article>

          <article class="card" id="legal">
            <span class="pill">Informations l\xE9gales</span>
            <h2>Conditions g\xE9n\xE9rales d\u2019information</h2>
            <ul class="legal-list">
              <li>Maintena est une application \xE9dit\xE9e et exploit\xE9e par Profusion Num\xE9rik.</li>
              <li>L\u2019abonnement est annuel.</li>
              <li>Toute annulation emp\xEAche le renouvellement \xE0 l\u2019\xE9ch\xE9ance suivante.</li>
              <li>Les demandes de remboursement et les r\xE9clamations sont \xE9tudi\xE9es au cas par cas.</li>
              <li>Les paiements sont trait\xE9s de fa\xE7on s\xE9curis\xE9e via Stripe.</li>
            </ul>
          </article>
        </div>
      </section>
    </main>

    <footer class="footer">
      <div class="container footer-box">
        <div>
          <strong>Profusion Num\xE9rik</strong> \u2014 Maintena est une application \xE9dit\xE9e
          et exploit\xE9e par Profusion Num\xE9rik.
        </div>
        <div>
          Contact : <a href="mailto:contact@profusionnumerik.com">contact@profusionnumerik.com</a>
        </div>
      </div>
    </footer>
  </body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  });
  app2.post("/api/create-checkout-session", async (req, res) => {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        error: "Le paiement n'est pas encore configur\xE9. Contactez l'administrateur pour activer votre copropri\xE9t\xE9 manuellement."
      });
    }
    const { coProId, userId, adminEmail, coProName, inviteCode } = req.body;
    if (!coProId || !userId) {
      return res.status(400).json({ error: "Param\xE8tres manquants." });
    }
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(503).json({
        error: "Configuration Stripe incompl\xE8te (STRIPE_PRICE_ID manquant)."
      });
    }
    try {
      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: adminEmail ?? void 0,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: {
          coProId,
          userId,
          adminEmail: adminEmail ?? "",
          coProName: coProName ?? "",
          inviteCode: inviteCode ?? ""
        },
        success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/payment-cancel`
      });
      return res.json({ url: session.url });
    } catch (e) {
      console.error("Stripe checkout error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur Stripe" });
    }
  });
  app2.post("/api/web-signup-checkout", async (req, res) => {
    const stripe = getStripe();
    const db2 = getAdminDb();
    if (!stripe) {
      return res.status(503).json({ error: "Stripe non configur\xE9." });
    }
    if (!db2) {
      return res.status(503).json({ error: "Firebase Admin non configur\xE9." });
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
      city
    } = req.body ?? {};
    if (!firstName || !lastName || !email || !password || !coProName || !address || !postalCode || !city) {
      return res.status(400).json({ error: "Champs obligatoires manquants." });
    }
    if (String(password).trim().length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit contenir au moins 6 caract\xE8res."
      });
    }
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) {
      return res.status(503).json({
        error: "Configuration Stripe incompl\xE8te (STRIPE_PRICE_ID manquant)."
      });
    }
    try {
      const { getAuth: getAuth2 } = await import("firebase-admin/auth");
      const adminAuth = getAuth2();
      const normalizedEmail = String(email).trim().toLowerCase();
      const displayName = `${String(firstName).trim()} ${String(lastName).trim()}`.trim();
      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(normalizedEmail);
      } catch {
        userRecord = await adminAuth.createUser({
          email: normalizedEmail,
          password: String(password).trim(),
          displayName
        });
      }
      const userId = userRecord.uid;
      const inviteCode = await createUniqueInviteCode(db2);
      const coProRef = db2.collection("copros").doc();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await db2.collection("users").doc(userId).set(
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
          managedCoproIds: [coProRef.id]
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
        createdAt: now
      });
      await db2.collection("copros").doc(coProRef.id).collection("members").doc(userId).set({
        uid: userId,
        email: normalizedEmail,
        displayName,
        role: "admin",
        joinedAt: now
      });
      await db2.collection("inviteCodes").doc(inviteCode).set({
        coProId: coProRef.id,
        coProName: String(coProName).trim(),
        role: "prestataire",
        createdAt: now
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
          inviteCode
        },
        success_url: `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/payment-cancel`
      });
      return res.json({
        ok: true,
        url: session.url,
        userId,
        coProId: coProRef.id,
        inviteCode
      });
    } catch (e) {
      console.error("web-signup-checkout error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/stripe-webhook", async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).send("Stripe not configured");
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
      if (webhookSecret && sig) {
        const rawBody = req.rawBody ?? req.body;
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } else {
        event = req.body;
      }
    } catch (e) {
      console.error("Webhook signature error:", e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }
    const db2 = getAdminDb();
    if (!db2) return res.status(503).send("Firestore unavailable");
    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const coProId = session.metadata?.coProId;
        const adminEmail = session.metadata?.adminEmail;
        const coProName = session.metadata?.coProName;
        const inviteCode = session.metadata?.inviteCode;
        const customerId = typeof session.customer === "string" ? session.customer : "";
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : "";
        let expiresAtStr = null;
        if (subscriptionId) {
          try {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId);
            const periodEndUnix = subscription.current_period_end;
            if (periodEndUnix) {
              expiresAtStr = new Date(periodEndUnix * 1e3).toISOString();
            }
          } catch (e) {
            console.error("subscription retrieve error:", e);
          }
        }
        const now = (/* @__PURE__ */ new Date()).toISOString();
        if (userId) {
          await db2.collection("users").doc(userId).set(
            {
              subscriptionStatus: "active",
              subscriptionActivatedAt: now,
              subscriptionExpiresAt: expiresAtStr,
              stripeSessionId: session.id,
              stripeCustomerId: customerId || null,
              stripeSubscriptionId: subscriptionId || null
            },
            { merge: true }
          );
        }
        if (coProId) {
          await db2.collection("copros").doc(coProId).set(
            {
              status: "active",
              activatedAt: now,
              stripePaid: true,
              stripeSessionId: session.id,
              stripeCustomerId: customerId || null,
              stripeSubscriptionId: subscriptionId || null
            },
            { merge: true }
          );
        } else if (userId) {
          const pendingCopros = await db2.collection("copros").where("adminId", "==", userId).where("status", "==", "pending").get();
          if (!pendingCopros.empty) {
            const batch = db2.batch();
            pendingCopros.docs.forEach((d) => {
              batch.set(
                d.ref,
                {
                  status: "active",
                  activatedAt: now,
                  stripePaid: true,
                  stripeSessionId: session.id,
                  stripeCustomerId: customerId || null,
                  stripeSubscriptionId: subscriptionId || null
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
        const subscription = event.data.object;
        const subscriptionId = subscription.id;
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const usersSnap = await db2.collection("users").where("stripeSubscriptionId", "==", subscriptionId).get();
        const coprosSnap = await db2.collection("copros").where("stripeSubscriptionId", "==", subscriptionId).get();
        const batch = db2.batch();
        usersSnap.forEach((doc) => {
          batch.set(
            doc.ref,
            {
              subscriptionStatus: "canceled",
              subscriptionCanceledAt: now
            },
            { merge: true }
          );
        });
        coprosSnap.forEach((doc) => {
          batch.set(
            doc.ref,
            {
              status: "inactive",
              subscriptionCanceledAt: now
            },
            { merge: true }
          );
        });
        await batch.commit();
      }
      return res.json({ received: true });
    } catch (e) {
      console.error("stripe-webhook error:", e);
      return res.status(500).send(e.message ?? "Webhook error");
    }
  });
  app2.post("/api/activate-user-subscription", async (req, res) => {
    const { userId, coProId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: "userId requis." });
    }
    const db2 = getAdminDb();
    if (!db2) {
      return res.status(503).json({ error: "Firebase non configur\xE9." });
    }
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const expiresAt = /* @__PURE__ */ new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const expiresAtStr = expiresAt.toISOString();
      await db2.collection("users").doc(userId).set(
        {
          subscriptionStatus: "active",
          subscriptionActivatedAt: now,
          subscriptionExpiresAt: expiresAtStr,
          activatedByAdmin: true
        },
        { merge: true }
      );
      if (coProId) {
        await db2.collection("copros").doc(coProId).update({
          status: "active",
          activatedAt: now
        });
      }
      const pendingCopros = await db2.collection("copros").where("adminId", "==", userId).where("status", "==", "pending").get();
      if (!pendingCopros.empty) {
        const batch = db2.batch();
        pendingCopros.docs.forEach((d) => {
          batch.update(d.ref, { status: "active", activatedAt: now });
        });
        await batch.commit();
      }
      return res.json({ activated: true, expiresAt: expiresAtStr });
    } catch (e) {
      console.error("activate-user-subscription error:", e);
      return res.status(500).json({ error: e.message });
    }
  });
  app2.post("/api/resend-invite-code", async (req, res) => {
    const { adminEmail, coProName, inviteCode } = req.body;
    if (!adminEmail || !coProName || !inviteCode) {
      return res.status(400).json({ error: "Param\xE8tres manquants." });
    }
    let resendClient;
    try {
      resendClient = await getUncachableResendClient();
    } catch (e) {
      console.warn("Resend not connected \u2014 email non envoy\xE9:", e);
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
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropri\xE9t\xE9</div>
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
        Voici le code d'invitation pour votre copropri\xE9t\xE9 <strong>${escapeHtml(
          coProName
        )}</strong>.
        Utilisez-le pour rejoindre l'application Maintena ou partagez-le \xE0 vos prestataires.
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
          Vous n'avez pas demand\xE9 ce rappel ?
        </div>
        <div style="font-size:13px;color:#B45309;line-height:1.5;">
          Ignorez cet email. Votre compte reste s\xE9curis\xE9.
        </div>
      </div>
    </div>
    <div style="padding:20px 32px;border-top:1px solid #F1F5F9;text-align:center;">
      <p style="font-size:12px;color:#94A3B8;margin:0;">
        Maintena \u2014 Gestion professionnelle de copropri\xE9t\xE9
      </p>
    </div>
  </div>
</body>
</html>
        `
      });
      return res.json({ sent: true });
    } catch (e) {
      console.error("Email send error:", e);
      return res.status(500).json({ error: e.message });
    }
  });
  app2.post("/api/send-activation-email", async (req, res) => {
    const { adminEmail, coProName, inviteCode } = req.body;
    if (!adminEmail || !coProName || !inviteCode) {
      return res.status(400).json({ error: "Param\xE8tres manquants." });
    }
    try {
      await sendActivationEmail(adminEmail, coProName, inviteCode);
      return res.json({ sent: true });
    } catch (e) {
      console.error("Email send error:", e);
      return res.status(500).json({ error: e.message });
    }
  });
  app2.get("/privacy-policy", (_req, res) => {
    return res.sendFile("privacy-policy.html", { root: "public" });
  });
  app2.get("/account-deletion", (_req, res) => {
    return res.sendFile("account-deletion.html", { root: "public" });
  });
  app2.post("/api/account/deletion-request", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const reason = String(req.body?.reason || "").trim();
    if (!email) {
      return res.status(400).json({ message: "Email requis." });
    }
    const db2 = getAdminDb();
    if (!db2) {
      return res.status(503).json({ message: "Service temporairement indisponible." });
    }
    await db2.collection("accountDeletionRequests").add({
      email,
      reason: reason || null,
      source: "public-web",
      status: "pending",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return res.status(200).json({ ok: true });
  });
  app2.post("/api/account/delete", async (req, res) => {
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
  app2.get("/inscription", (_req, res) => {
    const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Inscription Maintena</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}
    .wrap{max-width:760px;margin:0 auto}
    .card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 8px 30px rgba(15,23,42,.08)}
    h1{margin-top:0}
    label{display:block;font-weight:700;margin:14px 0 6px}
    input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;box-sizing:border-box}
    button{margin-top:18px;background:#2563eb;color:#fff;border:0;border-radius:12px;padding:14px 18px;font-weight:700;cursor:pointer}
    .muted{color:#64748b}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .error{display:none;margin-top:14px;padding:12px 14px;border-radius:12px;background:#fee2e2;color:#991b1b}
    @media(max-width:700px){.row{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Cr\xE9er mon espace syndic</h1>
      <p class="muted">Cr\xE9ez votre compte Maintena puis finalisez l\u2019activation avec l\u2019abonnement annuel.</p>

      <form id="signup-form">
        <div class="row">
          <div>
            <label for="firstName">Pr\xE9nom</label>
            <input id="firstName" required />
          </div>
          <div>
            <label for="lastName">Nom</label>
            <input id="lastName" required />
          </div>
        </div>

        <label for="email">Email</label>
        <input id="email" type="email" required />

        <label for="phone">T\xE9l\xE9phone</label>
        <input id="phone" />

        <label for="password">Mot de passe</label>
        <input id="password" type="password" minlength="6" required />

        <label for="coProName">Nom de la copropri\xE9t\xE9</label>
        <input id="coProName" required />

        <label for="address">Adresse</label>
        <input id="address" required />

        <div class="row">
          <div>
            <label for="postalCode">Code postal</label>
            <input id="postalCode" required />
          </div>
          <div>
            <label for="city">Ville</label>
            <input id="city" required />
          </div>
        </div>

        <button type="submit">Continuer vers le paiement</button>
        <div class="error" id="error"></div>
      </form>
    </div>
  </div>

  <script>
    const form = document.getElementById("signup-form");
    const errorBox = document.getElementById("error");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.style.display = "none";
      errorBox.textContent = "";

      const body = {
        firstName: document.getElementById("firstName").value.trim(),
        lastName: document.getElementById("lastName").value.trim(),
        email: document.getElementById("email").value.trim().toLowerCase(),
        phone: document.getElementById("phone").value.trim(),
        password: document.getElementById("password").value,
        coProName: document.getElementById("coProName").value.trim(),
        address: document.getElementById("address").value.trim(),
        postalCode: document.getElementById("postalCode").value.trim(),
        city: document.getElementById("city").value.trim()
      };

      try {
        const res = await fetch("/api/web-signup-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Erreur lors de l\u2019inscription");
        }

        if (data.url) {
          window.location.href = data.url;
          return;
        }

        throw new Error("Session Stripe introuvable");
      } catch (err) {
        errorBox.textContent = err.message || "Erreur inconnue";
        errorBox.style.display = "block";
      }
    });
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  });
  app2.get("/payment-success", (_req, res) => {
    res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Paiement confirm\xE9</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f8fafc;padding:24px}
    .box{max-width:680px;margin:60px auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 30px rgba(15,23,42,.08)}
    a{display:inline-block;margin-top:18px;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:12px}
    p{line-height:1.6;color:#475569}
  </style>
</head>
<body>
  <div class="box">
    <h1>Paiement confirm\xE9</h1>
    <p>Votre abonnement Maintena a bien \xE9t\xE9 pris en compte.</p>
    <p>Votre espace est en cours d\u2019activation. Vous recevrez \xE9galement un email de confirmation.</p>
    <a href="/">Retour \xE0 l\u2019accueil</a>
  </div>
</body>
</html>`);
  });
  app2.get("/payment-cancel", (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Paiement annul\xE9 \u2014 Maintena</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, sans-serif;
      background: #0b1628; color: #fff;
      min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    .card {
      background: #142240; border-radius: 24px;
      padding: 40px 32px; max-width: 400px;
      text-align: center; border: 1px solid rgba(255,255,255,0.08);
    }
    .icon { font-size: 64px; margin-bottom: 20px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 10px; }
    p { color: rgba(255,255,255,0.6); line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">\u21A9\uFE0F</div>
    <h1>Paiement annul\xE9</h1>
    <p>Le paiement a \xE9t\xE9 annul\xE9. Retournez sur l'application pour r\xE9essayer.</p>
  </div>
</body>
</html>
    `);
  });
  app2.post("/api/init-user-copros", async (req, res) => {
    const db2 = getAdminDb();
    if (!db2) {
      return res.status(503).json({ error: "Firebase Admin non configur\xE9" });
    }
    const { uid, email, displayName } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "uid requis" });
    }
    try {
      const userRef = db2.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const existingIds = userSnap.exists ? userSnap.data()?.managedCoproIds ?? [] : [];
      const adminQuery = await db2.collection("copros").where("adminId", "==", uid).get();
      const allIds = new Set(existingIds);
      const copros = [];
      for (const d of adminQuery.docs) {
        allIds.add(d.id);
        const data = d.data();
        copros.push({ id: d.id, ...data });
        const memberRef = db2.collection("copros").doc(d.id).collection("members").doc(uid);
        const memberSnap = await memberRef.get();
        if (!memberSnap.exists) {
          await memberRef.set({
            uid,
            email: email ?? "",
            displayName: displayName ?? email ?? "",
            role: "admin",
            joinedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
      for (const id of existingIds) {
        if (!adminQuery.docs.find((d) => d.id === id)) {
          try {
            const coProSnap = await db2.collection("copros").doc(id).get();
            if (coProSnap.exists) {
              copros.push({ id: coProSnap.id, ...coProSnap.data() });
              const memberRef = db2.collection("copros").doc(id).collection("members").doc(uid);
              const memberSnap = await memberRef.get();
              if (!memberSnap.exists) {
                await memberRef.set({
                  uid,
                  email: email ?? "",
                  displayName: displayName ?? email ?? "",
                  role: "admin",
                  joinedAt: (/* @__PURE__ */ new Date()).toISOString()
                });
              }
            }
          } catch {
          }
        }
      }
      const allIdsArr = Array.from(allIds);
      if (allIdsArr.length > 0) {
        await userRef.set({ managedCoproIds: allIdsArr }, { merge: true });
      }
      return res.json({ copros, managedCoproIds: allIdsArr });
    } catch (e) {
      console.error("init-user-copros error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/admin/activate-subscription", async (req, res) => {
    const db2 = getAdminDb();
    if (!db2) {
      return res.status(503).json({ error: "Firebase Admin non configur\xE9" });
    }
    const { uid, adminSecret } = req.body;
    if (adminSecret !== process.env.SESSION_SECRET) {
      return res.status(403).json({ error: "Non autoris\xE9" });
    }
    if (!uid) {
      return res.status(400).json({ error: "uid requis" });
    }
    try {
      const now = /* @__PURE__ */ new Date();
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      await db2.collection("users").doc(uid).set(
        {
          subscriptionStatus: "active",
          subscriptionActivatedAt: now.toISOString(),
          subscriptionExpiresAt: expiresAt.toISOString()
        },
        { merge: true }
      );
      const coprosSnap = await db2.collection("copros").where("adminId", "==", uid).get();
      const batch = db2.batch();
      coprosSnap.docs.forEach((d) => {
        batch.update(d.ref, { status: "active" });
      });
      await batch.commit();
      return res.json({
        success: true,
        activatedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        coprosActivated: coprosSnap.docs.length
      });
    } catch (e) {
      console.error("activate-subscription error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/upload-photo", async (req, res) => {
    try {
      const authHeader = req.headers.authorization ?? "";
      const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const { base64, mimeType = "image/jpeg", storagePath } = req.body;
      if (!idToken) return res.status(401).json({ error: "Token requis" });
      if (!base64 || !storagePath) {
        return res.status(400).json({ error: "base64 et storagePath requis" });
      }
      const buffer = Buffer.from(base64, "base64");
      const bucketName = process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "maintena-3a544.firebasestorage.app";
      const adminBucket = getAdminStorage();
      if (adminBucket) {
        const file = adminBucket.file(storagePath);
        await file.save(buffer, {
          metadata: { contentType: mimeType },
          resumable: false
        });
        await file.makePublic();
        const encodedPath2 = storagePath.split("/").map(encodeURIComponent).join("/");
        const downloadUrl2 = `https://storage.googleapis.com/${bucketName}/${encodedPath2}`;
        return res.json({ url: downloadUrl2 });
      }
      const encodedPath = encodeURIComponent(storagePath);
      const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o?name=${encodedPath}&uploadType=media`;
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": mimeType,
          "Content-Length": String(buffer.length)
        },
        body: buffer
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        return res.status(uploadRes.status).json({
          error: "Upload refus\xE9. Configurez FIREBASE_SERVICE_ACCOUNT ou d\xE9ployez les r\xE8gles Firebase Storage.",
          detail: errBody.substring(0, 200)
        });
      }
      const uploadData = await uploadRes.json();
      const token = uploadData.downloadTokens ?? "";
      const encodedPathFull = storagePath.split("/").map(encodeURIComponent).join("%2F");
      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPathFull}?alt=media&token=${token}`;
      return res.json({ url: downloadUrl });
    } catch (e) {
      console.error("upload-photo error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/notify-signalement", async (req, res) => {
    try {
      const { adminEmail, coProName, message, senderName, apartmentNumber } = req.body;
      if (!adminEmail || !message) {
        return res.status(400).json({ error: "adminEmail et message requis" });
      }
      let resendClient;
      try {
        resendClient = await getUncachableResendClient();
      } catch (e) {
        console.warn("Resend not connected \u2014 signalement email non envoy\xE9:", e);
        return res.json({ sent: false, reason: "resend_unavailable" });
      }
      const fromAddress = resendClient.fromEmail ?? "Maintena <onboarding@resend.dev>";
      await resendClient.client.emails.send({
        from: fromAddress,
        to: adminEmail,
        subject: `Nouveau signalement \xB7 ${coProName ?? "Copropri\xE9t\xE9"}`,
        html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F4F7FF;font-family:-apple-system,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:#0B1628;padding:32px 32px 24px;">
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px;">Maintena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Gestion de copropri\xE9t\xE9</div>
    </div>
    <div style="padding:32px;">
      <div style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:20px;">
        Nouveau signalement
      </div>
      <h2 style="font-size:22px;font-weight:700;color:#0B1628;margin:0 0 8px;">
        ${escapeHtml(coProName ?? "Votre copropri\xE9t\xE9")}
      </h2>
      <div style="background:#FFFBEB;border:1px solid rgba(245,158,11,0.25);border-radius:14px;padding:18px;margin:20px 0;">
        <div style="font-size:13px;color:#92400E;font-weight:600;margin-bottom:6px;">
          De : ${escapeHtml(senderName ?? "Propri\xE9taire")}${apartmentNumber ? ` \xB7 Appt ${escapeHtml(apartmentNumber)}` : ""}
        </div>
        <div style="font-size:15px;color:#1E293B;line-height:1.5;">${escapeHtml(
          message
        )}</div>
      </div>
      <p style="font-size:13px;color:#64748B;line-height:1.6;">
        Connectez-vous \xE0 l'application Maintena pour consulter et r\xE9pondre \xE0 ce signalement.
      </p>
    </div>
    <div style="background:#F8FAFF;padding:20px 32px;border-top:1px solid #E2E8F0;">
      <div style="font-size:12px;color:#94A3B8;text-align:center;">
        Maintena \xB7 Gestion de copropri\xE9t\xE9 professionnelle
      </div>
    </div>
  </div>
</body>
</html>`
      });
      return res.json({ sent: true });
    } catch (e) {
      console.error("notify-signalement error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/guest-invites", async (req, res) => {
    const {
      coProId,
      interventionId,
      providerFirstName,
      providerLastName,
      providerName,
      providerEmail,
      providerPhone,
      providerCompany
    } = req.body;
    if (!coProId || !interventionId || !providerEmail) {
      return res.status(400).json({
        error: "coProId, interventionId et providerEmail sont requis."
      });
    }
    const db2 = getAdminDb();
    if (!db2) {
      return res.status(503).json({ error: "Firebase Admin non configur\xE9." });
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
        req
      });
      const interventionSnap = await db2.collection("copros").doc(coProId).collection("interventions").doc(interventionId).get();
      const coproSnap = await db2.collection("copros").doc(coProId).get();
      const safeProviderName = providerName?.trim() || [providerFirstName, providerLastName].filter(Boolean).join(" ").trim() || providerEmail;
      await sendGuestInviteEmail({
        to: providerEmail,
        providerName: safeProviderName,
        coproName: coproSnap.data()?.name ?? "Copropri\xE9t\xE9",
        interventionTitle: interventionSnap.data()?.title ?? "Intervention",
        webLink: payload.webLink,
        completeAccountLink: payload.completeAccountLink
      });
      return res.json(payload);
    } catch (e) {
      console.error("guest-invites error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.get("/api/public/intervention/:token", async (req, res) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }
    return res.json(payload);
  });
  app2.get("/api/public/complete-account/:token", async (req, res) => {
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
        category: payload.intervention.category
      }
    });
  });
  app2.post("/api/public/complete-account/:token", async (req, res) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }
    const { password } = req.body;
    if (!password || password.trim().length < 6) {
      return res.status(400).json({
        error: "Le mot de passe doit contenir au moins 6 caract\xE8res."
      });
    }
    const db2 = getAdminDb();
    if (!db2) {
      return res.status(503).json({ error: "Base de donn\xE9es indisponible." });
    }
    try {
      const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!serviceAccountStr) {
        return res.status(503).json({
          error: "FIREBASE_SERVICE_ACCOUNT manquant."
        });
      }
      const { getAuth: getAuth2 } = await import("firebase-admin/auth");
      const adminAuth = getAuth2();
      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(payload.provider.email);
      } catch {
        userRecord = await adminAuth.createUser({
          email: payload.provider.email,
          password: password.trim(),
          displayName: payload.provider.name
        });
      }
      await db2.collection("users").doc(userRecord.uid).set(
        {
          uid: userRecord.uid,
          email: payload.provider.email,
          displayName: payload.provider.name,
          firstName: payload.provider.firstName ?? "",
          lastName: payload.provider.lastName ?? "",
          phone: payload.provider.phone ?? "",
          company: payload.provider.company ?? "",
          guestCompletedAccountAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
      await payload.invite.ref.set(
        {
          completedAccountAt: (/* @__PURE__ */ new Date()).toISOString(),
          completedAccountUid: userRecord.uid
        },
        { merge: true }
      );
      return res.json({
        success: true,
        uid: userRecord.uid,
        email: payload.provider.email
      });
    } catch (e) {
      console.error("complete-account error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/public/intervention/:token/photo", async (req, res) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }
    const { base64, mimeType = "image/jpeg" } = req.body;
    if (!base64) {
      return res.status(400).json({ error: "Image manquante." });
    }
    try {
      const bucket = getAdminStorage();
      if (!bucket) {
        return res.status(503).json({
          error: "Storage Firebase Admin non configur\xE9."
        });
      }
      const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
      const fileName = `${Date.now()}-${randomBytes(6).toString("hex")}.${extension}`;
      const storagePath = `copros/${payload.copro.id}/interventions/${payload.intervention.id}/completion/${fileName}`;
      const file = bucket.file(storagePath);
      const buffer = Buffer.from(base64, "base64");
      await file.save(buffer, {
        metadata: { contentType: mimeType },
        resumable: false
      });
      const url = await getDownloadURL(file);
      const updatedPhotos = [...payload.intervention.completionPhotos, url];
      await payload.interventionRef.set(
        {
          completionPhotos: updatedPhotos,
          guestUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
      return res.json({
        success: true,
        url,
        completionPhotos: updatedPhotos
      });
    } catch (e) {
      console.error("guest photo upload error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.post("/api/public/intervention/:token/report", async (req, res) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).json({ error: payload.error });
    }
    const {
      status,
      report,
      completionComment,
      interventionRemaining,
      completionPhotos
    } = req.body;
    try {
      await payload.interventionRef.set(
        {
          status: status ?? "en_cours",
          interventionReport: report ?? "",
          completionComment: completionComment ?? "",
          interventionRemaining: interventionRemaining ?? "",
          completionPhotos: Array.isArray(completionPhotos) ? completionPhotos : payload.intervention.completionPhotos,
          guestUpdatedAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
      await payload.invite.ref.set(
        {
          status: "completed",
          usedAt: (/* @__PURE__ */ new Date()).toISOString()
        },
        { merge: true }
      );
      return res.json({ success: true });
    } catch (e) {
      console.error("guest report error:", e);
      return res.status(500).json({ error: e.message ?? "Erreur serveur" });
    }
  });
  app2.get("/guest-intervention/:token", async (req, res) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).send(
        `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px"><h1>Lien indisponible</h1><p>${escapeHtml(
          payload.error
        )}</p></body></html>`
      );
    }
    const statusOptions = [
      ["planifie", "Planifi\xE9e"],
      ["en_cours", "En cours"],
      ["termine", "Termin\xE9e"]
    ].map(
      ([value, label]) => `<option value="${value}" ${payload.intervention.status === value ? "selected" : ""}>${label}</option>`
    ).join("");
    const existingPhotosHtml = payload.intervention.completionPhotos.length > 0 ? payload.intervention.completionPhotos.map(
      (url) => `<a href="${escapeHtml(
        url
      )}" target="_blank" style="display:block;margin:8px 0;color:#2563eb;">Voir la photo</a>`
    ).join("") : `<p class="muted">Aucune photo envoy\xE9e.</p>`;
    const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Intervention Maintena</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;}
    .wrap{max-width:760px;margin:0 auto;}
    .card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 8px 32px rgba(15,23,42,.08);margin-bottom:16px;}
    .pill{display:inline-block;background:#dbeafe;color:#1d4ed8;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;margin-bottom:12px;}
    h1{font-size:28px;margin:0 0 8px;}
    h2{font-size:18px;margin:0 0 16px;}
    p,li{line-height:1.6;}
    label{display:block;font-size:14px;font-weight:600;margin-bottom:6px;}
    input,textarea,select{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:14px;box-sizing:border-box;margin-bottom:14px;}
    textarea{min-height:140px;resize:vertical;}
    button{background:#2563eb;color:#fff;border:none;border-radius:12px;padding:14px 18px;font-weight:700;font-size:15px;cursor:pointer;}
    .secondary{background:#0f766e;}
    .muted{color:#64748b;font-size:14px;}
    .success,.error{display:none;padding:12px 14px;border-radius:12px;margin-top:12px;}
    .success{background:#dcfce7;color:#166534;}
    .error{background:#fee2e2;color:#991b1b;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="pill">Acc\xE8s invit\xE9 s\xE9curis\xE9</div>
      <h1>${escapeHtml(payload.intervention.title)}</h1>
      <p class="muted">${escapeHtml(payload.copro.name)}${payload.copro.address ? ` \xB7 ${escapeHtml(payload.copro.address)}` : ""}</p>
      <p><strong>Prestataire :</strong> ${escapeHtml(payload.provider.name)}</p>
      <p><strong>Email :</strong> ${escapeHtml(payload.provider.email)}</p>
      <p><strong>Date pr\xE9vue :</strong> ${payload.intervention.date ? new Date(payload.intervention.date).toLocaleString("fr-FR") : "Non renseign\xE9e"}</p>
      <p><strong>Description :</strong><br/>${escapeHtml(
      payload.intervention.description || "Aucune description fournie."
    )}</p>
    </div>

    <div class="card">
      <h2>Compte-rendu d'intervention</h2>
      <form id="report-form">
        <label for="status">Statut</label>
        <select id="status" name="status">${statusOptions}</select>

        <label for="report">Rapport</label>
        <textarea id="report" name="report" placeholder="D\xE9crivez votre intervention...">${escapeHtml(
      payload.intervention.interventionReport || ""
    )}</textarea>

        <label for="completionComment">Commentaire de cl\xF4ture</label>
        <textarea id="completionComment" name="completionComment" placeholder="Commentaires compl\xE9mentaires...">${escapeHtml(
      payload.intervention.completionComment || ""
    )}</textarea>

        <label for="interventionRemaining">Travaux restants</label>
        <textarea id="interventionRemaining" name="interventionRemaining" placeholder="Ce qu'il reste \xE9ventuellement \xE0 faire...">${escapeHtml(
      payload.intervention.interventionRemaining || ""
    )}</textarea>

        <label for="photoInput">Ajouter une photo</label>
        <input id="photoInput" type="file" accept="image/*" />

        <button type="button" id="uploadPhotoBtn" class="secondary">Envoyer la photo</button>
        <button type="submit">Enregistrer</button>

        <div class="success" id="success">Compte-rendu enregistr\xE9 avec succ\xE8s.</div>
        <div class="error" id="error"></div>
      </form>
    </div>

    <div class="card">
      <h2>Photos envoy\xE9es</h2>
      <div id="photosList">${existingPhotosHtml}</div>
    </div>

    <div class="card">
      <h2>Cr\xE9er votre compte Maintena</h2>
      <p class="muted">
        Vous pouvez aussi finaliser votre inscription sans ressaisir vos informations :
        <a href="${escapeHtml(
      payload.links.completeAccountLink
    )}" style="color:#2563eb;">finaliser mon compte</a>
      </p>
    </div>
  </div>

  <script>
    const form = document.getElementById('report-form');
    const success = document.getElementById('success');
    const error = document.getElementById('error');
    const uploadBtn = document.getElementById('uploadPhotoBtn');
    const photoInput = document.getElementById('photoInput');
    const photosList = document.getElementById('photosList');

    let completionPhotos = ${JSON.stringify(
      payload.intervention.completionPhotos || []
    )};

    function renderPhotos() {
      if (!completionPhotos.length) {
        photosList.innerHTML = '<p class="muted">Aucune photo envoy\xE9e.</p>';
        return;
      }
      photosList.innerHTML = completionPhotos.map((url) =>
        '<a href="' + url + '" target="_blank" style="display:block;margin:8px 0;color:#2563eb;">Voir la photo</a>'
      ).join('');
    }

    uploadBtn.addEventListener('click', async () => {
      success.style.display = 'none';
      error.style.display = 'none';

      const file = photoInput.files && photoInput.files[0];
      if (!file) {
        error.textContent = 'Choisissez une photo.';
        error.style.display = 'block';
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const result = String(reader.result || '');
          const base64 = result.includes(',') ? result.split(',')[1] : result;

          const res = await fetch('/api/public/intervention/${req.params.token}/photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64,
              mimeType: file.type || 'image/jpeg'
            }),
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Erreur upload');

          completionPhotos = data.completionPhotos || completionPhotos;
          renderPhotos();
          success.textContent = 'Photo envoy\xE9e avec succ\xE8s.';
          success.style.display = 'block';
        } catch (e) {
          error.textContent = e.message || 'Erreur upload photo';
          error.style.display = 'block';
        }
      };

      reader.readAsDataURL(file);
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      success.style.display = 'none';
      error.style.display = 'none';

      const body = {
        status: document.getElementById('status').value,
        report: document.getElementById('report').value,
        completionComment: document.getElementById('completionComment').value,
        interventionRemaining: document.getElementById('interventionRemaining').value,
        completionPhotos,
      };

      try {
        const res = await fetch('/api/public/intervention/${req.params.token}/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

        success.textContent = 'Compte-rendu enregistr\xE9 avec succ\xE8s.';
        success.style.display = 'block';
      } catch (e) {
        error.textContent = e.message;
        error.style.display = 'block';
      }
    });

    renderPhotos();
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  });
  app2.get("/guest-complete-account/:token", async (req, res) => {
    const payload = await buildGuestInterventionPayload(String(req.params.token));
    if (payload.status !== 200) {
      return res.status(payload.status).send(
        `<!doctype html><html><body style="font-family:Arial,sans-serif;padding:40px"><h1>Lien indisponible</h1><p>${escapeHtml(
          payload.error
        )}</p></body></html>`
      );
    }
    const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Finaliser mon compte Maintena</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px;}
    .wrap{max-width:680px;margin:0 auto;}
    .card{background:#fff;border-radius:18px;padding:24px;box-shadow:0 8px 32px rgba(15,23,42,.08);margin-bottom:16px;}
    h1{font-size:28px;margin:0 0 8px;}
    label{display:block;font-size:14px;font-weight:600;margin-bottom:6px;}
    input{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font-size:14px;box-sizing:border-box;margin-bottom:14px;}
    button{background:#2563eb;color:#fff;border:none;border-radius:12px;padding:14px 18px;font-weight:700;font-size:15px;cursor:pointer;}
    .muted{color:#64748b;font-size:14px;}
    .success,.error{display:none;padding:12px 14px;border-radius:12px;margin-top:12px;}
    .success{background:#dcfce7;color:#166534;}
    .error{background:#fee2e2;color:#991b1b;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Finaliser mon compte</h1>
      <p class="muted">Vos informations ont d\xE9j\xE0 \xE9t\xE9 enregistr\xE9es par le syndic. Il ne vous reste qu\u2019\xE0 choisir un mot de passe.</p>
    </div>

    <div class="card">
      <label>Pr\xE9nom</label>
      <input value="${escapeHtml(payload.provider.firstName || "")}" disabled />

      <label>Nom</label>
      <input value="${escapeHtml(payload.provider.lastName || "")}" disabled />

      <label>Email</label>
      <input value="${escapeHtml(payload.provider.email || "")}" disabled />

      <label>T\xE9l\xE9phone</label>
      <input value="${escapeHtml(payload.provider.phone || "")}" disabled />

      <label for="password">Mot de passe</label>
      <input id="password" type="password" placeholder="Au moins 6 caract\xE8res" />

      <button id="submitBtn">Cr\xE9er mon compte</button>

      <div class="success" id="success">Compte cr\xE9\xE9 avec succ\xE8s.</div>
      <div class="error" id="error"></div>
    </div>
  </div>

  <script>
    const btn = document.getElementById('submitBtn');
    const success = document.getElementById('success');
    const error = document.getElementById('error');

    btn.addEventListener('click', async () => {
      success.style.display = 'none';
      error.style.display = 'none';

      const password = document.getElementById('password').value;

      try {
        const res = await fetch('/api/public/complete-account/${req.params.token}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');

        success.style.display = 'block';
      } catch (e) {
        error.textContent = e.message || 'Erreur cr\xE9ation compte';
        error.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  });
  const db = getAdminDb();
  if (db) {
    console.log("[Firebase Admin] Firestore OK \u2014 Admin Storage uploads enabled");
  } else {
    console.warn(
      "[Firebase Admin] NOT initialized \u2014 photo uploads will fail. Check FIREBASE_SERVICE_ACCOUNT secret."
    );
  }
  const httpServer = createServer(app2);
  return httpServer;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    const configuredOrigins = [
      process.env.EXPO_PUBLIC_APP_URL,
      process.env.EXPO_PUBLIC_API_BASE_URL,
      process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
      process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL,
      process.env.APP_WEB_BASE_URL
    ].filter(Boolean);
    configuredOrigins.forEach((origin) => {
      try {
        origins.add(new URL(origin).origin);
      } catch {
        origins.add(origin.replace(/\/$/, ""));
      }
    });
    const requestOrigin = req.header("origin");
    const normalizedOrigin = requestOrigin?.replace(/\/$/, "");
    const isLocalhost = normalizedOrigin?.startsWith("http://localhost:") || normalizedOrigin?.startsWith("http://127.0.0.1:");
    if (normalizedOrigin && (origins.has(normalizedOrigin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", normalizedOrigin);
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupSecurityHeaders(app2) {
  app2.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "geolocation=(self), camera=(self)");
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(
    express.urlencoded({
      extended: false,
      limit: "10mb"
    })
  );
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const routePath = req.path;
    res.on("finish", () => {
      if (!routePath.startsWith("/api")) return;
      log(`${req.method} ${routePath} ${res.statusCode} in ${Date.now() - start}ms`);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "Maintena";
  } catch {
    return "Maintena";
  }
}
function configureStatic(app2) {
  const appName = getAppName();
  const publicPath = path.resolve(process.cwd(), "public");
  const assetsPath = path.resolve(process.cwd(), "assets");
  const staticBuildPath = path.resolve(process.cwd(), "static-build");
  app2.get("/healthz", (_req, res) => {
    return res.status(200).json({ ok: true, app: appName });
  });
  if (fs.existsSync(publicPath)) {
    app2.use(express.static(publicPath, { extensions: ["html"] }));
  }
  if (fs.existsSync(assetsPath)) {
    app2.use("/assets", express.static(assetsPath));
  }
  if (fs.existsSync(staticBuildPath)) {
    app2.use(express.static(staticBuildPath));
  }
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  try {
    setupCors(app);
    setupSecurityHeaders(app);
    setupBodyParsing(app);
    setupRequestLogging(app);
    configureStatic(app);
    const server = await registerRoutes(app);
    setupErrorHandler(app);
    const port = parseInt(process.env.PORT || "8080", 10);
    server.listen(
      {
        port,
        host: "0.0.0.0",
        reusePort: true
      },
      () => {
        log(`express server serving on port ${port}`);
      }
    );
  } catch (error) {
    console.error("Server bootstrap error:", error);
    process.exit(1);
  }
})();
