import { useEffect, useRef, useState } from "react";
import { notifyLandlordSignalement } from "@/lib/notifications";
import {
  ActivityIndicator, Alert, Keyboard, KeyboardEvent,
  Linking, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import {
  addDoc, collection, doc, getDocs,
  onSnapshot, orderBy, query, updateDoc, where,
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
  catBtnActive:   { borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)" },
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

// ─── Types signalements locataire ────────────────────────────────────────────

type MyReportStatus = "pending" | "in_progress" | "resolved";
type MyReportCategory =
  | "plomberie" | "electricite" | "chauffage" | "serrurerie"
  | "menage" | "nuisible" | "structure" | "autre";

interface MyReport {
  id:               string;
  category:         MyReportCategory;
  description:      string;
  status:           MyReportStatus;
  landlordResponse?: string;
  archivedByTenant?: boolean; // Archivé par le locataire (indépendant du bailleur)
  createdAt:        string;
  updatedAt:        string;
}

const MY_STATUS_CFG: Record<MyReportStatus, { label: string; color: string; bg: string; icon: string }> = {
  pending:     { label: "Nouveau",   color: "#EF4444", bg: "rgba(239,68,68,0.14)",   icon: "time-outline" },
  in_progress: { label: "En cours", color: "#F59E0B", bg: "rgba(245,158,11,0.14)",  icon: "construct-outline" },
  resolved:    { label: "Résolu",   color: "#10B981", bg: "rgba(16,185,129,0.14)",  icon: "checkmark-circle-outline" },
};

const MY_CAT_ICONS: Record<MyReportCategory, string> = {
  plomberie:   "water-outline",
  electricite: "flash-outline",
  chauffage:   "flame-outline",
  serrurerie:  "key-outline",
  menage:      "brush-outline",
  nuisible:    "bug-outline",
  structure:   "home-outline",
  autre:       "ellipsis-horizontal-outline",
};

const MY_CAT_LABELS: Record<MyReportCategory, string> = {
  plomberie:   "Plomberie",
  electricite: "Électricité",
  chauffage:   "Chauffage / Clim",
  serrurerie:  "Serrurerie",
  menage:      "Propreté / Ménage",
  nuisible:    "Nuisibles",
  structure:   "Murs / Structure",
  autre:       "Autre",
};

// ─── Carte signalement ────────────────────────────────────────────────────────

function SignalementCard({
  report,
  propertyId,
}: {
  report: MyReport;
  propertyId: string;
}) {
  const cfg = MY_STATUS_CFG[report.status];
  const catIcon  = MY_CAT_ICONS[report.category]  ?? "alert-circle-outline";
  const catLabel = MY_CAT_LABELS[report.category] ?? "Autre";
  const [expanded,  setExpanded]  = useState(false);
  const [archiving, setArchiving] = useState(false);
  const isArchived = !!report.archivedByTenant;

  const toggleArchive = async () => {
    setArchiving(true);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "tenantReports", report.id),
        { archivedByTenant: !isArchived, updatedAt: new Date().toISOString() }
      );
    } catch {
      Alert.alert("Erreur", "Impossible de modifier ce signalement.");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <Pressable
      style={[sigS.card, isArchived && sigS.cardArchived]}
      onPress={() => setExpanded((v) => !v)}
    >
      {/* Ligne principale */}
      <View style={sigS.row}>
        <View style={[sigS.iconBox, { backgroundColor: isArchived ? "rgba(255,255,255,0.06)" : cfg.bg }]}>
          <Ionicons
            name={(isArchived ? "archive-outline" : catIcon) as any}
            size={16}
            color={isArchived ? "rgba(255,255,255,0.3)" : cfg.color}
          />
        </View>
        <View style={sigS.info}>
          <Text style={[sigS.catLabel, isArchived && { color: "rgba(255,255,255,0.4)" }]}>
            {catLabel}
          </Text>
          <Text style={sigS.desc} numberOfLines={expanded ? undefined : 1}>
            {report.description}
          </Text>
          <Text style={sigS.date}>
            {new Date(report.createdAt).toLocaleDateString("fr-FR", {
              day: "numeric", month: "long", year: "numeric",
            })}
          </Text>
        </View>
        {isArchived ? (
          <View style={sigS.archiveBadge}>
            <Text style={sigS.archiveBadgeText}>Archivé</Text>
          </View>
        ) : (
          <View style={[sigS.badge, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
            <Text style={[sigS.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        )}
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={13}
          color="rgba(255,255,255,0.25)"
        />
      </View>

      {/* Contenu étendu */}
      {expanded && (
        <>
          {/* Réponse bailleur */}
          {report.landlordResponse ? (
            <View style={sigS.response}>
              <View style={sigS.responseHeader}>
                <Ionicons name="chatbubble-ellipses" size={12} color="#8B5CF6" />
                <Text style={sigS.responseLabel}>Réponse de votre bailleur</Text>
              </View>
              <Text style={sigS.responseText}>{report.landlordResponse}</Text>
            </View>
          ) : report.status === "pending" && !isArchived ? (
            <View style={sigS.waiting}>
              <Ionicons name="hourglass-outline" size={12} color="rgba(255,255,255,0.3)" />
              <Text style={sigS.waitingText}>En attente de traitement</Text>
            </View>
          ) : null}

          {/* Bouton archiver / restaurer */}
          {(report.status === "resolved" || isArchived) && (
            <Pressable
              style={[sigS.archiveBtn, isArchived && sigS.archiveBtnActive]}
              onPress={(e) => { e.stopPropagation?.(); toggleArchive(); }}
              disabled={archiving}
            >
              {archiving ? (
                <ActivityIndicator size="small" color={isArchived ? "#8B5CF6" : "rgba(255,255,255,0.4)"} />
              ) : (
                <>
                  <Ionicons
                    name={isArchived ? "arrow-undo-outline" : "archive-outline"}
                    size={13}
                    color={isArchived ? "#8B5CF6" : "rgba(255,255,255,0.4)"}
                  />
                  <Text style={[sigS.archiveBtnText, isArchived && { color: "#8B5CF6" }]}>
                    {isArchived ? "Restaurer" : "Archiver ce signalement"}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </>
      )}
    </Pressable>
  );
}

const sigS = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    padding: 14, gap: 10,
  },
  cardArchived: { opacity: 0.65, backgroundColor: "rgba(255,255,255,0.04)" },
  row:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconBox: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  info:     { flex: 1, gap: 2 },
  catLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  desc:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)", lineHeight: 15 },
  date:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)", marginTop: 2 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4,
    flexShrink: 0, alignSelf: "flex-start",
  },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  archiveBadge: {
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4,
    backgroundColor: "rgba(139,92,246,0.12)", flexShrink: 0, alignSelf: "flex-start",
  },
  archiveBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "rgba(139,92,246,0.8)" },

  response: {
    backgroundColor: "rgba(139,92,246,0.1)",
    borderRadius: 8, padding: 10, gap: 4,
    borderLeftWidth: 2, borderLeftColor: "#8B5CF6",
  },
  responseHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  responseLabel:  { fontSize: 10, fontFamily: "Inter_700Bold", color: "#8B5CF6", textTransform: "uppercase", letterSpacing: 0.5 },
  responseText:   { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", lineHeight: 17 },

  waiting: { flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 2 },
  waitingText: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)" },

  archiveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 8, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  archiveBtnActive: {
    borderColor: "rgba(139,92,246,0.35)",
    backgroundColor: "rgba(139,92,246,0.08)",
  },
  archiveBtnText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.4)" },
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

// ─── Carte état des lieux ─────────────────────────────────────────────────────

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
      {needsMySign
        ? <View style={rptS.urgentRail} />
        : <View style={[rptS.rail, { backgroundColor: typeColor }]} />}
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
  rail:        { width: 4, alignSelf: "stretch" },
  urgentRail:  { width: 4, alignSelf: "stretch", backgroundColor: "#F59E0B" },
  body:        { flex: 1, padding: 14, gap: 4 },
  topRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  type:        { fontSize: 13, fontFamily: "Inter_700Bold" },
  date:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)" },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  statusDot:      { width: 5, height: 5, borderRadius: 3 },
  statusText:     { fontSize: 10, fontFamily: "Inter_700Bold" },
  sigs:           { flexDirection: "row", gap: 6, marginTop: 4 },
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

// ─── Section Mon compte ───────────────────────────────────────────────────────

function AccountSection({
  displayName,
  email,
}: {
  displayName?: string | null;
  email?: string | null;
}) {
  const initials = displayName
    ? displayName.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  return (
    <View style={acc.container}>
      <Text style={acc.sectionLabel}>Mon compte</Text>
      <View style={acc.card}>
        <View style={acc.profileRow}>
          <View style={acc.avatar}>
            <Text style={acc.avatarText}>{initials}</Text>
          </View>
          <View style={acc.profileInfo}>
            <Text style={acc.name} numberOfLines={1}>{displayName ?? "Locataire"}</Text>
            {email ? <Text style={acc.email} numberOfLines={1}>{email}</Text> : null}
            <View style={acc.rolePill}>
              <Ionicons name="person-outline" size={10} color={COLORS.teal} />
              <Text style={acc.roleText}>Espace locataire</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const acc = StyleSheet.create({
  container: { gap: 10 },
  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase",
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 18, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  profileRow: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 18,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: "rgba(14,186,170,0.2)",
    borderWidth: 1.5, borderColor: "rgba(14,186,170,0.4)",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.teal },
  profileInfo: { flex: 1, gap: 3 },
  name:  { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  email: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)" },
  rolePill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(14,186,170,0.1)", borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start", marginTop: 4,
    borderWidth: 1, borderColor: "rgba(14,186,170,0.2)",
  },
  roleText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.teal },
});

