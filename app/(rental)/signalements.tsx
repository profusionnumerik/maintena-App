import {
  View, Text, StyleSheet, Platform, ScrollView,
  Pressable, Modal, TextInput, Alert, ActivityIndicator,
} from "react-native";
import { notifyTenantReportUpdated } from "@/lib/notifications";
import { HamburgerButton } from "@/components/rental/RentalDrawer";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState, useCallback } from "react";
import {
  collection, query, where, onSnapshot, updateDoc, doc,
  orderBy, getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import type { RentalProperty } from "@/shared/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportStatus = "pending" | "in_progress" | "resolved";
type ReportCategory =
  | "plomberie" | "electricite" | "chauffage" | "serrurerie"
  | "menage" | "nuisible" | "structure" | "autre";

interface TenantReport {
  id: string;
  propertyId: string;
  tenantUserId: string;
  category: ReportCategory;
  description: string;
  status: ReportStatus;
  landlordNote?:     string;  // Note interne (bailleur uniquement)
  landlordResponse?: string;  // Réponse visible par le locataire
  createdAt: string;
  updatedAt: string;
  // hydrated client-side
  propertyLabel?: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIES: Record<ReportCategory, { label: string; icon: string }> = {
  plomberie:    { label: "Plomberie",         icon: "water" },
  electricite:  { label: "Électricité",        icon: "flash" },
  chauffage:    { label: "Chauffage / Clim",   icon: "flame" },
  serrurerie:   { label: "Serrurerie",          icon: "key" },
  menage:       { label: "Propreté / Ménage",  icon: "brush" },
  nuisible:     { label: "Nuisibles",           icon: "bug" },
  structure:    { label: "Murs / Structure",    icon: "home" },
  autre:        { label: "Autre",               icon: "ellipsis-horizontal-circle" },
};

const STATUS_CONFIG: Record<ReportStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: "Nouveau",    color: "#EF4444", bg: "#FEF2F2" },
  in_progress: { label: "En cours",  color: "#F59E0B", bg: "#FFFBEB" },
  resolved:    { label: "Résolu",    color: "#10B981", bg: "#F0FDF4" },
};

const STATUS_NEXT: Record<ReportStatus, ReportStatus | null> = {
  pending:     "in_progress",
  in_progress: "resolved",
  resolved:    null,
};

const STATUS_NEXT_LABEL: Record<ReportStatus, string> = {
  pending:     "Marquer « En cours »",
  in_progress: "Marquer « Résolu »",
  resolved:    "",
};

const FILTER_TABS: Array<{ key: "all" | ReportStatus; label: string }> = [
  { key: "all",         label: "Tous" },
  { key: "pending",     label: "Nouveaux" },
  { key: "in_progress", label: "En cours" },
  { key: "resolved",    label: "Résolus" },
];

// ─── Composant détail ─────────────────────────────────────────────────────────

