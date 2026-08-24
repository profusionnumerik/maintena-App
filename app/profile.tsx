import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useInterventions } from "@/context/InterventionsContext";
import { useCoPro } from "@/context/CoProContext";
import { getApiUrl } from "@/lib/query-client";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ─── Calcul jours d'essai restants ───────────────────────────────────────────

function trialDaysLeft(creationTime?: string | null): number {
  if (!creationTime) return 30;
  const created = new Date(creationTime).getTime();
  const elapsed = Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24));
  return Math.max(0, 30 - elapsed);
}

// ─── Écran ────────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { stats } = useInterventions();
  const { userSubscription, currentRole } = useCoPro();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // Stats location
  const [nbProperties, setNbProperties] = useState(0);
  const [nbTenants,    setNbTenants]    = useState(0);
  const [nbReports,    setNbReports]    = useState(0);

  // Préférences notifications
  const [notifSignalement, setNotifSignalement] = useState(true);
  const [notifMessage,     setNotifMessage]     = useState(true);
  const [notifQuittance,   setNotifQuittance]   = useState(false);

  const isAdmin = currentRole === "admin";
  const daysLeft = trialDaysLeft(user?.metadata?.creationTime);
  const isTrialExpired = daysLeft === 0;
  const hasPaidSub = userSubscription?.status === "active";

  useEffect(() => {
    if (!user?.uid) return;
    // Logements du bailleur
    getDocs(query(collection(db, "properties"), where("landlordId", "==", user.uid)))
      .then(async (snap) => {
        setNbProperties(snap.size);
        let tenants = 0, reports = 0;
        await Promise.all(snap.docs.map(async (propDoc) => {
          const [tSnap, rSnap] = await Promise.all([
            getDocs(query(collection(db, "properties", propDoc.id, "tenants"), where("status", "==", "active"))),
            getDocs(collection(db, "properties", propDoc.id, "tenantReports")),
          ]);
          tenants += tSnap.size;
          reports += rSnap.size;
        }));
        setNbTenants(tenants);
        setNbReports(reports);
      })
      .catch(() => {});
  }, [user?.uid]);

  const handleBillingPortal = async () => {
    if (!user) return;
    setOpeningPortal(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(new URL("/api/billing-portal", getApiUrl()).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.url) Linking.openURL(data.url);
      else Alert.alert("Erreur", data.error ?? "Impossible d'ouvrir le portail.");
    } catch {
      Alert.alert("Erreur", "Impossible de joindre le serveur.");
    } finally {
      setOpeningPortal(false);
    }
  };

  const handleLogout = () => {
    wConfirm(
      "Déconnexion",
      "Voulez-vous vous déconnecter ?",
      async () => {
        setIsLoggingOut(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await logout();
        router.dismissAll();
      },
      "Se déconnecter",
    );
  };

  const initials = user?.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.[0].toUpperCase() ?? "?";

  const topPadding    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={s.root}>
      {/* Hero gradient */}
      <LinearGradient
        colors={[COLORS.dark, COLORS.darkMid]}
        style={[s.hero, { paddingTop: topPadding + 16 }]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      >
        <View style={s.heroHeader}>
          <Pressable onPress={() => router.back()} style={s.closeBtn}>
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={s.avatarWrap}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
        </View>

        <Text style={s.heroName}>{user?.displayName ?? "Bailleur"}</Text>
        <Text style={s.heroEmail}>{user?.email}</Text>

        {/* Stats logements */}
        <View style={s.heroStats}>
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{nbProperties}</Text>
            <Text style={s.heroStatLabel}>Logement{nbProperties > 1 ? "s" : ""}</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{nbTenants}</Text>
            <Text style={s.heroStatLabel}>Locataire{nbTenants > 1 ? "s" : ""}</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={[s.heroStatVal, { color: nbReports > 0 ? "#FCA5A5" : "#fff" }]}>{nbReports}</Text>
            <Text style={s.heroStatLabel}>Signalement{nbReports > 1 ? "s" : ""}</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: bottomPadding + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Abonnement ─────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Abonnement</Text>

          {hasPaidSub ? (
            <Pressable onPress={handleBillingPortal} disabled={openingPortal}
              style={({ pressed }) => [s.subCard, s.subCardActive, pressed && { opacity: 0.85 }]}>
              <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                {openingPortal
                  ? <ActivityIndicator size="small" color="#16A34A" />
                  : <Ionicons name="checkmark-circle" size={20} color="#16A34A" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.subTitle}>Abonnement actif</Text>
                <Text style={s.subSub}>Gérer, modifier ou résilier</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>
          ) : (
            <View style={[s.subCard, isTrialExpired ? s.subCardExpired : s.subCardTrial]}>
              <View style={[s.rowIcon, { backgroundColor: isTrialExpired ? "#FEF2F2" : "#FFF7ED" }]}>
                <Ionicons
                  name={isTrialExpired ? "warning-outline" : "time-outline"}
                  size={20}
                  color={isTrialExpired ? "#EF4444" : "#F59E0B"}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.subTitle, isTrialExpired && { color: "#EF4444" }]}>
                  {isTrialExpired ? "Période d'essai expirée" : `Période d'essai — ${daysLeft} jour${daysLeft > 1 ? "s" : ""} restant${daysLeft > 1 ? "s" : ""}`}
                </Text>
                <Text style={s.subSub}>
                  {isTrialExpired
                    ? "Souscrivez pour continuer à utiliser Maintena"
                    : "Accès complet à toutes les fonctionnalités"}
                </Text>
              </View>
              {isTrialExpired && (
                <View style={s.subBadge}>
                  <Text style={s.subBadgeText}>S'abonner</Text>
                </View>
              )}
            </View>
          )}

          {!hasPaidSub && (
            <View style={s.card}>
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                  <Ionicons name="star-outline" size={18} color="#8B5CF6" />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowLabel}>Forfait</Text>
                  <Text style={s.rowValue}>Bailleur — Essai gratuit 30 jours</Text>
                </View>
              </View>
              <View style={s.separator} />
              <View style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                  <Ionicons name="infinite-outline" size={18} color={COLORS.primary} />
                </View>
                <View style={s.rowContent}>
                  <Text style={s.rowLabel}>Inclus</Text>
                  <Text style={s.rowValue}>Logements illimités · États des lieux · Messagerie · Interventions</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* ── Notifications ───────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Notifications</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#FEF2F2" }]}>
                <Ionicons name="warning-outline" size={18} color="#EF4444" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowValue}>Nouveaux signalements</Text>
                <Text style={s.rowLabel}>Alertes locataire en temps réel</Text>
              </View>
              <Switch
                value={notifSignalement}
                onValueChange={setNotifSignalement}
                trackColor={{ true: "#8B5CF6", false: COLORS.border }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.separator} />

            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                <Ionicons name="chatbubbles-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowValue}>Nouveaux messages</Text>
                <Text style={s.rowLabel}>Messages vocaux et texte</Text>
              </View>
              <Switch
                value={notifMessage}
                onValueChange={setNotifMessage}
                trackColor={{ true: "#8B5CF6", false: COLORS.border }}
                thumbColor="#fff"
              />
            </View>

            <View style={s.separator} />

            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                <Ionicons name="document-text-outline" size={18} color="#16A34A" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowValue}>Rappels quittances</Text>
                <Text style={s.rowLabel}>Rappel mensuel d'émission</Text>
              </View>
              <Switch
                value={notifQuittance}
                onValueChange={setNotifQuittance}
                trackColor={{ true: "#8B5CF6", false: COLORS.border }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </View>

        {/* ── Compte ─────────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Compte</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#EFF6FF" }]}>
                <Ionicons name="person-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Nom</Text>
                <Text style={s.rowValue}>{user?.displayName ?? "Non renseigné"}</Text>
              </View>
            </View>
            <View style={s.separator} />
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#F0FDF4" }]}>
                <Ionicons name="mail-outline" size={18} color="#16A34A" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Email</Text>
                <Text style={s.rowValue}>{user?.email}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Application ─────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Application</Text>
          <View style={s.card}>
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#F5F3FF" }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#2563EB" />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Stockage</Text>
                <Text style={s.rowValue}>Firebase Firestore</Text>
              </View>
            </View>
            <View style={s.separator} />
            <View style={s.row}>
              <View style={[s.rowIcon, { backgroundColor: "#FFF7ED" }]}>
                <Ionicons name="server-outline" size={18} color={COLORS.warning} />
              </View>
              <View style={s.rowContent}>
                <Text style={s.rowLabel}>Version</Text>
                <Text style={s.rowValue}>Maintena 1.0</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ── Déconnexion ─────────────────────────────────────────────────── */}
        <Pressable
          onPress={handleLogout}
          disabled={isLoggingOut}
          style={({ pressed }) => [s.logoutBtn, pressed && { opacity: 0.85 }]}
        >
          {isLoggingOut
            ? <ActivityIndicator size="small" color={COLORS.danger} />
            : <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />}
          <Text style={s.logoutText}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: COLORS.background },

  hero:    { paddingHorizontal: 20, paddingBottom: 28, alignItems: "center" },
  heroHeader: { width: "100%", flexDirection: "row", justifyContent: "flex-end", marginBottom: 16 },
  closeBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  avatarWrap: { marginBottom: 14 },
  avatar:     { width: 72, height: 72, borderRadius: 24, backgroundColor: "#8B5CF6", alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.2)" },
  avatarText: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff" },
  heroName:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", marginBottom: 4 },
  heroEmail:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)", marginBottom: 20 },
  heroStats:  { flexDirection: "row", alignItems: "center", paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", width: "100%", justifyContent: "center" },
  heroStat:   { flex: 1, alignItems: "center" },
  heroStatVal:   { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  heroStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },
  heroStatDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.15)" },

  content: { padding: 16, gap: 16 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, paddingHorizontal: 4 },

  card: { backgroundColor: COLORS.card, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  row:  { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  rowValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: 62 },

  subCard:        { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1.5, padding: 16 },
  subCardTrial:   { backgroundColor: "#FFFBEB", borderColor: "#FCD34D" },
  subCardExpired: { backgroundColor: "#FEF2F2", borderColor: "#FECACA" },
  subCardActive:  { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  subTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  subSub:   { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  subBadge: { backgroundColor: "#8B5CF6", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  subBadgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },

  logoutBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16, backgroundColor: "#FEF2F2", borderRadius: 16, borderWidth: 1, borderColor: "#FECACA", marginTop: 4 },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.danger },
});
