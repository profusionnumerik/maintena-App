import { useState } from "react";
import {
  ActivityIndicator, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useCoPro } from "@/context/CoProContext";
import { useInterventions } from "@/context/InterventionsContext";
import { generateAnnualReport } from "@/lib/pdf";
import { CATEGORY_LABELS, Category, STATUS_LABELS, Status } from "@/shared/types";

const YEARS = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

const STATUS_COLORS: Record<Status, string> = {
  planifie: COLORS.warning,
  en_cours: COLORS.primary,
  termine: COLORS.success,
};

const CAT_COLORS: string[] = [
  COLORS.primary, COLORS.teal, COLORS.warning, "#8B5CF6",
  "#EC4899", "#F97316", "#10B981", "#3B82F6",
];

export default function StatsScreen() {
  const insets = useSafeAreaInsets();
  const { currentCopro } = useCoPro();
  const { interventions, stats } = useInterventions();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [exporting, setExporting] = useState(false);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const yearFiltered = interventions.filter(
    (i) => new Date(i.date).getFullYear() === selectedYear
  );

  const byCategory = Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    key: key as Category,
    label,
    count: yearFiltered.filter((i) => i.category === key).length,
  })).filter((c) => c.count > 0).sort((a, b) => b.count - a.count);

  const byStatus = (["planifie", "en_cours", "termine"] as Status[]).map((s) => ({
    status: s,
    count: yearFiltered.filter((i) => i.status === s).length,
  }));

  const maxCount = Math.max(...byCategory.map((c) => c.count), 1);

  const handleExport = async () => {
    if (!currentCopro) return;
    setExporting(true);
    try {
      await generateAnnualReport(currentCopro, interventions, selectedYear);
    } catch (e) {
      console.error("PDF export error:", e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: top + 16, paddingBottom: bottom + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topRow}>
        <Text style={styles.pageTitle}>Statistiques</Text>
        <Pressable
          style={({ pressed }) => [styles.exportBtn, pressed && { opacity: 0.85 }, exporting && styles.exportBtnDisabled]}
          onPress={handleExport}
          disabled={exporting}
        >
          {exporting
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
              <Ionicons name="document-text-outline" size={15} color="#fff" />
              <Text style={styles.exportBtnText}>Export PDF</Text>
            </>
          }
        </Pressable>
      </View>

      <View style={styles.yearRow}>
        {YEARS.map((y) => (
          <Pressable
            key={y}
            style={[styles.yearChip, y === selectedYear && styles.yearChipActive]}
            onPress={() => setSelectedYear(y)}
          >
            <Text style={[styles.yearChipText, y === selectedYear && styles.yearChipTextActive]}>
              {y}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.overviewGrid}>
        <View style={[styles.overviewCard, { backgroundColor: "#EFF6FF" }]}>
          <Text style={[styles.overviewValue, { color: COLORS.primary }]}>{yearFiltered.length}</Text>
          <Text style={styles.overviewLabel}>Interventions {selectedYear}</Text>
        </View>
        <View style={[styles.overviewCard, { backgroundColor: "#D1FAE5" }]}>
          <Text style={[styles.overviewValue, { color: COLORS.success }]}>
            {yearFiltered.filter((i) => i.status === "termine").length}
          </Text>
          <Text style={styles.overviewLabel}>Terminées</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Par statut</Text>
        <View style={styles.statusRow}>
          {byStatus.map(({ status, count }) => (
            <View key={status} style={styles.statusCard}>
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status] }]} />
              <Text style={styles.statusCount}>{count}</Text>
              <Text style={styles.statusLabel}>{STATUS_LABELS[status]}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Par catégorie — {selectedYear}</Text>
        {byCategory.length === 0 ? (
          <Text style={styles.emptyText}>Aucune intervention cette année</Text>
        ) : (
          byCategory.map((c, idx) => (
            <View key={c.key} style={styles.barRow}>
              <Text style={styles.barLabel}>{c.label}</Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    {
                      width: `${(c.count / maxCount) * 100}%`,
                      backgroundColor: CAT_COLORS[idx % CAT_COLORS.length],
                    },
                  ]}
                />
              </View>
              <Text style={styles.barCount}>{c.count}</Text>
            </View>
          ))
        )}
      </View>

      {stats.ratedCount > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Note moyenne</Text>
          <View style={styles.ratingCard}>
            <Text style={styles.ratingValue}>{stats.avgRating.toFixed(1)}</Text>
            <Text style={styles.ratingMax}>/4</Text>
            <Text style={styles.ratingStars}>{"★".repeat(Math.round(stats.avgRating))}{"☆".repeat(4 - Math.round(stats.avgRating))}</Text>
            <Text style={styles.ratingSubtitle}>sur {stats.ratedCount} intervention{stats.ratedCount > 1 ? "s" : ""} notée{stats.ratedCount > 1 ? "s" : ""}</Text>
          </View>
        </View>
      )}

      <View style={styles.pdfSection}>
        <Ionicons name="document-text" size={28} color={COLORS.primary} />
        <Text style={styles.pdfTitle}>Rapport AG {selectedYear}</Text>
        <Text style={styles.pdfDesc}>
          Générez le rapport annuel complet pour votre assemblée générale, incluant toutes les interventions classées par catégorie.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.pdfBtn, pressed && { opacity: 0.85 }]}
          onPress={handleExport}
          disabled={exporting}
        >
          {exporting
            ? <ActivityIndicator color="#fff" size="small" />
            : <>
              <Ionicons name="download-outline" size={18} color="#fff" />
              <Text style={styles.pdfBtnText}>Générer le PDF AG {selectedYear}</Text>
            </>
          }
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 20, gap: 20 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text },
  exportBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  exportBtnDisabled: { opacity: 0.7 },
  exportBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  yearRow: { flexDirection: "row", gap: 8 },
  yearChip: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  yearChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  yearChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  yearChipTextActive: { color: "#fff" },
  overviewGrid: { flexDirection: "row", gap: 12 },
  overviewCard: { flex: 1, borderRadius: 16, padding: 16, gap: 4 },
  overviewValue: { fontSize: 32, fontFamily: "Inter_700Bold" },
  overviewLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  section: {
    backgroundColor: COLORS.surface, borderRadius: 18,
    padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12,
  },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  statusRow: { flexDirection: "row", justifyContent: "space-around" },
  statusCard: { alignItems: "center", gap: 4 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusCount: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text },
  statusLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  barLabel: { width: 80, fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  barTrack: { flex: 1, height: 10, backgroundColor: COLORS.border, borderRadius: 5, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 5 },
  barCount: { width: 24, fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "right" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center", paddingVertical: 12 },
  ratingCard: { alignItems: "center", paddingVertical: 8, gap: 4 },
  ratingValue: { fontSize: 48, fontFamily: "Inter_700Bold", color: COLORS.text },
  ratingMax: { fontSize: 16, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: -8 },
  ratingStars: { fontSize: 24, color: "#F59E0B", letterSpacing: 2 },
  ratingSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  pdfSection: {
    backgroundColor: "#EFF6FF", borderRadius: 18, padding: 20,
    alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#BFDBFE",
  },
  pdfTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  pdfDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 18 },
  pdfBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.primary, borderRadius: 14,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  pdfBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