// ─── Section Informations légales ─────────────────────────────────────────────

function InfoSection() {
  const openUrl = (url: string) => Linking.openURL(url).catch(() => {});

  const links = [
    { label: "Politique de confidentialité", icon: "shield-checkmark-outline", url: "https://maintena-pro.fr/privacy-policy" },
    { label: "Conditions d'utilisation",      icon: "document-text-outline",    url: "https://maintena-pro.fr/privacy-policy" },
    { label: "Supprimer mon compte",          icon: "trash-outline",            url: "https://maintena-pro.fr/account-deletion" },
  ];

  return (
    <View style={inf.container}>
      <Text style={inf.sectionLabel}>Informations</Text>

      {/* Description app */}
      <View style={inf.appCard}>
        <View style={inf.appLogoRow}>
          <View style={inf.appIcon}>
            <Ionicons name="home" size={20} color={COLORS.teal} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={inf.appName}>Maintena</Text>
            <Text style={inf.appTagline}>Copropriétés · Gestion locative</Text>
          </View>
        </View>
        <Text style={inf.appDesc}>
          Maintena simplifie la relation entre locataires et bailleurs : suivi du logement,
          états des lieux numérisés, signalements, quittances et documents — tout en un.
        </Text>
      </View>

      {/* Liens légaux */}
      <View style={inf.linksCard}>
        {links.map((link, i) => (
          <View key={link.label}>
            {i > 0 && <View style={inf.linkDivider} />}
            <Pressable
              style={({ pressed }) => [inf.linkRow, pressed && { opacity: 0.6 }]}
              onPress={() => openUrl(link.url)}
            >
              <Ionicons name={link.icon as any} size={16} color="rgba(255,255,255,0.45)" />
              <Text style={inf.linkText}>{link.label}</Text>
              <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.2)" />
            </Pressable>
          </View>
        ))}
      </View>

      {/* Version */}
      <Text style={inf.version}>Maintena · v1.0 · {new Date().getFullYear()}</Text>
    </View>
  );
}

