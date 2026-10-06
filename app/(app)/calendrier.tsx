import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";
import { useInterventions } from "@/context/InterventionsContext";
import { CATEGORY_ICONS, CATEGORY_LABELS, STATUS_LABELS } from "@/shared/types";

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
                   "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const DAYS_FR   = ["L", "M", "M", "J", "V", "S", "D"];

const STATUS_DOT: Record<string, string> = {
  planifie: "#F59E0B",
  en_cours: "#3B82F6",
  termine:  "#10B981",
};

export default function CalendrierScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { interventions } = useInterventions();

  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // ── Build calendar grid ───────────────────────────────────────────────────

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset (0=Mon … 6=Sun)
  const startOffset = (firstDay.getDay() + 6) % 7;

  const cells: (number | null)[] = ([] as (number | null)[]).concat(
    Array<null>(startOffset).fill(null),
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );
  // Pad to full 7-column rows
  while (cells.length % 7 !== 0) cells.push(null);

  // ── Index interventions by day ────────────────────────────────────────────

  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const byDay = useMemo(() => {
    const map: Record<number, typeof interventions> = {};
    for (const iv of interventions) {
      if (!iv.date.startsWith(prefix)) continue;
      const d = parseInt(iv.date.split("-")[2], 10);
      if (!map[d]) map[d] = [];
      map[d].push(iv);
    }
    return map;
  }, [interventions, prefix]);

  // ── Selected day detail ───────────────────────────────────────────────────

  const todayStr = today.toISOString().split("T")[0];
  const [selected, setSelected] = useState<number | null>(today.getMonth() === month && today.getFullYear() === year ? today.getDate() : null);
  const selectedItems = selected ? (byDay[selected] ?? []) : [];
  const selectedStr = selected ? `${year}-${String(month + 1).padStart(2, "0")}-${String(selected).padStart(2, "0")}` : null;

  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Pressable onPress={prevMonth} style={styles.navBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={styles.monthTitle}>{MONTHS_FR[month]} {year}</Text>
        <Pressable onPress={nextMonth} style={styles.navBtn} hitSlop={10}>
          <Ionicons name="chevron-forward" size={20} color={COLORS.text} />
        </Pressable>
      </View>

      {/* Days header */}
      <View style={styles.daysRow}>
        {DAYS_FR.map((d, i) => (
          <Text key={i} style={[styles.dayLabel, i >= 5 && { color: "#EF4444" }]}>{d}</Text>
        ))}
      </View>

      {/* Calendar grid */}
      <View style={styles.grid}>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.gridRow}>
            {row.map((day, ci) => {
              if (!day) return <View key={ci} style={styles.cell} />;
              const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isToday   = iso === todayStr;
              const isSelected = day === selected;
              const items = byDay[day] ?? [];
              const dotColors = [...new Set(items.map((iv) => STATUS_DOT[iv.status] ?? "#94A3B8"))].slice(0, 3);

              return (
                <Pressable
                  key={ci}
                  style={[
                    styles.cell,
                    isToday    && styles.cellToday,
                    isSelected && styles.cellSelected,
                  ]}
                  onPress={() => setSelected(day === selected ? null : day)}
                >
                  <Text style={[
                    styles.cellText,
                    isToday    && styles.cellTextToday,
                    isSelected && styles.cellTextSelected,
                    (ci === 5 || ci === 6) && !isSelected && !isToday && { color: "#EF4444" },
                  ]}>
                    {day}
                  </Text>
                  {dotColors.length > 0 && (
                    <View style={styles.dotsRow}>
                      {dotColors.map((c, di) => (
                        <View key={di} style={[styles.dot, { backgroundColor: isSelected ? "#fff" : c }]} />
                      ))}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      {/* Detail panel */}
      <View style={styles.detailPanel}>
        {selected ? (
          <>
            <Text style={styles.detailTitle}>
              {selected} {MONTHS_FR[month]}
              {selectedItems.length > 0
                ? ` — ${selectedItems.length} intervention${selectedItems.length > 1 ? "s" : ""}`
                : " — Aucune intervention"}
            </Text>
            <FlatList
              data={selectedItems}
              keyExtractor={(iv) => iv.id}
              contentContainerStyle={{ paddingBottom: insets.bottom + 16, paddingTop: 8 }}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={styles.emptyDay}>
                  <Ionicons name="calendar-outline" size={32} color={COLORS.border} />
                  <Text style={styles.emptyDayText}>Aucune intervention ce jour</Text>
                </View>
              }
              renderItem={({ item: iv }) => {
                const catIcon = (CATEGORY_ICONS[iv.category] ?? "construct") as any;
                const dot = STATUS_DOT[iv.status] ?? "#94A3B8";
                return (
                  <Pressable
                    style={({ pressed }) => [styles.ivRow, pressed && { opacity: 0.75 }]}
                    onPress={() => router.push(`/intervention/${iv.id}`)}
                  >
                    <View style={[styles.ivAccent, { backgroundColor: dot }]} />
                    <View style={[styles.ivIcon, { backgroundColor: `${dot}18` }]}>
                      <Ionicons name={catIcon} size={16} color={dot} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ivTitle} numberOfLines={1}>{iv.title}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 }}>
                        <Text style={styles.ivCat}>{CATEGORY_LABELS[iv.category]}</Text>
                        <View style={[styles.ivStatusBadge, { backgroundColor: `${dot}18` }]}>
                          <Text style={[styles.ivStatusText, { color: dot }]}>{STATUS_LABELS[iv.status]}</Text>
                        </View>
                      </View>
                      {iv.assignedToName && (
                        <Text style={styles.ivAssigned} numberOfLines={1}>
                          <Ionicons name="person-outline" size={10} color={COLORS.textMuted} /> {iv.assignedToName}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={COLORS.border} />
                  </Pressable>
                );
              }}
            />
          </>
        ) : (
          <View style={styles.emptyDay}>
            <Ionicons name="finger-print-outline" size={32} color={COLORS.border} />
            <Text style={styles.emptyDayText}>Touchez un jour pour voir ses interventions</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 4,
  },
  backBtn: { padding: 6, marginRight: 4 },
  navBtn: { padding: 8 },
  monthTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },

  daysRow: { flexDirection: "row", paddingHorizontal: 8, paddingTop: 10, paddingBottom: 4 },
  dayLabel: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase" },

  grid: { paddingHorizontal: 8 },
  gridRow: { flexDirection: "row" },
  cell: {
    flex: 1, aspectRatio: 1,
    alignItems: "center", justifyContent: "center",
    borderRadius: 10, margin: 2, gap: 2,
  },
  cellToday: { borderWidth: 1.5, borderColor: COLORS.primary },
  cellSelected: { backgroundColor: COLORS.primary },
  cellText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  cellTextToday: { color: COLORS.primary, fontFamily: "Inter_700Bold" },
  cellTextSelected: { color: "#fff", fontFamily: "Inter_700Bold" },
  dotsRow: { flexDirection: "row", gap: 2, alignItems: "center", height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },

  detailPanel: { flex: 1, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12, paddingHorizontal: 16 },
  detailTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },

  ivRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 12,
    marginBottom: 8, borderWidth: 1, borderColor: COLORS.border,
    paddingVertical: 12, paddingRight: 12, paddingLeft: 0, overflow: "hidden",
  },
  ivAccent: { width: 4, alignSelf: "stretch" },
  ivIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  ivTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  ivCat: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  ivStatusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  ivStatusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  ivAssigned: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },

  emptyDay: { alignItems: "center", paddingVertical: 30, gap: 8 },
  emptyDayText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
});
