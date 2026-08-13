import { useEffect, useRef, useState } from "react";
import { notifyLandlordSignalement } from "@/lib/notifications";
import {
  ActivityIndicator, Alert, Keyboard, KeyboardEvent,
  Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  addDoc, collection, doc, getDocs,
  onSnapshot, orderBy, query, serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  RentalProperty,
  InventoryReport,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ICONS,
  INVENTORY_TYPE_LABELS,
  INVENTORY_TYPE_COLORS,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_COLORS,
} from "@/shared/types";

// ─── Catégories signalement ───────────────────────────────────────────────────

const REPORT_CATEGORIES = [
  { id: "plomberie",     label: "Plomberie",          icon: "water-outline" },
  { id: "electricite",   label: "Électricité",         icon: "flash-outline" },
  { id: "chauffage",     label: "Chauffage / Clim",    icon: "flame-outline" },
  { id: "serrurerie",    label: "Serrurerie",           icon: "key-outline" },
  { id: "menage",        label: "Propreté / Ménage",   icon: "brush-outline" },
  { id: "nuisible",      label: "Nuisibles",            icon: "bug-outline" },
  { id: "structure",     label: "Murs / Structure",     icon: "home-outline" },
  { id: "autre",         label: "Autre",                icon: "ellipsis-horizontal-outline" },
] as const;
type ReportCategory = typeof REPORT_CATEGORIES[number]["id"];

// ─── Modal signalement ────────────────────────────────────────────────────────

