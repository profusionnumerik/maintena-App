/**
 * Écran d'upgrade Pro — Plan gratuit → Pro bailleur
 * Accessible depuis les modals de limite (logements, locataires).
 */
import {
  Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";

const CONTACT_EMAIL = "contact@maintena.app";

// ─── Données des plans ────────────────────────────────────────────────────────

const PLANS = [
  {
    key: "free",
    label: "Gratuit",
    price: "0 €",
    period: "",
    color: "#64748B",
    highlight: false,
    features: [
      { icon: "home-outline",        text: "1 logement" },
      { icon: "person-outline",      text: "1 locataire" },
      { icon: "folder-outline",      text: "200 Mo de stockage" },
      { icon: "document-text-outline", text: "Quittances PDF" },
      { icon: "clipboard-outline",   text: "État des lieux" },
    ],
    missing: [
      "Plusieurs logements",
      "Plusieurs locataires",
      "Stockage étendu",
      "Support prioritaire",
    ],
  },
  {
    key: "pro",
    label: "Pro Particulier",
    price: "4,99 €",
    period: "/mois",
    color: "#8B5CF6",
    highlight: true,
    features: [
      { icon: "home-outline",        text: "Jusqu'à 5 logements" },
      { icon: "people-outline",      text: "Locataires illimités" },
      { icon: "folder-outline",      text: "5 Go de stockage" },
      { icon: "document-text-outline", text: "Quittances PDF" },
      { icon: "clipboard-outline",   text: "États des lieux illimités" },
      { icon: "chatbubbles-outline", text: "Messagerie bailleur/locataire" },
    ],
    missing: [],
  },
  {
    key: "business",
    label: "Pro Société",
    price: "14,99 €",
    period: "/mois",
    color: "#0EBAAA",
    highlight: false,
    features: [
      { icon: "home-outline",        text: "Logements illimités" },
      { icon: "people-outline",      text: "Locataires illimités" },
      { icon: "folder-outline",      text: "20 Go de stockage" },
      { icon: "business-outline",    text: "SIRET + raison sociale" },
      { icon: "document-text-outline", text: "Quittances PDF" },
      { icon: "clipboard-outline",   text: "États des lieux illimités" },
      { icon: "star-outline",        text: "Support prioritaire" },
    ],
    missing: [],
  },
] as const;

// ─── Composant carte plan ─────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: typeof PLANS[number] }) {
  const handleContact = () => {
    const subject = encodeURIComponent(`Upgrade ${plan.label} — Maintena`);
    const body = encodeURIComponent(
      `Bonjour,\n\nJe souhaite passer à l'offre ${plan.label} (${plan.price}${plan.period}).\n\nMerci.`
    );
    Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`);
  };

  return (
    <View style={[card.wrap, plan.highlight && { borderColor: plan.color, borderWidth: 2 }]}>
      {plan.highlight && (
        <View style={[card.badge, { backgroundColor: plan.color }]}>
          <Text style={card.badgeText}>Recommandé</Text>
        </View>
      )}

      {/* En-tête */}
      <View style={[card.header, { backgroundColor: `${plan.color}12` }]}>
        <Text style={[card.label, { color: plan.color }]}>{plan.label}</Text>
        <View style={card.priceRow}>
          <Text style={[card.price, { color: plan.highlight ? plan.color : "#1E293B" }]}>
            {plan.price}
          </Text>
          {plan.period ? (
            <Text style={card.period}>{plan.period}</Text>
          ) : null}
        </View>
      </View>

      {/* Features incluses */}
      <View style={card.featureList}>
        {plan.features.map((f) => (
          <View key={f.text} style={card.featureRow}>
            <View style={[card.featureIcon, { backgroundColor: `${plan.color}18` }]}>
              <Ionicons name={f.icon as any} size={14} color={plan.color} />
            </View>
            <Text style={card.featureText}>{f.text}</Text>
          </View>
        ))}
        {plan.missing.map((f) => (
          <View key={f} style={card.featureRow}>
            <View style={[card.featureIcon, { backgroundColor: "#F1F5F9" }]}>
              <Ionicons name="close" size={14} color="#94A3B8" />
            </View>
            <Text style={[card.featureText, card.featureMissing]}>{f}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      {plan.key !== "free" && (
        <Pressable
          style={({ pressed }) => [
            card.cta,
            { backgroundColor: plan.highlight ? plan.color : "transparent", borderColor: plan.color },
            !plan.highlight && { borderWidth: 1.5 },
            pressed && { opacity: 0.82 },
          ]}
          onPress={handleContact}
        >
          <Ionicons
            name="mail-outline"
            size={15}
            color={plan.highlight ? "#fff" : plan.color}
          />
          <Text style={[card.ctaText, !plan.highlight && { color: plan.color }]}>
            Nous contacter
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function RentalUpgradeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === "web" ? 24 : insets.top + 8;

  return (
    <LinearGradient
      colors={["#0F172A", "#1E1B4B", "#0D2047"]}
      style={styles.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* Bouton retour */}
      <Pressable
        style={[styles.back, { top: paddingTop }]}
        onPress={() => router.back()}
        hitSlop={12}
      >
        <Ionicons name="arrow-back" size={22} color="rgba(255,255,255,0.7)" />
        <Text style={styles.backText}>Retour</Text>
      </Pressable>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: paddingTop + 48, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.crownWrap}>
            <Ionicons name="diamond-outline" size={34} color="#F59E0B" />
          </View>
          <Text style={styles.heroTitle}>Passer Pro</Text>
          <Text style={styles.heroSub}>
            Gérez plusieurs logements, plusieurs locataires{"\n"}et bénéficiez de plus de stockage.
          </Text>
        </View>

        {/* Cards */}
        <View style={styles.cards}>
          {PLANS.map((p) => <PlanCard key={p.key} plan={p} />)}
        </View>

        {/* Note contact */}
        <View style={styles.contactNote}>
          <Ionicons name="information-circle-outline" size={14} color="rgba(255,255,255,0.35)" />
          <Text style={styles.contactNoteText}>
            Pas encore de paiement en ligne — envoyez-nous un email et nous activons votre compte Pro sous 24h.
          </Text>
        </View>

        <Text style={styles.emailHint}>{CONTACT_EMAIL}</Text>
      </ScrollView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:  { flex: 1 },
  back: {
    position: "absolute", left: 20, zIndex: 10,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  backText: {
    fontSize: 15, fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.7)",
  },
  scroll:  { paddingHorizontal: 16, gap: 24 },

  hero: { alignItems: "center", gap: 12 },
  crownWrap: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  heroTitle: {
    fontSize: 28, fontFamily: "Inter_700Bold",
    color: "#fff", letterSpacing: -0.6,
  },
  heroSub: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 21,
  },

  cards: { gap: 14 },

  contactNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  contactNoteText: {
    flex: 1, fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.35)", lineHeight: 18,
  },
  emailHint: {
    textAlign: "center", fontSize: 12,
    fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.25)",
  },
});

const card = StyleSheet.create({
  wrap: {
    backgroundColor: "#fff", borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(0,0,0,0.06)",
  },
  badge: {
    position: "absolute", top: 14, right: 14, zIndex: 1,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },

  header: { padding: 20, paddingBottom: 16 },
  label:  { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 2, marginTop: 6 },
  price:  { fontSize: 32, fontFamily: "Inter_700Bold", color: "#1E293B", letterSpacing: -1 },
  period: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#64748B" },

  featureList: { padding: 20, paddingTop: 8, gap: 10 },
  featureRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  featureIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#334155", flex: 1 },
  featureMissing: { color: "#94A3B8", textDecorationLine: "line-through" },

  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, margin: 16, marginTop: 4,
    borderRadius: 12, paddingVertical: 13,
  },
  ctaText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