const inf = StyleSheet.create({
  container:    { gap: 12 },
  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase",
  },
  appCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  appLogoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  appIcon: {
    width: 44, height: 44, borderRadius: 13,
    backgroundColor: "rgba(14,186,170,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(14,186,170,0.25)",
  },
  appName:    { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  appTagline: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 2 },
  appDesc: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", lineHeight: 18,
  },
  linksCard: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  linkRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  linkText:    { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  linkDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginLeft: 44 },
  version: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 4,
  },
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
  const [myReports, setMyReports]       = useState<MyReport[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [sigFilter, setSigFilter] = useState<"active" | "archived">("active");

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

  // Écoute en temps réel des signalements du locataire
  useEffect(() => {
    if (!rentalInfo?.propertyId || !user?.uid) return;
    const q = query(
      collection(db, "properties", rentalInfo.propertyId, "tenantReports"),
      where("tenantUserId", "==", user.uid)
    );
    return onSnapshot(q, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as MyReport))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      setMyReports(list);
    }, (err) => {
      console.warn("[tenant] signalements onSnapshot error:", err);
    });
  }, [rentalInfo?.propertyId, user?.uid]);

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

  const activeReports   = myReports.filter((r) => !r.archivedByTenant);
  const archivedReports = myReports.filter((r) => !!r.archivedByTenant);
  const pendingCount    = activeReports.filter((r) => r.status === "pending").length;

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
      onPress: () => router.push("/documents" as any),
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
        <View style={s.topBarLeft}>
          <View style={s.topBarDot} />
          <Text style={s.topBarTitle}>Espace Locataire</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {pendingCount > 0 && (
            <View style={s.alertPill}>
              <Ionicons name="alert-circle" size={12} color="#F87171" />
              <Text style={s.alertPillText}>{pendingCount}</Text>
            </View>
          )}
          <Pressable style={s.logoutBtn} onPress={handleLogout} hitSlop={10}>
            <Ionicons name="log-out-outline" size={20} color="rgba(255,255,255,0.5)" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 60 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Salutation */}
        <View style={s.greetCard}>
          <LinearGradient
            colors={["rgba(14,186,170,0.15)", "rgba(14,186,170,0.04)"]}
            style={s.greetGrad}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <View style={s.greetRow}>
              <View style={s.greetIconBox}>
                <Ionicons name="key" size={26} color={COLORS.teal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.greetName}>
                  {firstName ? `Bonjour, ${firstName}` : "Bienvenue"}
                </Text>
                {property ? (
                  <Text style={s.greetAddress} numberOfLines={1}>
                    {property.address}{property.city ? `, ${property.city}` : ""}
                  </Text>
                ) : (
                  <Text style={s.greetAddress}>Votre logement</Text>
                )}
              </View>
            </View>
          </LinearGradient>
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
              <Text style={s.missingText}>Logement introuvable.{"\n"}Contactez votre bailleur.</Text>
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

        {/* Signalements */}
        <View style={s.section}>
          {/* En-tête section */}
          <View style={s.sectionHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={s.sectionTitle}>Signalements</Text>
              {activeReports.length > 0 && (
                <View style={s.countBadge}>
                  <Text style={s.countBadgeText}>{activeReports.length}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Bouton Nouveau signalement */}
          <Pressable
            style={({ pressed }) => [s.newSigBtn, pressed && { opacity: 0.8 }]}
            onPress={() => setShowReportModal(true)}
          >
            <View style={s.newSigIconBox}>
              <Ionicons name="add" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.newSigLabel}>Nouveau signalement</Text>
              <Text style={s.newSigSub}>Signalez un problème à votre bailleur</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
          </Pressable>

          {/* Onglets Actifs / Archivés */}
          <View style={s.sigTabs}>
            <Pressable
              style={[s.sigTab, sigFilter === "active" && s.sigTabActive]}
              onPress={() => setSigFilter("active")}
            >
              <Text style={[s.sigTabText, sigFilter === "active" && s.sigTabTextActive]}>
                Actifs{activeReports.length > 0 ? ` (${activeReports.length})` : ""}
              </Text>
            </Pressable>
            <Pressable
              style={[s.sigTab, sigFilter === "archived" && s.sigTabArchiveActive]}
              onPress={() => setSigFilter("archived")}
            >
              <Ionicons
                name="archive-outline"
                size={12}
                color={sigFilter === "archived" ? "#8B5CF6" : "rgba(255,255,255,0.35)"}
              />
              <Text style={[s.sigTabText, sigFilter === "archived" && s.sigTabTextArchiveActive]}>
                Archivés{archivedReports.length > 0 ? ` (${archivedReports.length})` : ""}
              </Text>
            </Pressable>
          </View>

          {/* Liste */}
          {sigFilter === "active" ? (
            activeReports.length === 0 ? (
              <View style={s.sigEmpty}>
                <Ionicons name="checkmark-circle-outline" size={32} color="rgba(255,255,255,0.2)" />
                <Text style={s.sigEmptyTitle}>Aucun signalement actif</Text>
                <Text style={s.sigEmptyDesc}>Tout va bien — appuyez sur "Nouveau" si vous avez un problème.</Text>
              </View>
            ) : (
              <View style={s.reportsList}>
                {activeReports.map((r) => (
                  <SignalementCard key={r.id} report={r} propertyId={rentalInfo?.propertyId ?? ""} />
                ))}
              </View>
            )
          ) : (
            archivedReports.length === 0 ? (
              <View style={s.sigEmpty}>
                <Ionicons name="archive-outline" size={32} color="rgba(255,255,255,0.2)" />
                <Text style={s.sigEmptyTitle}>Aucun signalement archivé</Text>
                <Text style={s.sigEmptyDesc}>Les signalements résolus que vous archivez apparaîtront ici.</Text>
              </View>
            ) : (
              <View style={s.reportsList}>
                {archivedReports.map((r) => (
                  <SignalementCard key={r.id} report={r} propertyId={rentalInfo?.propertyId ?? ""} />
                ))}
              </View>
            )
          )}
        </View>

        {/* Mon compte */}
        <AccountSection
          displayName={user?.displayName}
          email={user?.email}
        />

        {/* Informations légales */}
        <InfoSection />
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

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingBottom: 12,
  },
  topBarLeft:  { flexDirection: "row", alignItems: "center", gap: 8 },
  topBarDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.teal,
  },
  topBarTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  alertPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(239,68,68,0.2)", borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.35)",
  },
  alertPillText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#F87171" },
  logoutBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },

  content: { paddingHorizontal: 20, paddingTop: 8, gap: 28 },

  // Carte de salutation
  greetCard: {
    borderRadius: 20, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(14,186,170,0.2)",
  },
  greetGrad: { padding: 18 },
  greetRow:  { flexDirection: "row", alignItems: "center", gap: 14 },
  greetIconBox: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: "rgba(14,186,170,0.2)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(14,186,170,0.35)",
  },
  greetName:    { fontSize: 19, fontFamily: "Inter_700Bold", color: "#fff" },
  greetAddress: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 3 },

  // Sections
  section:      { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase",
  },
  sectionAction: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(14,186,170,0.12)", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(14,186,170,0.2)",
  },
  sectionActionText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.teal },
  countBadge: {
    backgroundColor: "rgba(239,68,68,0.2)", borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.35)",
  },
  countBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#F87171" },

  // Actions rapides
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

  // Bouton nouveau signalement
  newSigBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "rgba(139,92,246,0.15)",
    borderRadius: 16, padding: 14,
    borderWidth: 1.5, borderColor: "rgba(139,92,246,0.35)",
  },
  newSigIconBox: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "#8B5CF6",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  newSigLabel: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  newSigSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", marginTop: 2 },

  // Onglets signalements
  sigTabs: {
    flexDirection: "row", gap: 8,
  },
  sigTab: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  sigTabActive:        { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.25)" },
  sigTabArchiveActive: { backgroundColor: "rgba(139,92,246,0.12)", borderColor: "rgba(139,92,246,0.35)" },
  sigTabText:              { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.45)" },
  sigTabTextActive:        { color: "#fff", fontFamily: "Inter_600SemiBold" },
  sigTabTextArchiveActive: { color: "#8B5CF6", fontFamily: "Inter_600SemiBold" },

  // État vide signalements
  sigEmpty: {
    alignItems: "center", gap: 8, paddingVertical: 28,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
  },
  sigEmptyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.5)" },
  sigEmptyDesc:  {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.3)", textAlign: "center", lineHeight: 17,
    paddingHorizontal: 24,
  },

  // États communs
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