function DetailModal({
  report,
  onClose,
  onUpdated,
}: {
  report: TenantReport;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [note, setNote]           = useState(report.landlordNote ?? "");
  const [response, setResponse]   = useState(report.landlordResponse ?? "");
  const [saving, setSaving]       = useState(false);
  const cfg = STATUS_CONFIG[report.status];
  const cat = CATEGORIES[report.category] ?? CATEGORIES.autre;
  const nextStatus = STATUS_NEXT[report.status];

  const save = async (newStatus?: ReportStatus) => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        landlordNote:     note.trim(),
        landlordResponse: response.trim(),
        updatedAt: new Date().toISOString(),
      };
      if (newStatus) updates.status = newStatus;
      await updateDoc(
        doc(db, "properties", report.propertyId, "tenantReports", report.id),
        updates
      );
      // Notification push au locataire si changement de statut
      if (newStatus && report.tenantUserId && (newStatus === "in_progress" || newStatus === "resolved")) {
        notifyTenantReportUpdated({
          tenantUserId: report.tenantUserId,
          status:       newStatus,
          propertyId:   report.propertyId,
        });
      }
      onUpdated();
      if (newStatus) onClose();
    } catch {
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={onClose}
        />
        <View style={[detail.sheet, { paddingBottom: insets.bottom + 20 }]}>
          {/* Handle */}
          <View style={detail.handle} />

          {/* En-tête */}
          <View style={detail.header}>
            <View style={[detail.catIcon, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cat.icon as any} size={20} color={cfg.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={detail.catLabel}>{cat.label}</Text>
              {report.propertyLabel ? (
                <Text style={detail.propLabel}>{report.propertyLabel}</Text>
              ) : null}
            </View>
            <View style={[detail.badge, { backgroundColor: cfg.bg }]}>
              <Text style={[detail.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
          </View>

          <Text style={detail.desc}>{report.description}</Text>
          <Text style={detail.date}>
            Signalé le {new Date(report.createdAt).toLocaleDateString("fr-FR", {
              day: "numeric", month: "long", year: "numeric",
            })}
          </Text>

          {/* Réponse au locataire */}
          <View style={detail.fieldGroup}>
            <View style={detail.fieldLabelRow}>
              <Ionicons name="chatbubble-outline" size={13} color="#8B5CF6" />
              <Text style={detail.fieldLabel}>Réponse au locataire</Text>
            </View>
            <TextInput
              style={detail.noteInput}
              placeholder="Saisissez une réponse visible par le locataire…"
              placeholderTextColor={COLORS.textMuted}
              value={response}
              onChangeText={setResponse}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Note interne */}
          <View style={detail.fieldGroup}>
            <View style={detail.fieldLabelRow}>
              <Ionicons name="lock-closed-outline" size={13} color={COLORS.textMuted} />
              <Text style={[detail.fieldLabel, { color: COLORS.textMuted }]}>Note interne (bailleur uniquement)</Text>
            </View>
            <TextInput
              style={detail.noteInput}
              placeholder="Action prévue, contact artisan…"
              placeholderTextColor={COLORS.textMuted}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Boutons */}
          <View style={detail.actions}>
            <Pressable style={detail.saveBtn} onPress={() => save()} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={detail.saveBtnText}>Enregistrer la note</Text>
              )}
            </Pressable>

            {nextStatus && (
              <Pressable
                style={[detail.nextBtn, { borderColor: STATUS_CONFIG[nextStatus].color }]}
                onPress={() => save(nextStatus)}
                disabled={saving}
              >
                <Text style={[detail.nextBtnText, { color: STATUS_CONFIG[nextStatus].color }]}>
                  {STATUS_NEXT_LABEL[report.status]}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function RentalSignalements() {
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === "web" ? 67 + 24 : insets.top + 16;
  const { user } = useAuth();

  const [reports, setReports]         = useState<TenantReport[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<"all" | ReportStatus>("all");
  const [selected, setSelected]       = useState<TenantReport | null>(null);

  // Charge les rapports de toutes les propriétés du bailleur
  const loadReports = useCallback(() => {
    if (!user) return;

    let unsubscribers: (() => void)[] = [];

    const propQ = query(
      collection(db, "properties"),
      where("landlordId", "==", user.uid)
    );

    const unsubProps = onSnapshot(propQ, async (propSnap) => {
      unsubscribers.forEach((u) => u());
      unsubscribers = [];

      const properties = propSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<RentalProperty, "id">),
      }));

      if (properties.length === 0) {
        setReports([]);
        setLoading(false);
        return;
      }

      // Un Map mutable pour agréger les rapports de toutes les propriétés
      const reportMap = new Map<string, TenantReport[]>();

      let resolvedCount = 0;
      properties.forEach((prop) => {
        const rptQ = query(
          collection(db, "properties", prop.id, "tenantReports"),
          orderBy("createdAt", "desc")
        );

        const unsub = onSnapshot(rptQ, (snap) => {
          reportMap.set(
            prop.id,
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<TenantReport, "id">),
              propertyLabel: [prop.address, prop.city].filter(Boolean).join(", "),
            }))
          );

          // Recalcule la liste totale après chaque mise à jour
          const all = Array.from(reportMap.values())
            .flat()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setReports(all);
          resolvedCount++;
          if (resolvedCount >= properties.length) setLoading(false);
        });

        unsubscribers.push(unsub);
      });
    });

    return () => {
      unsubProps();
      unsubscribers.forEach((u) => u());
    };
  }, [user]);

  useEffect(() => {
    const unsub = loadReports();
    return unsub;
  }, [loadReports]);

  const filtered = filter === "all" ? reports : reports.filter((r) => r.status === filter);
  const pendingCount = reports.filter((r) => r.status === "pending").length;

  return (
    <View style={[styles.root, { paddingTop }]}>
      {/* Header */}
      <View style={styles.header}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title}>Signalements</Text>
          <Text style={styles.subtitle}>
            {loading
              ? "Chargement…"
              : pendingCount > 0
              ? `${pendingCount} nouveau${pendingCount > 1 ? "x" : ""} · ${reports.length} total`
              : `${reports.length} signalement${reports.length > 1 ? "s" : ""}`}
          </Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingCount}</Text>
          </View>
        )}
      </View>

      {/* Filtres */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterBar}
        contentContainerStyle={styles.filterContent}
      >
        {FILTER_TABS.map((tab) => {
          const count =
            tab.key === "all"
              ? reports.length
              : reports.filter((r) => r.status === tab.key).length;
          return (
            <Pressable
              key={tab.key}
              style={[styles.filterTab, filter === tab.key && styles.filterTabActive]}
              onPress={() => setFilter(tab.key)}
            >
              <Text
                style={[styles.filterTabText, filter === tab.key && styles.filterTabTextActive]}
              >
                {tab.label} {count > 0 ? `(${count})` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Liste */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={56} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
          <Text style={styles.emptyTitle}>
            {reports.length === 0 ? "Aucun signalement" : "Aucun résultat pour ce filtre"}
          </Text>
          <Text style={styles.emptyDesc}>
            {reports.length === 0
              ? "Vos locataires peuvent signaler des problèmes depuis leur espace."
              : "Essayez un autre filtre."}
          </Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 40 }}>
          {filtered.map((report) => {
            const cfg = STATUS_CONFIG[report.status];
            const cat = CATEGORIES[report.category] ?? CATEGORIES.autre;
            return (
              <Pressable
                key={report.id}
                style={styles.card}
                onPress={() => setSelected(report)}
              >
                <View style={[styles.catDot, { backgroundColor: cfg.bg }]}>
                  <Ionicons name={cat.icon as any} size={18} color={cfg.color} />
                </View>

                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardCat}>{cat.label}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.cardDesc} numberOfLines={2}>
                    {report.description}
                  </Text>
                  {report.propertyLabel ? (
                    <Text style={styles.cardProp} numberOfLines={1}>
                      <Ionicons name="home-outline" size={11} color={COLORS.textMuted} /> {report.propertyLabel}
                    </Text>
                  ) : null}
                  <Text style={styles.cardDate}>
                    {new Date(report.createdAt).toLocaleDateString("fr-FR", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                  </Text>
                </View>

                <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Modale détail */}
      {selected && (
        <DetailModal
          report={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => setSelected(null)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title:    { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  badge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#EF4444",
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },

  filterBar: { flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  filterContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterTab: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: "#F8F8F8",
  },
  filterTabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  filterTabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  filterTabTextActive: { color: "#fff" },

  list: { flex: 1 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff",
    marginHorizontal: 16, marginTop: 12,
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  catDot: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1, gap: 3 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  cardCat: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 },
  cardProp: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  cardDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "center" },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
});

const detail = StyleSheet.create({
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
    maxHeight: "85%",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 20,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  catIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  catLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  propLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  desc: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    lineHeight: 22, marginBottom: 8,
    backgroundColor: "#F8F8F8", borderRadius: 10, padding: 14,
  },
  date: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 16 },

  noteLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  fieldGroup: { marginBottom: 12 },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  noteInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    minHeight: 80, textAlignVertical: "top",
    marginBottom: 16,
  },

  actions: { gap: 10 },
  saveBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: "center",
  },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  nextBtn: {
    borderRadius: 12, borderWidth: 1.5,
    paddingVertical: 13, alignItems: "center",
  },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
