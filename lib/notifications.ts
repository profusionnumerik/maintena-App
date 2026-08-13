import { Platform } from "react-native";
import Constants from "expo-constants";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

const isExpoGo = Constants.appOwnership === "expo";

// L'import statique d'expo-notifications crashe dans Expo Go SDK 53 même avec un guard.
// On utilise un import dynamique pour ne charger le module que hors Expo Go.
if (!isExpoGo && Platform.OS !== "web") {
  import("expo-notifications").then((Notifications) => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }).catch(() => {});
}

export async function registerPushToken(uid: string): Promise<void> {
  if (Platform.OS === "web" || isExpoGo) return;

  const Notifications = await import("expo-notifications");

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return;

  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: "f942f5d6-18ac-41c4-89a0-4d9b2fe98138",
  })).data;

  await updateDoc(doc(db, "users", uid), { pushToken: token }).catch(() => {});
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
