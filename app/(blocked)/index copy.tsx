import * as WebBrowser from "expo-web-browser";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { getApiUrl } from "@/lib/query-client";

const ANNUAL_PRICE_EUR = 169;
const LAUNCH_OFFER_LIMIT = 25;
const TABLET_OFFER_LABEL = `Tablette offerte pour les ${LAUNCH_OFFER_LIMIT} premiers`;
const PRICE_LABEL = `${ANNUAL_PRICE_EUR} € / an`;
const PAY_BUTTON_LABEL = `Payer et activer — ${ANNUAL_PRICE_EUR} €`;

export default function BlockedScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const {
    currentCopro,
    currentRole,
    userSubscription,
    refreshCoPros,
    refreshSubscription,
  } = useCoPro();

  const [loading, setLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const isAdmin = currentRole === "admin";
  const isExpired = userSubscription?.status === "expired";

  const handlePayment = async () => {
    if (!currentCopro || !user) return;

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const apiUrl = new URL(
        "/api/create-checkout-session",
        getApiUrl()
      ).toString();

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coProId: currentCopro.id,
          userId: user.uid,
          adminEmail: user.email ?? "",
          coProName: currentCopro.name ?? "",
          inviteCode: currentCopro.inviteCode ?? "",
        }),
      });

      const data = await res.json();

      if (data.url) {
        await WebBrowser.openBrowserAsync(data.url);
        await refreshSubscription();
        await refreshCoPros();
      } else if (data.error) {
        Alert.alert("Erreur", data.error);
      }
    } catch {
      Alert.alert(
        "Erreur",
        "Impossible de créer la session de paiement. Vérifiez la configuration Stripe."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleShareCode = async () => {
    if (!currentCopro) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      await Share.share({
        message:
          `Rejoignez ma copropriété "${currentCopro.name}" sur Maintena.\n` +
          `Code d'invitation : ${currentCopro.inviteCode}\n\n` +
          `Offre de lancement : ${PRICE_LABEL} — ${TABLET_OFFER_LABEL}.`,
      });
    } catch {}
  };

  const handleResendCode = async () => {
    if (!currentCopro || !user?.email) return;

    setEmailLoading(true);
    setEmailSent(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const apiUrl = new URL("/api/resend-invite-code", getApiUrl()).toString();

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminEmail: user.email,
          coProName: currentCopro.name,
          inviteCode: currentCopro.inviteCode,
        }),
      });

      const data = await res.json();

      if (data.sent) {
        setEmailSent(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Erreur", data.error ?? "Impossible d'envoyer l'email.");
      }
    } catch {
      Alert.alert(
        "Erreur",
        "Impossible d'envoyer l'email. Vérifiez votre connexion."
      );
    } finally {
      setEmailLoading(false);
    }
  };

  const expiryDate = userSubscription?.expiresAt
    ? new Date(userSubscription.expiresAt).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={styles.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View
        style={[
          styles.inner,
          { paddingTop: top + 24, paddingBottom: bottom + 24 },
        ]}
      >
        {isAdmin ? (
          isExpired ? (
            <>
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: "rgba(239,68,68,0.12)" },
                ]}
              >
                <Ionicons
                  name="calendar-outline"
                  size={40}
                  color={COLORS.danger}
                />
              </View>

              <View style={styles.textGroup}>
                <Text style={styles.title}>
                  {currentCopro?.name ?? "Copropriété"}
                </Text>
                {currentCopro?.address ? (
                  <Text style={styles.address}>{currentCopro.address}</Text>
                ) : null}
              </View>

              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: "rgba(239,68,68,0.12)",
                    borderColor: "rgba(239,68,68,0.25)",
                  },
                ]}
              >
                <View
                  style={[styles.statusDot, { backgroundColor: COLORS.danger }]}
                />
                <Text style={[styles.statusText, { color: COLORS.danger }]}>
                  Abonnement expiré
                </Text>
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons
                    name="refresh-circle-outline"
                    size={22}
                    color={COLORS.danger}
                  />
                  <Text style={styles.cardTitle}>Renouveler l'abonnement</Text>
                </View>

                <Text style={styles.cardDesc}>
                  Votre abonnement{" "}
                  {expiryDate ? `a expiré le ${expiryDate}` : "est expiré"}.
                  Renouvelez-le pour retrouver l'accès à toutes vos
                  copropriétés.
                </Text>

                <View style={styles.offerBox}>
                  <View style={styles.offerBadge}>
                    <Ionicons
                      name="gift-outline"
                      size={14}
                      color={COLORS.primary}
                    />
                    <Text style={styles.offerBadgeText}>Offre de lancement</Text>
                  </View>
                  <Text style={styles.offerTitle}>{TABLET_OFFER_LABEL}</Text>
                  <Text style={styles.offerText}>
                    Application prête à l'emploi, solution clé en main pour les
                    syndics.
                  </Text>
                </View>

                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Abonnement annuel</Text>
                  <Text style={styles.priceValue}>{PRICE_LABEL}</Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.payBtn,
                    { backgroundColor: COLORS.danger },
                    pressed && { opacity: 0.88 },
                  ]}
                  onPress={handlePayment}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="card-outline" size={18} color="#fff" />
                      <Text style={styles.payBtnText}>Renouveler maintenant</Text>
                    </>
                  )}
                </Pressable>

                <Text style={styles.secureNote}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={12}
                    color={COLORS.textMuted}
                  />{" "}
                  Paiement sécurisé par Stripe
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.iconWrap}>
                <Ionicons name="time" size={40} color={COLORS.warning} />
              </View>

              <View style={styles.textGroup}>
                <Text style={styles.title}>
                  {currentCopro?.name ?? "Copropriété"}
                </Text>
                {currentCopro?.address ? (
                  <Text style={styles.address}>{currentCopro.address}</Text>
                ) : null}
              </View>

              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>En attente d'activation</Text>
              </View>

              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Ionicons name="card" size={22} color={COLORS.primary} />
                  <Text style={styles.cardTitle}>Activer votre abonnement</Text>
                </View>

                <Text style={styles.cardDesc}>
                  Payez une seule fois pour activer votre compte syndic. Vous
                  pourrez ensuite créer autant de copropriétés que vous
                  souhaitez et partager les codes d'invitation à vos
                  prestataires.
                </Text>

                <View style={styles.offerBox}>
                  <View style={styles.offerBadge}>
                    <Ionicons
                      name="rocket-outline"
                      size={14}
                      color={COLORS.primary}
                    />
                    <Text style={styles.offerBadgeText}>Lancement Maintena</Text>
                  </View>
                  <Text style={styles.offerTitle}>{TABLET_OFFER_LABEL}</Text>
                  <Text style={styles.offerText}>
                    Pour les {LAUNCH_OFFER_LIMIT} premières copropriétés :
                    tablette incluse, application installée, prête à l'emploi.
                  </Text>
                </View>

                <View style={styles.priceRow}>
                  <Text style={styles.priceLabel}>Abonnement annuel</Text>
                  <Text style={styles.priceValue}>{PRICE_LABEL}</Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.payBtn,
                    pressed && { opacity: 0.88 },
                  ]}
                  onPress={handlePayment}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="card-outline" size={18} color="#fff" />
                      <Text style={styles.payBtnText}>{PAY_BUTTON_LABEL}</Text>
                    </>
                  )}
                </Pressable>

                <Text style={styles.secureNote}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={12}
                    color={COLORS.textMuted}
                  />{" "}
                  Paiement sécurisé par Stripe
                </Text>

                <View style={styles.divider} />
              </View>
            </>
          )
        ) : (
          <>
            <View
              style={[
                styles.iconWrap,
                { backgroundColor: "rgba(14,186,170,0.12)" },
              ]}
            >
              <Ionicons
                name="hourglass-outline"
                size={40}
                color={COLORS.teal}
              />
            </View>

            <View style={styles.textGroup}>
              <Text style={styles.title}>
                {currentCopro?.name ?? "Copropriété"}
              </Text>
              {currentCopro?.address ? (
                <Text style={styles.address}>{currentCopro.address}</Text>
              ) : null}
            </View>

            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: "rgba(14,186,170,0.12)",
                  borderColor: "rgba(14,186,170,0.25)",
                },
              ]}
            >
              <View
                style={[styles.statusDot, { backgroundColor: COLORS.teal }]}
              />
              <Text style={[styles.statusText, { color: COLORS.teal }]}>
                En attente du syndic
              </Text>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Ionicons
                  name="hourglass-outline"
                  size={22}
                  color={COLORS.teal}
                />
                <Text style={styles.cardTitle}>Activation en cours</Text>
              </View>

              <Text style={styles.cardDesc}>
                Votre copropriété n'est pas encore activée. Contactez votre
                syndic pour finaliser l'activation.
              </Text>

              <Pressable
                style={styles.refreshBtn}
                onPress={async () => {
                  setLoading(true);
                  await refreshCoPros();
                  setLoading(false);
                }}
              >
                {loading ? (
                  <ActivityIndicator color={COLORS.primary} size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="refresh-outline"
                      size={16}
                      color={COLORS.primary}
                    />
                    <Text style={styles.refreshBtnText}>
                      Vérifier le statut
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </>
        )}

        <Pressable style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  inner: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },

  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: "rgba(245,158,11,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  textGroup: {
    alignItems: "center",
    gap: 4,
  },

  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    textAlign: "center",
  },

  address: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.4)",
    textAlign: "center",
  },

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(245,158,11,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.warning,
  },

  statusText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.warning,
  },

  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  cardTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  cardDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  offerBox: {
    backgroundColor: "#F8FAFF",
    borderWidth: 1,
    borderColor: "#DBEAFE",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },

  offerBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },

  offerBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.primary,
  },

  offerTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },

  offerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 10,
    padding: 12,
  },

  priceLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
  },

  priceValue: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },

  payBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },

  payBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  secureNote: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    textAlign: "center",
  },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    height: 44,
  },

  refreshBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
  },

  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#F8FAFF",
    borderRadius: 12,
    height: 44,
    borderWidth: 1,
    borderColor: "#DBEAFE",
  },

  shareBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
  },

  divider: {
    height: 1,
    backgroundColor: "#E2E8F0",
  },

  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    height: 44,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },

  emailBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
  },

  emailSentBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ECFDF5",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },

  emailSentText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#065F46",
    lineHeight: 18,
  },

  logoutBtn: {
    paddingVertical: 8,
  },

  logoutText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.3)",
  },
});