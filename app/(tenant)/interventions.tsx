import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Platform, ScrollView,
  Pressable, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import type { PropertyIntervention, RentalInterventionStatus } from "@/shared/types";
import {
  RENTAL_INTERVENTION_STATUS_LABELS,
  RENTAL_INTERVENTION_STATUS_COLORS,
} from "@/shared/types";

// ─── Constantes ───────────────────────────────────────────────────────────────

const CAT_ICONS: Record<string, string> = {
  plomberie:   "water-outline",
  electricite: "flash-outline",
  chauffage:   "flame-outline",
  serrurerie:  "key-outline",
  menuiserie:  "hammer-outline",
  toiture:     "umbrella-outline",
  peinture:    "brush-outline",
  nettoyage:   "sparkles-outline",
  autre:       "construct-outline",
};

type FilterKey = "all" | RentalInterventionStatus;

const FILTER_TABS: { key: FilterKey; label: string; icon: string }[] = [
  { key: "all",         label: "Toutes",    icon: "list-outline" },
  { key: "new",         label: "À faire",   icon: "alert-circle-outline" },
  { key: "scheduled",   label: "Planifiée", icon: "calendar-outline" },
  { key: "in_progress", label: "En cours",  icon: "construct-outline" },
  { key: "completed",   label: "Terminée",  icon: "checkmark-circle-outline" },
];

// ─── Carte intervention ───────────────────────────────────────────────────────

