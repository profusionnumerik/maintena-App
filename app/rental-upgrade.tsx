/**
 * Écran d'upgrade — Plans bailleur Maintena
 * Accessible depuis les modals de limite (logements, locataires).
 */
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import { apiRequest } from "@/lib/query-client";

const CONTACT_EMAIL = "contact@maintena-pro.fr";

// ─── Données des plans ────────────────────────────────────────────────────────

const PLANS = [
  {
    key:         "free",
    label:       "Gratuit",
    description: "Pour tester l'app avec un premier bien",
    price:       "0 €",
    period:      "",
    color:       "#64748B",
    highlight:   false,
    features: [
      { icon: "home-outline",           text: "1 logement" },
      { icon: "person-outline",         text: "1 locataire" },
      { icon: "folder-outline",         text: "5 Mo de stockage" },
      { icon: "document-text-outline",  text: "Quittances PDF" },
      { icon: "clipboard-outline",      text: "État des lieux" },
    ],
    missing: ["Logements supplémentaires", "Plus de locataires", "Stockage étendu"],
  },
  {
    key:         "starter",
    label:       "Starter",
    description: "Idéal pour le petit bailleur particulier",
    price:       "4,99 €",
    period:      "/mois",
    color:       "#3B82F6",
    highlight:   false,
    features: [
      { icon: "home-outline",           text: "Jusqu'à 4 logements" },
      { icon: "people-outline",         text: "4 locataires (1 par logement)" },
      { icon: "folder-outline",         text: "5 Mo de stockage" },
      { icon: "document-text-outline",  text: "Quittances PDF" },
      { icon: "clipboard-outline",      text: "États des lieux illimités" },
    ],
    missing: [],
  },
  {
    key:         "pro",
    label:       "Pro",
    description: "Pour les bailleurs avec un parc locatif actif",
    price:       "14,99 €",
    period:      "/mois",
    color:       "#8B5CF6",
    highlight:   true,
    features: [
      { icon: "home-outline",           text: "Jusqu'à 15 logements" },
      { icon: "people-outline",         text: "15 locataires" },
      { icon: "folder-outline",         text: "20 Mo de stockage" },
      { icon: "document-text-outline",  text: "Quittances PDF" },
      { icon: "clipboard-outline",      text: "États des lieux illimités" },
      { icon: "chatbubbles-outline",    text: "Messagerie bailleur/locataire" },
    ],
    missing: [],
  },
  {
    key:         "business",
    label:       "Business",
    description: "Pour les agences et gestionnaires de patrimoine",
    price:       "34,99 €",
    period:      "/mois",
    color:       "#0EBAAA",
    highlight:   false,
    note:        "+1,50 € / locataire au-delà de 100",
    features: [
      { icon: "home-outline",           text: "Logements illimités" },
      { icon: "people-outline",         text: "100 locataires inclus" },
      { icon: "folder-outline",         text: "20 Mo de stockage" },
      { icon: "business-outline",       text: "SIRET + raison sociale" },
      { icon: "document-text-outline",  text: "Quittances PDF" },
      { icon: "clipboard-outline",      text: "États des lieux illimités" },
      { icon: "star-outline",           text: "Support prioritaire" },
    ],
    missing: [],
  },
] as const;

