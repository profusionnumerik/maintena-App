// Token registration is handled in app/_layout.tsx via static Notifications import.
// This file only exports helper functions for sending notifications from the client.

export async function registerPushToken(_uid: string): Promise<void> {
  // No-op: registration is handled in _layout.tsx
}

// ─── URL du serveur ───────────────────────────────────────────────────────────

const SERVER_URL = "https://maintena-pro.fr";

// ─── Helpers d'envoi côté client ─────────────────────────────────────────────

/**
 * Notifie le bailleur d'un nouveau signalement locataire.
 * Appelé depuis le côté locataire après création du signalement.
 */
export async function notifyLandlordSignalement(opts: {
  propertyId:  string;
  category:    string;
  description: string;
  tenantName:  string;
}): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/api/rental/notify-signalement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch { /* silencieux — la notification est best-effort */ }
}

/**
 * Notifie le locataire qu'un signalement a été mis à jour par le bailleur.
 */
export async function notifyTenantReportUpdated(opts: {
  tenantUserId: string;
  status:       string;
  propertyId:   string;
}): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/api/rental/notify-report-updated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch { /* silencieux */ }
}

/**
 * Notifie le locataire qu'un état des lieux est prêt pour signature.
 * Appelé depuis le côté bailleur lors du partage de l'état des lieux.
 */
export async function notifyTenantInventoryShared(opts: {
  tenantUserId:    string;
  reportType:      string;
  propertyAddress: string;
}): Promise<void> {
  try {
    await fetch(`${SERVER_URL}/api/rental/notify-inventory-shared`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  } catch { /* silencieux */ }
}
