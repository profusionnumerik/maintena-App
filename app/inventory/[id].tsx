/**
 * app/inventory/[id].tsx
 * Écran principal d'un rapport d'état des lieux.
 * Reçoit `id` (reportId) + `propertyId` en params de route.
 */
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { notifyTenantInventoryShared } from "@/lib/notifications";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  InventoryReport,
  INVENTORY_TYPE_LABELS,
  INVENTORY_TYPE_COLORS,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_COLORS,
} from "@/shared/types";

type TabId = "rooms" | "meters" | "keys" | "equipment" | "summary";

const SECTIONS: { id: TabId; label: string; icon: string; desc: string }[] = [
  { id: "rooms",     label: "Pièces & annexes", icon: "grid-outline",             desc: "Inspection pièce par pièce" },
  { id: "meters",    label: "Compteurs",         icon: "speedometer-outline",      desc: "Relevés eau, gaz, électricité" },
  { id: "keys",      label: "Clés & accès",      icon: "key-outline",              desc: "Inventaire des clés et badges" },
  { id: "equipment", label: "Équipements",        icon: "construct-outline",        desc: "Électroménager et mobilier" },
  { id: "summary",   label: "Résumé & signature", icon: "checkmark-circle-outline", desc: "Finaliser et signer" },
];