function ReportModal({
  visible, onClose, propertyId, tenantUserId, tenantName,
}: {
  visible: boolean;
  onClose: () => void;
  propertyId: string;
  tenantUserId: string;
  tenantName?: string;
}) {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyboardH, setKeyboardH] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => setKeyboardH(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) { setCategory(null); setDescription(""); }
  }, [visible]);

  const handleSubmit = async () => {
    if (!category) { Alert.alert("Catégorie manquante", "Choisissez une catégorie."); return; }
    if (description.trim().length < 10) {
      Alert.alert("Description trop courte", "Décrivez le problème en quelques mots.");
      return;
    }
    setSaving(true);
    try {
      await addDoc(
        collection(db, "properties", propertyId, "tenantReports"),
        {
          category,
          description: description.trim(),
          status:      "pending",
          tenantUserId,
          propertyId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      );
      // Notification push au bailleur (best-effort)
      notifyLandlordSignalement({
        propertyId,
        category: category!,
        description: description.trim(),
        tenantName: tenantName ?? "Votre locataire",
      });
      Alert.alert(
        "Signalement envoyé ✓",
        "Votre bailleur a été notifié. Nous reviendrons vers vous rapidement.",
        [{ text: "OK", onPress: onClose }]
      );
    } catch {
      Alert.alert("Erreur", "Impossible d'envoyer le signalement. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={onClose}
        />
        <View style={[modal.sheet, { bottom: keyboardH, paddingBottom: insets.bottom + 16 }]}>
          {/* Handle */}
          <View style={modal.handle} />

          <Text style={modal.title}>Signaler un problème</Text>
          <Text style={modal.subtitle}>Catégorie</Text>
          <View style={modal.grid}>
            {REPORT_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                style={[modal.catBtn, category === cat.id && modal.catBtnActive]}
                onPress={() => setCategory(cat.id)}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={20}
                  color={category === cat.id ? "#8B5CF6" : COLORS.textMuted}
                />
                <Text style={[modal.catLabel, category === cat.id && modal.catLabelActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[modal.subtitle, { marginTop: 16 }]}>Description</Text>
          <TextInput
            style={modal.input}
            placeholder="Décrivez le problème en détail (localisation, symptômes…)"
            placeholderTextColor={COLORS.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          <Pressable
            style={[modal.submitBtn, saving && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={modal.submitText}>Envoyer le signalement</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const modal = StyleSheet.create({
  sheet: {
    position: "absolute", left: 0, right: 0,
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingTop: 12, gap: 8,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 }, elevation: 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 12,
  },
  title:    { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
  grid:     { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  catBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: COLORS.surfaceAlt,
  },
  catBtnActive: {
    borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)",
  },
  catLabel:       { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  catLabelActive: { color: "#8B5CF6", fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12,
    padding: 12, fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.text, minHeight: 90, textAlignVertical: "top",
    backgroundColor: COLORS.surfaceAlt,
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#8B5CF6", borderRadius: 14,
    paddingVertical: 14, marginTop: 8,
  },
  submitText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ─── Carte logement ───────────────────────────────────────────────────────────

function PropertyInfoCard({ property }: { property: RentalProperty }) {
  const typeIcon = PROPERTY_TYPE_ICONS[property.propertyType] as any;
  return (
    <View style={infoS.card}>
      <View style={infoS.topRow}>
        <View style={infoS.iconBadge}>
          <Ionicons name={typeIcon} size={22} color={COLORS.teal} />
        </View>
        <View style={infoS.titleGroup}>
          <Text style={infoS.address} numberOfLines={2}>
            {property.address}
            {property.apartmentNumber ? `\nApt. ${property.apartmentNumber}` : ""}
          </Text>
          <Text style={infoS.city}>{property.postalCode} {property.city}</Text>
        </View>
      </View>
      <View style={infoS.tags}>
        <View style={infoS.tag}>
          <Ionicons name="home-outline" size={12} color={COLORS.teal} />
          <Text style={infoS.tagText}>{PROPERTY_TYPE_LABELS[property.propertyType]}</Text>
        </View>
        {property.surface ? (
          <View style={infoS.tag}>
            <Ionicons name="resize-outline" size={12} color={COLORS.teal} />
            <Text style={infoS.tagText}>{property.surface} m²</Text>
          </View>
        ) : null}
        {property.floor ? (
          <View style={infoS.tag}>
            <Ionicons name="layers-outline" size={12} color={COLORS.teal} />
            <Text style={infoS.tagText}>Étage {property.floor}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const infoS = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 18, padding: 18, gap: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  topRow:    { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  iconBadge: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: "rgba(14,186,170,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(14,186,170,0.3)",
  },
  titleGroup: { flex: 1 },
  address:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff", lineHeight: 21 },
  city:       { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },
  tags:       { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(14,186,170,0.1)", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(14,186,170,0.2)",
  },
  tagText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.teal },
});

// ─── Carte état des lieux ────────────────────────────────────────────────────

function InventoryCard({ report, onPress }: { report: InventoryReport; onPress: () => void }) {
  const typeColor   = INVENTORY_TYPE_COLORS[report.type];
  const statusColor = INVENTORY_STATUS_COLORS[report.status];
  const landlordSigned = report.signatures?.landlord?.status === "signed";
  const tenantSigned   = report.signatures?.tenant?.status === "signed";
  const needsMySign = !tenantSigned && landlordSigned &&
    (report.status === "ready_for_signature" || report.status === "partially_signed");

  return (
    <Pressable
      style={({ pressed }) => [rptS.card, pressed && { opacity: 0.75 }]}
      onPress={onPress}
    >
      {needsMySign && <View style={rptS.urgentRail} />}
      {!needsMySign && <View style={[rptS.rail, { backgroundColor: typeColor }]} />}
      <View style={rptS.body}>
        <View style={rptS.topRow}>
          <Text style={[rptS.type, { color: typeColor }]}>{INVENTORY_TYPE_LABELS[report.type]}</Text>
          <View style={[rptS.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <View style={[rptS.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[rptS.statusText, { color: statusColor }]}>
              {INVENTORY_STATUS_LABELS[report.status]}
            </Text>
          </View>
        </View>
        <Text style={rptS.date}>
          {new Date(report.createdAt).toLocaleDateString("fr-FR", {
            day: "numeric", month: "long", year: "numeric",
          })}
        </Text>
        <View style={rptS.sigs}>
          <SigPill label="Bailleur" signed={landlordSigned} />
          <SigPill label="Vous"     signed={tenantSigned} />
        </View>
        {needsMySign && (
          <View style={rptS.actionBadge}>
            <Ionicons name="pencil-outline" size={12} color="#F59E0B" />
            <Text style={rptS.actionText}>Votre signature est requise</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

function SigPill({ label, signed }: { label: string; signed: boolean }) {
  return (
    <View style={[rptS.pill, signed && rptS.pillSigned]}>
      <Ionicons name={signed ? "checkmark-circle" : "time-outline"} size={11}
        color={signed ? "#10B981" : "rgba(255,255,255,0.3)"} />
      <Text style={[rptS.pillText, signed && rptS.pillTextSigned]}>{label}</Text>
    </View>
  );
}

const rptS = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  rail:       { width: 4, alignSelf: "stretch" },
  urgentRail: { width: 4, alignSelf: "stretch", backgroundColor: "#F59E0B" },
  body:       { flex: 1, padding: 14, gap: 4 },
  topRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  type:       { fontSize: 13, fontFamily: "Inter_700Bold" },
  date:       { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)" },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  statusDot:  { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  sigs:       { flexDirection: "row", gap: 6, marginTop: 4 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  pillSigned:     { backgroundColor: "rgba(16,185,129,0.12)" },
  pillText:       { fontSize: 10, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.35)" },
  pillTextSigned: { color: "#10B981" },
  actionBadge: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4,
    backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start",
  },
  actionText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
});

// ─── Écran locataire ──────────────────────────────────────────────────────────

export default function TenantHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, rentalInfo } = useAuth();

  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 12;

  const [property, setProperty]         = useState<RentalProperty | null>(null);
  const [propLoading, setPropLoading]   = useState(true);
  const [reports, setReports]           = useState<InventoryReport[]>([]);
  const [rptLoading, setRptLoading]     = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Écoute du logement
  useEffect(() => {
    if (!rentalInfo?.propertyId) { setPropLoading(false); return; }
    return onSnapshot(
      doc(db, "properties", rentalInfo.propertyId),
      (snap) => {
        setProperty(snap.exists() ? { id: snap.id, ...snap.data() } as RentalProperty : null);
        setPropLoading(false);
      },
      () => setPropLoading(false)
    );
  }, [rentalInfo?.propertyId]);

  // Charge les états des lieux
  useEffect(() => {
    if (!rentalInfo?.propertyId) return;
    setRptLoading(true);
    getDocs(
      query(
        collection(db, "properties", rentalInfo.propertyId, "inventoryReports"),
        orderBy("createdAt", "desc")
      )
    )
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as InventoryReport))
          .filter((r) => r.status !== "draft");
        setReports(list);
      })
      .catch(() => {})
      .finally(() => setRptLoading(false));
  }, [rentalInfo?.propertyId]);

  const firstName = user?.displayName?.split(" ")[0] ?? "";

  const handleLogout = () => {
    Alert.alert("Déconnexion", "Voulez-vous vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Se déconnecter", style: "destructive", onPress: logout },
    ]);
  };

  const goToReport = (report: InventoryReport) => {
    router.push(`/inventory/${report.id}?propertyId=${rentalInfo!.propertyId}` as any);
  };

  // Actions rapides
  const quickActions = [
    {
      icon:    "alert-circle-outline",
      label:   "Signaler un problème",
      color:   "#F59E0B",
      onPress: () => setShowReportModal(true),
    },
    {
      icon:    "document-text-outline",
      label:   "Mes documents",
      color:   "#3B82F6",
      onPress: () =>
        Alert.alert(
          "Documents",
          "Vos documents (bail, quittances, etc.) seront disponibles ici prochainement.\n\nContactez votre bailleur directement pour les obtenir.",
          [{ text: "OK" }]
        ),
    },
    {
      icon:    "construct-outline",
      label:   "Interventions",
      color:   "#10B981",
      onPress: () =>
        Alert.alert(
          "Interventions",
          "Le suivi des interventions sur votre logement sera disponible prochainement.",
          [{ text: "OK" }]
        ),
    },
  ];

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={s.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* Header */}
      <View style={[s.topBar, { paddingTop, paddingHorizontal: 20 }]}>
        <Text style={s.topBarTitle}>Espace Locataire</Text>
        <Pressable onPress={handleLogout} style={s.logoutBtn} hitSlop={10}>
          <Ionicons name="log-out-outline" size={22} color="rgba(255,255,255,0.5)" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Salutation */}
        <View style={s.greet}>
          <View style={s.iconBadge}>
            <Ionicons name="key" size={32} color={COLORS.teal} />
          </View>
          <Text style={s.title}>
            {firstName ? `Bonjour, ${firstName} !` : "Bienvenue !"}
          </Text>
        </View>

        {/* Actions rapides */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Actions rapides</Text>
          <View style={s.actionsRow}>
            {quickActions.map((a) => (
              <Pressable
                key={a.label}
                style={({ pressed }) => [s.actionCard, pressed && { opacity: 0.75 }]}
                onPress={a.onPress}
              >
                <View style={[s.actionIconBox, { backgroundColor: a.color + "20" }]}>
                  <Ionicons name={a.icon as any} size={22} color={a.color} />
                </View>
                <Text style={s.actionLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Logement */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Mon logement</Text>
          {propLoading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={COLORS.teal} size="small" />
            </View>
          ) : property ? (
            <PropertyInfoCard property={property} />
          ) : (
            <View style={s.missingCard}>
              <Ionicons name="home-outline" size={24} color="rgba(255,255,255,0.3)" />
              <Text style={s.missingText}>
                Logement introuvable.{"\n"}Contactez votre bailleur.
              </Text>
            </View>
          )}
        </View>

        {/* États des lieux */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>États des lieux</Text>
          {rptLoading ? (
            <View style={s.loadingBox}>
              <ActivityIndicator color={COLORS.teal} size="small" />
            </View>
          ) : reports.length === 0 ? (
            <View style={s.missingCard}>
              <Ionicons name="clipboard-outline" size={22} color="rgba(255,255,255,0.3)" />
              <Text style={s.missingText}>Aucun état des lieux disponible.</Text>
            </View>
          ) : (
            <View style={s.reportsList}>
              {reports.map((r) => (
                <InventoryCard key={r.id} report={r} onPress={() => goToReport(r)} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Modal signalement */}
      {rentalInfo?.propertyId && user?.uid && (
        <ReportModal
          visible={showReportModal}
          onClose={() => setShowReportModal(false)}
          propertyId={rentalInfo.propertyId}
          tenantUserId={user.uid}
          tenantName={user.displayName ?? undefined}
        />
      )}
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingBottom: 12,
  },
  topBarTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },

  content: { paddingHorizontal: 20, paddingTop: 8, gap: 28 },

  greet:     { alignItems: "center", gap: 10, paddingVertical: 4 },
  iconBadge: {
    width: 68, height: 68, borderRadius: 20,
    backgroundColor: "rgba(14,186,170,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(14,186,170,0.3)",
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },

  section:      { gap: 10 },
  sectionTitle: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase",
  },

  actionsRow: { flexDirection: "row", gap: 10 },
  actionCard: {
    flex: 1, alignItems: "center", gap: 8, padding: 14,
    backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  actionIconBox: {
    width: 46, height: 46, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  actionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.7)", textAlign: "center", lineHeight: 15,
  },

  loadingBox: {
    backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, padding: 24,
    alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  missingCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  missingText: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.4)", lineHeight: 18, flex: 1,
  },

  reportsList: { gap: 10 },
});
