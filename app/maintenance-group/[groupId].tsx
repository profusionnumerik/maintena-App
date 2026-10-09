import React, { useMemo } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { CATEGORY_ICONS, CATEGORY_LABELS } from "@/shared/types";
import { useInterventions } from "@/context/InterventionsContext";
import type { Intervention } from "@/types/intervention";

const STATUS_CONFIG = {
  termine:  { label: "Effectuée",  bg: "#D1FAE5", text: "#065F46", dot: "#10B981" },
  en_cours: { label: "En cours",   bg: "#EFF6FF", text: "#1E40AF", dot: "#3B82F6" },
  planifie: { label: "Planifiée",  bg: "#FFFBEB", text: "#92400E", dot: "#F59E0B" },
  en_retard:{ label: "En retard",  bg: "#FEE2E2", text: "#991B1B", dot: "#EF4444" },
};

function getEffectiveStatus(item: Intervention): keyof typeof STATUS_CONFIG {
  if (item.status === "termine") return "termine";
  if (item.status === "en_cours") return "en_cours";
  const today = new Date().toISOString().split("T")[0];
  if (item.date.split("T")[0] < today) return "en_retard";
  return "planifie";
}

function inferFrequency(items: Intervention[]): string {
  if (items.length < 2) return "Ponctuelle";
  const sorted = [...items].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86_400_000;
    gaps.push(gap);
  }
  const medianGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (medianGap <= 8)   return "Hebdomadaire";
  if (medianGap <= 20)  return "Bi-mensuelle";
  if (medianGap <= 40)  return "Mensuelle";
  if (medianGap <= 100) return "Trimestrielle";
  if (medianGap <= 200) return "Semestrielle";
  return "Annuelle";
}