// ─── Carte plan ───────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  isCurrent,
}: {
  plan: typeof PLANS[number];
  isCurrent: boolean;
}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    if (plan.key === "free" || isCurrent) return;
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const data  = await apiRequest(
        "POST",
        "/api/rental/create-checkout-session",
        { plan: plan.key, landlordEmail: user?.email ?? "" },
        { Authorization: `Bearer ${token}` }
      );
      if (data?.url) {
        await Linking.openURL(data.url);
      }
    } catch (e: any) {
      // Si Stripe pas configuré → fallback email
      const subject = encodeURIComponent(`Upgrade ${plan.label} — Maintena`);
      const body    = encodeURIComponent(
        `Bonjour,\n\nJe souhaite passer à l'offre ${plan.label} (${plan.price}${plan.period}).\n\nMerci.`
      );
      Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[
      card.wrap,
      plan.highlight && { borderColor: plan.color, borderWidth: 2 },
      isCurrent     && { borderColor: plan.color, borderWidth: 2, opacity: 0.85 },
    ]}>
      {plan.highlight && !isCurrent && (
        <View style={[card.badge, { backgroundColor: plan.color }]}>
          <Text style={card.badgeText}>Recommandé</Text>
        </View>
      )}
      {isCurrent && (
        <View style={[card.badge, { backgroundColor: "#22C55E" }]}>
          <Text style={card.badgeText}>Plan actuel</Text>
        </View>
      )}

      {/* En-tête */}
      <View style={[card.header, { backgroundColor: `${plan.color}12` }]}>
        <Text style={[card.label, { color: plan.color }]}>{plan.label}</Text>
        <Text style={card.description}>{plan.description}</Text>
        <View style={card.priceRow}>
          <Text style={[card.price, { color: plan.highlight ? plan.color : "#1E293B" }]}>
            {plan.price}
          </Text>
          {plan.period ? <Text style={card.period}>{plan.period}</Text> : null}
        </View>
        {"note" in plan && plan.note ? (
          <Text style={[card.note, { color: plan.color }]}>{plan.note}</Text>
        ) : null}
      </View>

      {/* Features */}
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
      {plan.key !== "free" && !isCurrent && (
        <Pressable
          style={({ pressed }) => [
            card.cta,
            { backgroundColor: plan.highlight ? plan.color : "transparent", borderColor: plan.color },
            !plan.highlight && { borderWidth: 1.5 },
            pressed && { opacity: 0.82 },
            loading && { opacity: 0.6 },
          ]}
          onPress={handleUpgrade}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator size="small" color={plan.highlight ? "#fff" : plan.color} />
            : <>
                <Ionicons name="card-outline" size={15} color={plan.highlight ? "#fff" : plan.color} />
                <Text style={[card.ctaText, !plan.highlight && { color: plan.color }]}>
                  S'abonner
                </Text>
              </>
          }
        </Pressable>
      )}
    </View>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function RentalUpgradeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { rentalPlan } = useAuth();
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
          <Text style={styles.heroTitle}>Choisir un plan</Text>
          <Text style={styles.heroSub}>
            Gérez plus de logements, plus de locataires{"\n"}et bénéficiez de plus de stockage.
          </Text>
        </View>

        {/* Cards */}
        <View style={styles.cards}>
          {PLANS.map((p) => (
            <PlanCard key={p.key} plan={p} isCurrent={rentalPlan === p.key} />
          ))}
        </View>

        {/* Note contact */}
        <View style={styles.contactNote}>
          <Ionicons name="information-circle-outline" size={14} color="rgba(255,255,255,0.35)" />
          <Text style={styles.contactNoteText}>
            Pas encore de paiement en ligne — envoyez-nous un email et nous activons votre compte sous 24h.
          </Text>
        </View>

        <Text style={styles.emailHint}>{CONTACT_EMAIL}</Text>
      </ScrollView>
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  back: {
    position: "absolute", left: 20, zIndex: 10,
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  backText: { fontSize: 15, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  scroll:   { paddingHorizontal: 16, gap: 24 },

  hero: { alignItems: "center", gap: 12 },
  crownWrap: {
    width: 68, height: 68, borderRadius: 22,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 1, borderColor: "rgba(245,158,11,0.25)",
    alignItems: "center", justifyContent: "center",
  },
  heroTitle: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: -0.6 },
  heroSub:   {
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
    backgroundColor: "#fff", borderRadius: 18, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(0,0,0,0.06)",
  },
  badge: {
    position: "absolute", top: 14, right: 14, zIndex: 1,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },

  header:      { padding: 20, paddingBottom: 16 },
  label:       { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, textTransform: "uppercase" },
  description: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#64748B", marginTop: 3, lineHeight: 17 },
  priceRow:    { flexDirection: "row", alignItems: "baseline", gap: 2, marginTop: 10 },
  price:    { fontSize: 32, fontFamily: "Inter_700Bold", color: "#1E293B", letterSpacing: -1 },
  period:   { fontSize: 14, fontFamily: "Inter_400Regular", color: "#64748B" },
  note:     { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 4 },

  featureList: { padding: 20, paddingTop: 8, gap: 10 },
  featureRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  featureIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#334155", flex: 1 },
  featureMissing: { color: "#94A3B8", textDecorationLine: "line-through" },

  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, margin: 16, marginTop: 4, borderRadius: 12, paddingVertical: 13,
  },
  ctaText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