function InterventionCard({ item }: { item: PropertyIntervention }) {
  const statusColor = RENTAL_INTERVENTION_STATUS_COLORS[item.status];
  const statusLabel = RENTAL_INTERVENTION_STATUS_LABELS[item.status];
  const titleLow = item.title.toLowerCase();
  const catKey   = Object.keys(CAT_ICONS).find((k) => titleLow.includes(k)) ?? "autre";
  const catIcon  = CAT_ICONS[catKey];
  const [expanded, setExpanded] = useState(false);

  const formattedDate = item.scheduledDate
    ? new Date(item.scheduledDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;
  const formattedCreated = new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

  return (
    <Pressable
      style={[c.card, item.status === "completed" && c.cardDone]}
      onPress={() => setExpanded((v) => !v)}
    >
      {/* Rail coloré */}
      <View style={[c.rail, { backgroundColor: statusColor }]} />

      <View style={c.body}>
        {/* Ligne principale */}
        <View style={c.topRow}>
          <View style={[c.iconBox, { backgroundColor: statusColor + "22" }]}>
            <Ionicons name={catIcon as any} size={16} color={statusColor} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[c.title, item.status === "completed" && c.titleDone]} numberOfLines={expanded ? undefined : 1}>
              {item.title}
            </Text>
            <Text style={c.meta}>Ajouté le {formattedCreated}</Text>
          </View>
          <View style={[c.statusBadge, { backgroundColor: statusColor + "22" }]}>
            <View style={[c.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[c.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color="rgba(255,255,255,0.22)" />
        </View>

        {/* Contenu étendu */}
        {expanded && (
          <View style={c.expandedBody}>
            {item.description ? (
              <Text style={c.desc}>{item.description}</Text>
            ) : null}

            {formattedDate && (
              <View style={c.infoRow}>
                <Ionicons name="calendar-outline" size={13} color="#3B82F6" />
                <Text style={c.infoText}>Planifiée le {formattedDate}</Text>
              </View>
            )}

            {item.completedDate && (
              <View style={c.infoRow}>
                <Ionicons name="checkmark-circle-outline" size={13} color="#10B981" />
                <Text style={[c.infoText, { color: "#10B981" }]}>
                  Terminée le {new Date(item.completedDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
                </Text>
              </View>
            )}

            {item.estimatedCost != null && (
              <View style={c.infoRow}>
                <Ionicons name="cash-outline" size={13} color="rgba(255,255,255,0.4)" />
                <Text style={c.infoText}>
                  Coût estimé : {item.estimatedCost.toLocaleString("fr-FR")} €
                  {item.finalCost != null ? ` · Final : ${item.finalCost.toLocaleString("fr-FR")} €` : ""}
                </Text>
              </View>
            )}

            {item.report ? (
              <View style={c.reportBox}>
                <Ionicons name="document-text-outline" size={12} color="#8B5CF6" />
                <Text style={c.reportText}>{item.report}</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const c = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  cardDone:    { opacity: 0.75 },
  rail:        { width: 4, alignSelf: "stretch" },
  body:        { flex: 1, padding: 14, gap: 8 },
  topRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox:     { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title:       { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  titleDone:   { color: "rgba(255,255,255,0.5)" },
  meta:        { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexShrink: 0 },
  statusDot:   { width: 5, height: 5, borderRadius: 3 },
  statusText:  { fontSize: 10, fontFamily: "Inter_700Bold" },
  expandedBody: { gap: 8, paddingTop: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)" },
  desc:        { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", lineHeight: 18 },
  infoRow:     { flexDirection: "row", alignItems: "center", gap: 7 },
  infoText:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)" },
  reportBox:   {
    flexDirection: "row", alignItems: "flex-start", gap: 7,
    backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 8, padding: 10,
    borderLeftWidth: 2, borderLeftColor: "#8B5CF6",
  },
  reportText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", lineHeight: 17 },
});

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function TenantInterventions() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { rentalInfo } = useAuth();
  const paddingTop = Platform.OS === "web" ? 12 : insets.top + 12;

  const [interventions, setInterventions] = useState<PropertyIntervention[]>([]);
  const [loading, setLoading]             = useState(true);
  const [filter, setFilter]               = useState<FilterKey>("all");

  useEffect(() => {
    if (!rentalInfo?.propertyId) { setLoading(false); return; }
    return onSnapshot(
      query(
        collection(db, "properties", rentalInfo.propertyId, "interventions"),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        setInterventions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyIntervention)));
        setLoading(false);
      },
      (err) => { console.warn("[tenant/interventions]", err); setLoading(false); }
    );
  }, [rentalInfo?.propertyId]);

  const active   = interventions.filter((i) => i.status !== "completed" && i.status !== "cancelled");
  const filtered = filter === "all"
    ? interventions.filter((i) => i.status !== "cancelled")
    : interventions.filter((i) => i.status === filter);

  // Comptes par onglet
  const counts: Record<FilterKey, number> = {
    all:         interventions.filter((i) => i.status !== "cancelled").length,
    new:         interventions.filter((i) => i.status === "new").length,
    assigned:    interventions.filter((i) => i.status === "assigned").length,
    scheduled:   interventions.filter((i) => i.status === "scheduled").length,
    in_progress: interventions.filter((i) => i.status === "in_progress").length,
    completed:   interventions.filter((i) => i.status === "completed").length,
    cancelled:   interventions.filter((i) => i.status === "cancelled").length,
  };

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={{ flex: 1 }}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    >
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Interventions</Text>
          <Text style={s.subtitle}>
            {loading ? "Chargement…" : `${active.length} en cours · ${interventions.length} total`}
          </Text>
        </View>
        {active.length > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{active.length}</Text>
          </View>
        )}
      </View>

      {/* Filtres */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.filterBar} contentContainerStyle={s.filterContent}
      >
        {FILTER_TABS.map((tab) => {
          const count = counts[tab.key] ?? 0;
          const active = filter === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[s.tab, active && s.tabActive]}
              onPress={() => setFilter(tab.key)}
            >
              <Ionicons
                name={tab.icon as any} size={12}
                color={active ? "#fff" : "rgba(255,255,255,0.4)"}
              />
              <Text style={[s.tabText, active && s.tabTextActive]}>
                {tab.label}{count > 0 ? ` (${count})` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Contenu */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={COLORS.teal} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="construct-outline" size={52} color="rgba(255,255,255,0.15)" />
          <Text style={s.emptyTitle}>
            {interventions.length === 0 ? "Aucune intervention" : "Aucun résultat"}
          </Text>
          <Text style={s.emptyDesc}>
            {interventions.length === 0
              ? "Les interventions planifiées par votre bailleur apparaîtront ici."
              : "Essayez un autre filtre."}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
          {filtered.map((item) => <InterventionCard key={item.id} item={item} />)}
        </ScrollView>
      )}
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingBottom: 14,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  title:    { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 2 },
  badge: {
    minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 6,
    backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },

  filterBar:     { flexGrow: 0 },
  filterContent: { paddingHorizontal: 20, paddingVertical: 10, gap: 8 },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  tabActive:    { backgroundColor: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.3)" },
  tabText:      { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)" },
  tabTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },

  list:   { padding: 16, gap: 10, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.4)", textAlign: "center" },
  emptyDesc:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.25)", textAlign: "center", lineHeight: 19 },
});