export default function InventoryDetail() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const router              = useRouter();
  const insets              = useSafeAreaInsets();
  const { user }            = useAuth();

  const [report, setReport]   = useState<InventoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);

  // Écoute directe via propertyId + id
  useEffect(() => {
    if (!id || !propertyId) return;
    const unsub = onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id),
      (snap) => {
        if (snap.exists()) {
          setReport({ id: snap.id, ...snap.data() } as InventoryReport);
        } else {
          setReport(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [id, propertyId]);

  const goToSection = (section: TabId) => {
    const base = `/inventory/${id}/${section}`;
    router.push(`${base}?propertyId=${propertyId}` as any);
  };

  // Repartager le rapport pour signature : touch updatedAt pour notifier le locataire
  const handleReshare = async () => {
    if (!report) return;
    const snap = report.propertySnapshot;
    Alert.alert(
      "Repartager pour signature",
      `Le rapport est accessible à ${snap.tenantFirstName} ${snap.tenantLastName} (${snap.tenantEmail}) dans son espace locataire.\n\nVoulez-vous lui rappeler de signer ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Confirmer",
          onPress: async () => {
            setResending(true);
            try {
              await updateDoc(
                doc(db, "properties", propertyId, "inventoryReports", id),
                { lastSharedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              );
              // Notification push au locataire (best-effort)
              if (report.tenantUserId) {
                notifyTenantInventoryShared({
                  tenantUserId:    report.tenantUserId,
                  reportType:      report.type ?? "entry",
                  propertyAddress: [snap.address, snap.city].filter(Boolean).join(", "),
                });
              }
              Alert.alert(
                "Rapport partagé ✓",
                `${snap.tenantFirstName} peut accéder à l'état des lieux et signer depuis son application.`
              );
            } catch {
              Alert.alert("Erreur", "Impossible de repartager le rapport.");
            } finally {
              setResending(false);
            }
          },
        },
      ]
    );
  };

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color="#8B5CF6" size="large" />
      </View>
    );
  }

  if (!report) {
    return (
      <View style={[s.root, s.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
        <Text style={s.notFound}>Rapport introuvable</Text>
        <Pressable style={s.backBtnAlt} onPress={() => router.back()}>
          <Text style={s.backBtnAltText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const typeColor   = INVENTORY_TYPE_COLORS[report.type];
  const statusColor = INVENTORY_STATUS_COLORS[report.status];
  const snap        = report.propertySnapshot;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop, borderBottomColor: typeColor + "66" }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={[s.headerType, { color: typeColor }]}>
            {INVENTORY_TYPE_LABELS[report.type]}
          </Text>
          <Text style={s.headerAddress} numberOfLines={1}>
            {snap.address}{snap.apartmentNumber ? ` — Apt. ${snap.apartmentNumber}` : ""}
          </Text>
          <Text style={s.headerSub}>{snap.tenantFirstName} {snap.tenantLastName}</Text>
        </View>
        <View style={[s.statusPill, { backgroundColor: statusColor + "18" }]}>
          <View style={[s.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[s.statusLabel, { color: statusColor }]}>
            {INVENTORY_STATUS_LABELS[report.status]}
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Info snapshot */}
        <View style={s.snapshotCard}>
          <View style={s.snapshotRow}>
            <Ionicons name="home-outline" size={15} color="#8B5CF6" />
            <Text style={s.snapshotText}>
              {snap.address}, {snap.postalCode} {snap.city}
            </Text>
          </View>
          {snap.surface ? (
            <View style={s.snapshotRow}>
              <Ionicons name="resize-outline" size={15} color="#8B5CF6" />
              <Text style={s.snapshotText}>
                {snap.surface} m²
                {snap.numberOfRooms ? ` · ${snap.numberOfRooms} pièce${snap.numberOfRooms > 1 ? "s" : ""}` : ""}
              </Text>
            </View>
          ) : null}
          <View style={s.snapshotRow}>
            <Ionicons name="person-outline" size={15} color="#8B5CF6" />
            <Text style={s.snapshotText}>
              {snap.tenantFirstName} {snap.tenantLastName} — {snap.tenantEmail}
            </Text>
          </View>
          <View style={s.snapshotRow}>
            <Ionicons name="calendar-outline" size={15} color="#8B5CF6" />
            <Text style={s.snapshotText}>
              Créé le {new Date(report.createdAt).toLocaleDateString("fr-FR", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </Text>
          </View>
        </View>

        {/* Sections */}
        <Text style={s.sectionLabel}>Sections du rapport</Text>
        <View style={s.sectionsList}>
          {SECTIONS.map((sec, idx) => (
            <Pressable
              key={sec.id}
              style={({ pressed }) => [
                s.sectionItem,
                idx < SECTIONS.length - 1 && s.sectionItemBorder,
                pressed && { opacity: 0.65 },
              ]}
              onPress={() => goToSection(sec.id)}
            >
              <View style={s.sectionIconBox}>
                <Ionicons name={sec.icon as any} size={20} color="#8B5CF6" />
              </View>
              <View style={s.sectionText}>
                <Text style={s.sectionName}>{sec.label}</Text>
                <Text style={s.sectionDesc}>{sec.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Bouton repartager pour signature (bailleur, rapport finalisé, locataire pas encore signé) */}
        {report.landlordId === user?.uid &&
          (report.status === "ready_for_signature" || report.status === "partially_signed") &&
          report.signatures?.tenant?.status !== "signed" && (
          <Pressable
            style={({ pressed }) => [s.reshareBtn, pressed && { opacity: 0.75 }]}
            onPress={handleReshare}
            disabled={resending}
          >
            {resending ? (
              <ActivityIndicator size="small" color="#8B5CF6" />
            ) : (
              <>
                <Ionicons name="share-social-outline" size={18} color="#8B5CF6" />
                <Text style={s.reshareBtnText}>Repartager pour signature</Text>
                <Ionicons name="chevron-forward" size={16} color="#8B5CF6" />
              </>
            )}
          </Pressable>
        )}

        {/* Signatures si applicable */}
        {report.status !== "draft" && (
          <>
            <Text style={[s.sectionLabel, { marginTop: 16 }]}>Signatures</Text>
            <View style={s.sigCard}>
              <SigRow
                label="Bailleur"
                name={snap.landlordName}
                record={report.signatures?.landlord}
              />
              <View style={s.sigDivider} />
              <SigRow
                label="Locataire"
                name={`${snap.tenantFirstName} ${snap.tenantLastName}`}
                record={report.signatures?.tenant}
              />
            </View>
          </>
        )}

        {/* PDF */}
        {report.pdfUrl ? (
          <Pressable style={s.pdfBtn}>
            <Ionicons name="document-text" size={20} color="#8B5CF6" />
            <Text style={s.pdfBtnText}>Consulter le PDF</Text>
            <Ionicons name="open-outline" size={16} color="#8B5CF6" />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Ligne signature ──────────────────────────────────────────────────────────
function SigRow({
  label, name, record,
}: {
  label: string;
  name: string;
  record?: { status?: string; signedAt?: string } | null;
}) {
  const signed = record?.status === "signed";
  return (
    <View style={sig.row}>
      <View style={[sig.icon, signed ? sig.iconOk : sig.iconPending]}>
        <Ionicons
          name={signed ? "checkmark" : "time-outline"}
          size={15}
          color={signed ? "#10B981" : COLORS.textMuted}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={sig.role}>{label}</Text>
        <Text style={sig.name}>{name}</Text>
      </View>
      {signed && record?.signedAt ? (
        <Text style={sig.date}>{new Date(record.signedAt).toLocaleDateString("fr-FR")}</Text>
      ) : (
        <Text style={sig.pending}>En attente</Text>
      )}
    </View>
  );
}

const sig = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", gap: 12 },
  icon:       { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  iconOk:     { backgroundColor: "rgba(16,185,129,0.12)" },
  iconPending:{ backgroundColor: COLORS.surfaceAlt },
  role:    { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  name:    { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  date:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "#10B981" },
  pending: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
});

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },

  header: {
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: "#fff", borderBottomWidth: 2.5,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1 },
  headerType:   { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.6 },
  headerAddress:{ fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text, marginTop: 1 },
  headerSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },

  statusPill:  { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  statusDot:   { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 10, fontFamily: "Inter_700Bold" },

  content: { padding: 16, gap: 4 },

  snapshotCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, gap: 8, marginBottom: 20,
  },
  snapshotRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  snapshotText: {
    flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, lineHeight: 18,
  },

  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionsList: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
    marginBottom: 4,
  },
  sectionItem:       { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  sectionItemBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  sectionIconBox: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: "rgba(139,92,246,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  sectionText: { flex: 1 },
  sectionName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  sectionDesc: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },

  sigCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, gap: 12,
  },
  sigDivider: { height: 1, backgroundColor: COLORS.border },

  reshareBtn: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4,
    backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.25)",
  },
  reshareBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  pdfBtn: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16,
    backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.2)",
  },
  pdfBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  notFound:       { fontSize: 16, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  backBtnAlt:     { backgroundColor: COLORS.surfaceAlt, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  backBtnAltText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
});