export default function MaintenanceGroupScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const { interventions } = useInterventions();

  const groupItems = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const past = interventions
      .filter((i) => i.recurrenceGroupId === groupId && i.date.split("T")[0] <= today)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // plus récent en haut
    const future = interventions
      .filter((i) => i.recurrenceGroupId === groupId && i.date.split("T")[0] > today)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // plus proche en premier
    return [...past, ...future];
  }, [interventions, groupId]);

  const title = groupItems[0]?.title ?? "Maintenance";
  const category = groupItems[0]?.category;
  const iconName = (CATEGORY_ICONS[category ?? ""] ?? "repeat-outline") as keyof typeof Ionicons.glyphMap;
  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : "";
  const frequency = useMemo(() => inferFrequency(groupItems), [groupItems]);

  const doneCount = groupItems.filter((i) => i.status === "termine").length;
  const pct = groupItems.length > 0 ? Math.round((doneCount / groupItems.length) * 100) : 0;

  const nextItem = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const future = groupItems.filter(
      (i) => i.status !== "termine" && i.date.split("T")[0] >= today
    ).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (future.length > 0) return future[0];
    const overdue = groupItems.filter((i) => i.status !== "termine").sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    return overdue[0] ?? null;
  }, [groupItems]);

  const pastCount = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return groupItems.filter((i) => i.date.split("T")[0] <= today).length;
  }, [groupItems]);

  const renderItem = ({ item, index }: { item: Intervention; index: number }) => {
    const today = new Date().toISOString().split("T")[0];
    const isFutureStart = index === pastCount && pastCount > 0 && pastCount < groupItems.length;
    const effectiveStatus = getEffectiveStatus(item);
    const sc = STATUS_CONFIG[effectiveStatus];
    const dateStr = new Date(item.date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });

    const checklist = item.cleaningChecklist ?? {};
    const checklistKeys = Object.keys(checklist);
    const doneChecklist = Object.values(checklist).filter(Boolean).length;

    return (
      <>
        {isFutureStart && (
          <View style={styles.sectionDivider}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerLabel}>À venir</Text>
            <View style={styles.sectionDividerLine} />
          </View>
        )}
      <Pressable
        style={({ pressed }) => [styles.card, pressed && { opacity: 0.82 }]}
        onPress={() => router.push(`/intervention/${item.id}` as any)}
      >
        <View style={styles.cardTop}>
          <View style={[styles.statusDot, { backgroundColor: sc.dot }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardDate}>{dateStr}</Text>
            {item.recurrenceIndex && item.recurrenceTotal ? (
              <Text style={styles.cardSub}>
                Passage {item.recurrenceIndex} / {item.recurrenceTotal}
              </Text>
            ) : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.text }]}>{sc.label}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
        </View>

        {/* Résumé checklist si nettoyage */}
        {checklistKeys.length > 0 && (
          <View style={styles.checklistRow}>
            <Ionicons
              name={doneChecklist === checklistKeys.length ? "checkmark-circle" : "checkmark-circle-outline"}
              size={13}
              color={doneChecklist === checklistKeys.length ? "#10B981" : COLORS.textMuted}
            />
            <Text style={styles.checklistSummary}>
              {doneChecklist}/{checklistKeys.length} zones effectuées
            </Text>
          </View>
        )}

        {/* Prestataire */}
        {(item.assignedToName || item.technician) && (
          <View style={styles.checklistRow}>
            <Ionicons name="person-outline" size={13} color={COLORS.textMuted} />
            <Text style={styles.checklistSummary}>
              {item.assignedToName ?? item.technician}
            </Text>
          </View>
        )}
      </Pressable>
      </>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={2}>{title}</Text>
          <View style={styles.headerMeta}>
            <Ionicons name="repeat-outline" size={11} color={COLORS.teal} />
            <Text style={styles.headerMetaText}>{frequency}</Text>
            {categoryLabel ? (
              <>
                <Text style={styles.headerMetaDot}>·</Text>
                <Ionicons name={iconName} size={11} color={COLORS.textMuted} />
                <Text style={styles.headerMetaText}>{categoryLabel}</Text>
              </>
            ) : null}
          </View>
        </View>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{doneCount}</Text>
          <Text style={styles.statLabel}>effectuées</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{groupItems.length - doneCount}</Text>
          <Text style={styles.statLabel}>restantes</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{pct}%</Text>
          <Text style={styles.statLabel}>avancement</Text>
        </View>
      </View>
      <View style={styles.progressBarWrap}>
        <View style={[styles.progressBarFill, { width: `${pct}%` as any }]} />
      </View>

      {/* Bouton prochaine intervention */}
      {nextItem && (
        <Pressable
          style={({ pressed }) => [styles.nextBtn, pressed && { opacity: 0.82 }]}
          onPress={() => router.push(`/intervention/${nextItem.id}` as any)}
        >
          <Ionicons name="arrow-forward-circle-outline" size={18} color="#fff" />
          <Text style={styles.nextBtnText}>
            Prochaine intervention —{" "}
            {new Date(nextItem.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
          </Text>
        </Pressable>
      )}

      {/* Liste chronologique */}
      <FlatList
        data={groupItems}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ gap: 4, marginBottom: 4 }}>
            <Text style={styles.listLabel}>
              {groupItems.length} passage{groupItems.length !== 1 ? "s" : ""}
            </Text>
            {pastCount > 0 && (
              <Text style={styles.sectionDividerLabel}>Historique</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="repeat-outline" size={40} color={COLORS.border} />
            <Text style={styles.emptyText}>Aucune occurrence trouvée</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.background,
    alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  headerTitle: {
    fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text,
    lineHeight: 24,
  },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  headerMetaText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  headerMetaDot: { fontSize: 12, color: COLORS.border, marginHorizontal: 2 },

  statsBar: {
    flexDirection: "row", backgroundColor: COLORS.surface,
    paddingHorizontal: 16, paddingVertical: 14, gap: 0,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  statItem: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },

  progressBarWrap: {
    height: 4, backgroundColor: COLORS.border,
    marginHorizontal: 0,
  },
  progressBarFill: {
    height: 4, backgroundColor: "#10B981", borderRadius: 2,
  },

  nextBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.primary,
    marginHorizontal: 16, marginTop: 16, marginBottom: 4,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12,
  },
  nextBtnText: {
    fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff",
    flex: 1,
  },

  listLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted, textTransform: "uppercase",
    letterSpacing: 0.5, marginBottom: 8,
  },
  list: { paddingHorizontal: 16, paddingTop: 16 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14, marginBottom: 10,
    padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    gap: 8,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardDate: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  checklistRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  checklistSummary: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  empty: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: "Inter_500Medium", color: COLORS.textMuted },

  sectionDivider: {
    flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 12,
  },
  sectionDividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  sectionDividerLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5,
  },
});
