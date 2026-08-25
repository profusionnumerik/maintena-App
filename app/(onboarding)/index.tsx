import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  Image, Pressable, ScrollView, StyleSheet,
  Text, View, Platform, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { wConfirm } from "@/shared/dialogs";

// ─── Pill feature ─────────────────────────────────────────────────────────────

function Pill({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View style={[pill.wrap, { borderColor: `${color}30`, backgroundColor: `${color}12` }]}>
      <Ionicons name={icon as any} size={13} color={color} />
      <Text style={[pill.text, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Carte de choix ───────────────────────────────────────────────────────────

function ChoiceCard({
  icon, iconBg, iconColor, title, desc, onPress, loading = false, accent = false,
}: {
  icon: string; iconBg: string; iconColor: string;
  title: string; desc: string;
  onPress: () => void; loading?: boolean; accent?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        card.wrap,
        accent && { borderColor: `${iconColor}30`, backgroundColor: `${iconColor}08` },
        pressed && card.pressed,
      ]}
      onPress={onPress}
      disabled={loading}
    >
      <View style={[card.icon, { backgroundColor: iconBg }]}>
        {loading
          ? <ActivityIndicator size="small" color={iconColor} />
          : <Ionicons name={icon as any} size={24} color={iconColor} />}
      </View>
      <View style={card.body}>
        <Text style={card.title}>{title}</Text>
        <Text style={card.desc}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.2)" />
    </Pressable>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <View style={sec.row}>
      <View style={[sec.bar, { backgroundColor: color }]} />
      <Text style={[sec.text, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function OnboardingIndex() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { logout, user, setUserType } = useAuth();
  const { loadError, refreshCoPros, isLoading } = useCoPro();
  const [landlordLoading, setLandlordLoading] = useState(false);

  const paddingTop    = Platform.OS === "web" ? 24 : insets.top + 24;
  const paddingBottom = Platform.OS === "web" ? 24 : insets.bottom + 16;

  const handleLandlordChoice = async () => {
    setLandlordLoading(true);
    try {
      await setUserType("landlord");
    } catch {
      if (Platform.OS === "web") {
        window.alert("Impossible de configurer votre compte. Réessayez.");
      }
      setLandlordLoading(false);
    }
  };

  const handleLogout = () =>
    wConfirm("Déconnexion", "Voulez-vous vous déconnecter ?", logout, "Se déconnecter");

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={styles.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop, paddingBottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── En-tête ──────────────────────────────────────────────────────── */}
        <View style={styles.brand}>
          <Image
            source={require("../../assets/images/icon.png")}
            style={styles.logoImg}
            resizeMode="contain"
          />
          <Text style={styles.title}>Maintena</Text>
          <Text style={styles.subtitle}>
            Copropriété, location, états des lieux{"\n"}et interventions — tout en un.
          </Text>

          {/* Pills couvrant tous les usages */}
          <View style={styles.pillRow}>
            <Pill icon="business-outline"      label="Copropriété"     color="#60A5FA" />
            <Pill icon="key-outline"            label="Location"        color="#A78BFA" />
            <Pill icon="clipboard-outline"      label="États des lieux" color="#34D399" />
            <Pill icon="construct-outline"      label="Interventions"   color="#FBBF24" />
          </View>
        </View>

        {/* ── Erreur chargement ─────────────────────────────────────────────── */}
        {loadError && (
          <Pressable
            style={styles.errorBanner}
            onPress={() => refreshCoPros()}
          >
            <Ionicons name="warning" size={16} color="#FF6B35" />
            <Text style={styles.errorText}>
              Vos copropriétés n'ont pas pu être chargées. Appuyez pour réessayer.
            </Text>
          </Pressable>
        )}

        {/* ── SECTION 1 : Copropriété & Syndic ────────────────────────────── */}
        <View style={styles.section}>
          <SectionLabel label="Copropriété & Syndic" color="#60A5FA" />

          <ChoiceCard
            icon="add-circle-outline"
            iconBg="rgba(37,99,235,0.15)"
            iconColor={COLORS.primary}
            title="Créer ma copropriété"
            desc="Admin ou gestionnaire — configurez votre résidence et invitez les membres"
            onPress={() => router.push("/(onboarding)/create")}
          />

          <ChoiceCard
            icon="qr-code-outline"
            iconBg="rgba(14,186,170,0.15)"
            iconColor={COLORS.teal}
            title="Rejoindre avec un code"
            desc={loadError
              ? "Entrez votre code prestataire pour récupérer l'accès admin"
              : "J'ai reçu un code d'invitation pour rejoindre une résidence existante"}
            onPress={() => router.push("/(onboarding)/join")}
          />

          {loadError && (
            <ChoiceCard
              icon="refresh-outline"
              iconBg="rgba(255,107,53,0.12)"
              iconColor="#FF6B35"
              title={isLoading ? "Chargement…" : "Réessayer le chargement"}
              desc="Tentative de récupération de vos copropriétés existantes"
              onPress={refreshCoPros}
              loading={isLoading}
            />
          )}
        </View>

        {/* ── SECTION 2 : Location ────────────────────────────────────────── */}
        <View style={styles.section}>
          <SectionLabel label="Module location" color="#A78BFA" />

          <ChoiceCard
            icon="home-outline"
            iconBg="rgba(139,92,246,0.15)"
            iconColor="#8B5CF6"
            title="Je suis bailleur"
            desc="Gérez vos logements, loyers, états des lieux et interventions locataires"
            onPress={handleLandlordChoice}
            loading={landlordLoading}
            accent
          />

          <ChoiceCard
            icon="person-outline"
            iconBg="rgba(20,212,198,0.15)"
            iconColor={COLORS.teal}
            title="Je suis locataire"
            desc="Mon bailleur m'a envoyé un code d'invitation — accédez à votre espace"
            onPress={() => router.push("/(onboarding)/join-rental")}
            accent
          />
        </View>

        {/* ── Déconnexion ──────────────────────────────────────────────────── */}
        <Pressable style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={14} color="rgba(255,255,255,0.3)" />
          <Text style={styles.logoutText}>Se déconnecter ({user?.email})</Text>
        </Pressable>
      </ScrollView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1 },
  scroll:  { paddingHorizontal: 20, gap: 24 },

  brand:   { alignItems: "center", gap: 10 },
  logoImg: { width: 64, height: 64, borderRadius: 18 },
  title: {
    fontSize: 28, fontFamily: "Inter_700Bold",
    color: "#fff", letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 21,
  },
  pillRow: {
    flexDirection: "row", flexWrap: "wrap",
    justifyContent: "center", gap: 8, marginTop: 4,
  },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,107,53,0.12)",
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,107,53,0.3)",
  },
  errorText: {
    flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)", lineHeight: 18,
  },

  section: { gap: 10 },

  logoutBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 8,
  },
  logoutText: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.3)",
  },
});

const pill = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  text: { fontSize: 11, fontFamily: "Inter_500Medium" },
});

const card = StyleSheet.create({
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  icon: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  body:  { flex: 1, gap: 3 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  desc:  { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", lineHeight: 16 },
});

const sec = StyleSheet.create({
  row:  { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 2 },
  bar:  { width: 3, height: 14, borderRadius: 2 },
  text: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase" },
});
