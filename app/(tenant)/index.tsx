import { useEffect, useState } from "react";
import { notifyLandlordSignalement } from "@/lib/notifications";
import {
  ActivityIndicator, Alert, Keyboard, KeyboardEvent,
  Linking, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { wConfirm } from "@/shared/dialogs";
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
  RentalProperty, InventoryReport,
  PROPERTY_TYPE_LABELS, PROPERTY_TYPE_ICONS,
  INVENTORY_TYPE_LABELS, INVENTORY_TYPE_COLORS,
  INVENTORY_STATUS_LABELS, INVENTORY_STATUS_COLORS,
} from "@/shared/types";

// ─── Types ────────────────────────────────────────────────────────────────────

const REPORT_CATEGORIES = [
  { id: "plomberie",   label: "Plomberie",         icon: "water-outline" },
  { id: "electricite", label: "Électricité",        icon: "flash-outline" },
  { id: "chauffage",   label: "Chauffage / Clim",   icon: "flame-outline" },
  { id: "serrurerie",  label: "Serrurerie",          icon: "key-outline" },
  { id: "menage",      label: "Propreté / Ménage",  icon: "brush-outline" },
  { id: "nuisible",    label: "Nuisibles",           icon: "bug-outline" },
  { id: "structure",   label: "Murs / Structure",    icon: "home-outline" },
  { id: "autre",       label: "Autre",               icon: "ellipsis-horizontal-outline" },
] as const;
type ReportCategory = typeof REPORT_CATEGORIES[number]["id"];

type MyReportStatus = "pending" | "in_progress" | "resolved";
type MyReportCategory =
  | "plomberie" | "electricite" | "chauffage" | "serrurerie"
  | "menage" | "nuisible" | "structure" | "autre";

interface MyReport {
  id: string;
  category: MyReportCategory;
  description: string;
  status: MyReportStatus;
  landlordResponse?: string;
  archivedByTenant?: boolean;
  createdAt: string;
  updatedAt: string;
}

type SigView = "home" | "list" | "archived";

// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUS_CFG: Record<MyReportStatus, { label: string; color: string; bg: string; icon: string }> = {
  pending:     { label: "Nouveau",   color: "#EF4444", bg: "rgba(239,68,68,0.14)",   icon: "time-outline" },
  in_progress: { label: "En cours",  color: "#F59E0B", bg: "rgba(245,158,11,0.14)",  icon: "construct-outline" },
  resolved:    { label: "Résolu",    color: "#10B981", bg: "rgba(16,185,129,0.14)",  icon: "checkmark-circle-outline" },
};

const CAT_ICONS: Record<MyReportCategory, string> = {
  plomberie: "water-outline", electricite: "flash-outline",
  chauffage: "flame-outline", serrurerie:  "key-outline",
  menage:    "brush-outline", nuisible:    "bug-outline",
  structure: "home-outline",  autre:       "ellipsis-horizontal-outline",
};
const CAT_LABELS: Record<MyReportCategory, string> = {
  plomberie:   "Plomberie",       electricite: "Électricité",
  chauffage:   "Chauffage / Clim", serrurerie: "Serrurerie",
  menage:      "Propreté / Ménage", nuisible:  "Nuisibles",
  structure:   "Murs / Structure", autre:      "Autre",
};

// ─── Modal nouveau signalement ────────────────────────────────────────────────

function ReportModal({
  visible, onClose, propertyId, tenantUserId, tenantName,
}: {
  visible: boolean; onClose: () => void;
  propertyId: string; tenantUserId: string; tenantName?: string;
}) {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [keyboardH, setKeyboardH] = useState(0);

  useEffect(() => {
    const s = Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => setKeyboardH(e.endCoordinates.height));
    const h = Keyboard.addListener("keyboardDidHide", () => setKeyboardH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  useEffect(() => {
    if (!visible) { setCategory(null); setDescription(""); }
  }, [visible]);

  const handleSubmit = async () => {
    if (!category) { Alert.alert("Catégorie manquante", "Choisissez une catégorie."); return; }
    if (description.trim().length < 10) {
      Alert.alert("Description trop courte", "Décrivez le problème en quelques mots."); return;
    }
    setSaving(true);
    try {
      await addDoc(collection(db, "properties", propertyId, "tenantReports"), {
        category, description: description.trim(), status: "pending",
        tenantUserId, propertyId,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      notifyLandlordSignalement({
        propertyId, category: category!, description: description.trim(),
        tenantName: tenantName ?? "Votre locataire",
      });
      Alert.alert("Signalement envoyé ✓",
        "Votre bailleur a été notifié. Nous reviendrons vers vous rapidement.",
        [{ text: "OK", onPress: onClose }]);
    } catch {
      Alert.alert("Erreur", "Impossible d'envoyer le signalement. Réessayez.");
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.55)" }]}
          onPress={onClose}
        />
        <View style={Platform.OS === "web"
            ? { position: "absolute" as const, bottom: keyboardH, left: 0, right: 0, alignItems: "center" as const }
            : { position: "absolute" as const, bottom: keyboardH, left: 0, right: 0 }
          }>
        <View style={[rm.sheet, { paddingBottom: insets.bottom + 16, maxWidth: Platform.OS === "web" ? 560 : undefined }]}>
          <View style={rm.handle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={rm.titleRow}>
            <View style={rm.titleIcon}>
              <Ionicons name="alert-circle" size={18} color="#8B5CF6" />
            </View>
            <Text style={rm.title}>Nouveau signalement</Text>
          </View>

          <Text style={rm.label}>Catégorie</Text>
          <View style={rm.grid}>
            {REPORT_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                style={[rm.catBtn, category === cat.id && rm.catBtnActive]}
                onPress={() => setCategory(cat.id)}
              >
                <Ionicons name={cat.icon as any} size={18}
                  color={category === cat.id ? "#8B5CF6" : COLORS.textMuted} />
                <Text style={[rm.catLabel, category === cat.id && rm.catLabelActive]}>
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={[rm.label, { marginTop: 14 }]}>Description</Text>
          <TextInput
            style={rm.input}
            placeholder="Localisation, symptômes, depuis quand…"
            placeholderTextColor={COLORS.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline numberOfLines={4} textAlignVertical="top"
          />

          <Pressable style={[rm.submitBtn, saving && { opacity: 0.6 }]}
            onPress={handleSubmit} disabled={saving}>
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={rm.submitText}>Envoyer le signalement</Text>
                </>}
          </Pressable>
          </ScrollView>
        </View>
        </View>
      </View>
    </Modal>
  );
}

const rm = StyleSheet.create({
  sheet: {
    width: "100%",
    backgroundColor: "#fff", borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: 24, paddingTop: 12, gap: 10,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 }, elevation: 24,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  titleIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: "rgba(139,92,246,0.1)", alignItems: "center", justifyContent: "center",
  },
  title:    { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  label:    { fontSize: 11, fontFamily: "Inter_700Bold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.7 },
  grid:     { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 6 },
  catBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: COLORS.surfaceAlt,
  },
  catBtnActive:   { borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)" },
  catLabel:       { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  catLabelActive: { color: "#8B5CF6", fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12,
    padding: 12, fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.text, minHeight: 88, textAlignVertical: "top",
    backgroundColor: COLORS.surfaceAlt,
  },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#8B5CF6", borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  submitText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});

// ─── Carte signalement ────────────────────────────────────────────────────────

function SignalementCard({ report, propertyId }: { report: MyReport; propertyId: string }) {
  const cfg        = STATUS_CFG[report.status];
  const catIcon    = CAT_ICONS[report.category]  ?? "alert-circle-outline";
  const catLabel   = CAT_LABELS[report.category] ?? "Autre";
  const [expanded, setExpanded]   = useState(false);
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
    } finally { setArchiving(false); }
  };

  return (
    <Pressable
      style={[sc.card, isArchived && sc.cardArchived]}
      onPress={() => setExpanded((v) => !v)}
    >
      <View style={sc.row}>
        <View style={[sc.iconBox, { backgroundColor: isArchived ? "rgba(255,255,255,0.06)" : cfg.bg }]}>
          <Ionicons
            name={(isArchived ? "archive-outline" : catIcon) as any}
            size={16}
            color={isArchived ? "rgba(255,255,255,0.3)" : cfg.color}
          />
        </View>
        <View style={sc.info}>
          <Text style={[sc.catLabel, isArchived && { color: "rgba(255,255,255,0.4)" }]}>{catLabel}</Text>
          <Text style={sc.desc} numberOfLines={expanded ? undefined : 1}>{report.description}</Text>
          <Text style={sc.date}>
            {new Date(report.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
          </Text>
        </View>
        {isArchived
          ? <View style={sc.archivePill}><Text style={sc.archivePillText}>Archivé</Text></View>
          : <View style={[sc.badge, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
              <Text style={[sc.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
            </View>}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color="rgba(255,255,255,0.22)" />
      </View>

      {expanded && (
        <>
          {report.landlordResponse
            ? <View style={sc.response}>
                <View style={sc.responseHeader}>
                  <Ionicons name="chatbubble-ellipses" size={12} color="#8B5CF6" />
                  <Text style={sc.responseLabel}>Réponse de votre bailleur</Text>
                </View>
                <Text style={sc.responseText}>{report.landlordResponse}</Text>
              </View>
            : report.status === "pending" && !isArchived
            ? <View style={sc.waiting}>
                <Ionicons name="hourglass-outline" size={12} color="rgba(255,255,255,0.3)" />
                <Text style={sc.waitingText}>En attente de réponse</Text>
              </View>
            : null}

          {(report.status === "resolved" || isArchived) && (
            <Pressable
              style={[sc.archiveBtn, isArchived && sc.archiveBtnActive]}
              onPress={(e) => { e.stopPropagation?.(); toggleArchive(); }}
              disabled={archiving}
            >
              {archiving
                ? <ActivityIndicator size="small" color={isArchived ? "#8B5CF6" : "rgba(255,255,255,0.4)"} />
                : <>
                    <Ionicons
                      name={isArchived ? "arrow-undo-outline" : "archive-outline"}
                      size={13}
                      color={isArchived ? "#8B5CF6" : "rgba(255,255,255,0.4)"}
                    />
                    <Text style={[sc.archiveBtnText, isArchived && { color: "#8B5CF6" }]}>
                      {isArchived ? "Restaurer" : "Archiver"}
                    </Text>
                  </>}
            </Pressable>
          )}
        </>
      )}
    </Pressable>
  );
}

const sc = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", padding: 14, gap: 10,
  },
  cardArchived: { opacity: 0.65, backgroundColor: "rgba(255,255,255,0.04)" },
  row:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  iconBox: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  info:     { flex: 1, gap: 2 },
  catLabel: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  desc:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.55)", lineHeight: 15 },
  date:     { fontSize: 10, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)", marginTop: 2 },
  badge:       { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexShrink: 0, alignSelf: "flex-start" },
  badgeText:   { fontSize: 10, fontFamily: "Inter_700Bold" },
  archivePill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: "rgba(139,92,246,0.12)", flexShrink: 0, alignSelf: "flex-start" },
  archivePillText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "rgba(139,92,246,0.8)" },
  response:        { backgroundColor: "rgba(139,92,246,0.1)", borderRadius: 8, padding: 10, gap: 4, borderLeftWidth: 2, borderLeftColor: "#8B5CF6" },
  responseHeader:  { flexDirection: "row", alignItems: "center", gap: 5 },
  responseLabel:   { fontSize: 10, fontFamily: "Inter_700Bold", color: "#8B5CF6", textTransform: "uppercase", letterSpacing: 0.5 },
  responseText:    { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)", lineHeight: 17 },
  waiting:         { flexDirection: "row", alignItems: "center", gap: 5 },
  waitingText:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)" },
  archiveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderRadius: 8, paddingVertical: 8,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)",
  },
  archiveBtnActive:  { borderColor: "rgba(139,92,246,0.35)", backgroundColor: "rgba(139,92,246,0.08)" },
  archiveBtnText:    { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.4)" },
});

// ─── Vue liste signalements ───────────────────────────────────────────────────

function SigListView({
  reports,
  propertyId,
  archived,
  onBack,
  onNew,
}: {
  reports: MyReport[];
  propertyId: string;
  archived: boolean;
  onBack: () => void;
  onNew?: () => void;
}) {
  return (
    <View style={{ flex: 1 }}>
      {/* Sub-header */}
      <View style={lv.header}>
        <Pressable style={lv.backBtn} onPress={onBack} hitSlop={12}>
          <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.8)" />
        </Pressable>
        <Text style={lv.title}>{archived ? "Signalements archivés" : "Mes signalements"}</Text>
        {!archived && onNew && (
          <Pressable style={lv.addBtn} onPress={onNew}>
            <Ionicons name="add" size={18} color="#fff" />
          </Pressable>
        )}
      </View>

      {reports.length === 0 ? (
        <View style={lv.empty}>
          <Ionicons
            name={archived ? "archive-outline" : "checkmark-circle-outline"}
            size={48} color="rgba(255,255,255,0.15)"
          />
          <Text style={lv.emptyTitle}>
            {archived ? "Aucun signalement archivé" : "Aucun signalement actif"}
          </Text>
          <Text style={lv.emptyDesc}>
            {archived
              ? "Les signalements résolus que vous archivez apparaîtront ici."
              : "Tout va bien ! Appuyez sur + pour signaler un problème."}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={lv.list} showsVerticalScrollIndicator={false}>
          {reports.map((r) => (
            <SignalementCard key={r.id} report={r} propertyId={propertyId} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const lv = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  title: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  addBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "#8B5CF6",
    alignItems: "center", justifyContent: "center",
  },
  empty: {
    flex: 1, alignItems: "center", justifyContent: "center",
    gap: 12, paddingHorizontal: 40,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.45)", textAlign: "center" },
  emptyDesc:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.28)", textAlign: "center", lineHeight: 19 },
  list: { padding: 16, gap: 10, paddingBottom: 40 },
});

// ─── Carte logement ───────────────────────────────────────────────────────────

function PropertyInfoCard({ property }: { property: RentalProperty }) {
  const typeIcon = PROPERTY_TYPE_ICONS[property.propertyType] as any;
  return (
    <View style={ic.card}>
      <View style={ic.row}>
        <View style={ic.iconBox}>
          <Ionicons name={typeIcon} size={20} color={COLORS.teal} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ic.address} numberOfLines={1}>
            {property.address}{property.apartmentNumber ? ` · Apt. ${property.apartmentNumber}` : ""}
          </Text>
          <Text style={ic.city}>{property.postalCode} {property.city}</Text>
        </View>
      </View>
      <View style={ic.tags}>
        <View style={ic.tag}>
          <Ionicons name="home-outline" size={11} color={COLORS.teal} />
          <Text style={ic.tagText}>{PROPERTY_TYPE_LABELS[property.propertyType]}</Text>
        </View>
        {property.surface ? (
          <View style={ic.tag}>
            <Ionicons name="resize-outline" size={11} color={COLORS.teal} />
            <Text style={ic.tagText}>{property.surface} m²</Text>
          </View>
        ) : null}
        {property.floor ? (
          <View style={ic.tag}>
            <Ionicons name="layers-outline" size={11} color={COLORS.teal} />
            <Text style={ic.tagText}>Étage {property.floor}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const ic = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  row:     { flexDirection: "row", alignItems: "center", gap: 12 },
  iconBox: {
    width: 42, height: 42, borderRadius: 13,
    backgroundColor: "rgba(14,186,170,0.15)", borderWidth: 1, borderColor: "rgba(14,186,170,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  address: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  city:    { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", marginTop: 2 },
  tags:    { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(14,186,170,0.1)", borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(14,186,170,0.2)",
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
    <Pressable style={({ pressed }) => [ec.card, pressed && { opacity: 0.75 }]} onPress={onPress}>
      <View style={[ec.rail, { backgroundColor: needsMySign ? "#F59E0B" : typeColor }]} />
      <View style={ec.body}>
        <View style={ec.topRow}>
          <Text style={[ec.type, { color: typeColor }]}>{INVENTORY_TYPE_LABELS[report.type]}</Text>
          <View style={[ec.statusBadge, { backgroundColor: statusColor + "20" }]}>
            <View style={[ec.dot, { backgroundColor: statusColor }]} />
            <Text style={[ec.statusText, { color: statusColor }]}>{INVENTORY_STATUS_LABELS[report.status]}</Text>
          </View>
        </View>
        <Text style={ec.date}>
          {new Date(report.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
        </Text>
        <View style={ec.sigs}>
          {[{ label: "Bailleur", signed: landlordSigned }, { label: "Vous", signed: tenantSigned }].map((p) => (
            <View key={p.label} style={[ec.pill, p.signed && ec.pillSigned]}>
              <Ionicons name={p.signed ? "checkmark-circle" : "time-outline"} size={10}
                color={p.signed ? "#10B981" : "rgba(255,255,255,0.3)"} />
              <Text style={[ec.pillText, p.signed && ec.pillTextSigned]}>{p.label}</Text>
            </View>
          ))}
        </View>
        {needsMySign && (
          <View style={ec.action}>
            <Ionicons name="pencil-outline" size={11} color="#F59E0B" />
            <Text style={ec.actionText}>Votre signature est requise</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.3)" />
    </Pressable>
  );
}

const ec = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  rail:        { width: 4, alignSelf: "stretch" },
  body:        { flex: 1, padding: 14, gap: 4 },
  topRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  type:        { fontSize: 13, fontFamily: "Inter_700Bold" },
  date:        { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  dot:         { width: 5, height: 5, borderRadius: 3 },
  statusText:  { fontSize: 10, fontFamily: "Inter_700Bold" },
  sigs:        { flexDirection: "row", gap: 6, marginTop: 4 },
  pill:        { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  pillSigned:  { backgroundColor: "rgba(16,185,129,0.12)" },
  pillText:    { fontSize: 10, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.35)" },
  pillTextSigned: { color: "#10B981" },
  action:      { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, backgroundColor: "rgba(245,158,11,0.12)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  actionText:  { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
});

// ─── Écran principal locataire ────────────────────────────────────────────────

export default function TenantHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout, deleteAccount, rentalInfo } = useAuth();

  const paddingTop = Platform.OS === "web" ? 12 : insets.top + 12;

  const [property, setProperty]       = useState<RentalProperty | null>(null);
  const [propLoading, setPropLoading] = useState(true);
  const [reports, setReports]         = useState<InventoryReport[]>([]);
  const [rptLoading, setRptLoading]   = useState(false);
  const [myReports, setMyReports]     = useState<MyReport[]>([]);
  const [showModal, setShowModal]     = useState(false);
  const [sigView, setSigView]         = useState<SigView>("home");

  useEffect(() => {
    if (!rentalInfo?.propertyId) { setPropLoading(false); return; }
    return onSnapshot(
      doc(db, "properties", rentalInfo.propertyId),
      (snap) => { setProperty(snap.exists() ? { id: snap.id, ...snap.data() } as RentalProperty : null); setPropLoading(false); },
      () => setPropLoading(false)
    );
  }, [rentalInfo?.propertyId]);

  useEffect(() => {
    if (!rentalInfo?.propertyId || !user?.uid) return;
    return onSnapshot(
      query(collection(db, "properties", rentalInfo.propertyId, "tenantReports"), where("tenantUserId", "==", user.uid)),
      (snap) => {
        setMyReports(snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as MyReport))
          .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
      },
      (err) => console.warn("[tenant] signalements error:", err)
    );
  }, [rentalInfo?.propertyId, user?.uid]);

  useEffect(() => {
    if (!rentalInfo?.propertyId) return;
    setRptLoading(true);
    getDocs(query(
      collection(db, "properties", rentalInfo.propertyId, "inventoryReports"),
      orderBy("createdAt", "desc")
    ))
      .then((snap) => setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryReport)).filter((r) => r.status !== "draft")))
      .catch(() => {})
      .finally(() => setRptLoading(false));
  }, [rentalInfo?.propertyId]);

  const handleLogout = () => wConfirm(
    "Déconnexion",
    "Voulez-vous vous déconnecter ?",
    logout,
    "Se déconnecter",
  );

  const firstName      = user?.displayName?.split(" ")[0] ?? "";
  const activeReports  = myReports.filter((r) => !r.archivedByTenant);
  const archivedReports = myReports.filter((r) => !!r.archivedByTenant);
  const pendingCount   = activeReports.filter((r) => r.status === "pending").length;
  const initials       = user?.displayName?.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() ?? "?";

  // ── Vues sous-écrans signalements ──────────────────────────────────────────

  if (sigView === "list" || sigView === "archived") {
    return (
      <LinearGradient colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]} style={{ flex: 1 }}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <View style={{ paddingTop }} />
        <SigListView
          reports={sigView === "archived" ? archivedReports : activeReports}
          propertyId={rentalInfo?.propertyId ?? ""}
          archived={sigView === "archived"}
          onBack={() => setSigView("home")}
          onNew={() => setShowModal(true)}
        />
        {rentalInfo?.propertyId && user?.uid && (
          <ReportModal
            visible={showModal}
            onClose={() => setShowModal(false)}
            propertyId={rentalInfo.propertyId}
            tenantUserId={user.uid}
            tenantName={user.displayName ?? undefined}
          />
        )}
      </LinearGradient>
    );
  }

  // ── Vue principale ─────────────────────────────────────────────────────────

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={{ flex: 1 }}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* Header */}
      <View style={[h.bar, { paddingTop, paddingHorizontal: 20 }]}>
        <View style={h.left}>
          <View style={h.dot} />
          <Text style={h.title}>Espace Locataire</Text>
        </View>
        <View style={h.right}>
          {pendingCount > 0 && (
            <View style={h.badge}>
              <Text style={h.badgeText}>{pendingCount}</Text>
            </View>
          )}
          <Pressable style={h.logoutBtn} onPress={handleLogout} hitSlop={10}>
            <Ionicons name="log-out-outline" size={19} color="rgba(255,255,255,0.6)" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[p.content, { paddingBottom: insets.bottom + 50 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Carte de bienvenue */}
        <View style={p.welcomeCard}>
          <LinearGradient
            colors={["rgba(14,186,170,0.18)", "rgba(14,186,170,0.05)"]}
            style={p.welcomeGrad}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            <View style={p.welcomeRow}>
              <View style={p.avatarBox}>
                <Text style={p.avatarText}>{initials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={p.welcomeName}>{firstName ? `Bonjour, ${firstName}` : "Bienvenue"}</Text>
                {property ? (
                  <View style={{ marginTop: 4, gap: 1 }}>
                    <Text style={p.welcomeAddr}>
                      {property.address}
                      {property.apartmentNumber ? ` · Apt. ${property.apartmentNumber}` : ""}
                    </Text>
                    {(property.postalCode || property.city) ? (
                      <Text style={p.welcomeAddrCity}>
                        {[property.postalCode, property.city].filter(Boolean).join(" ")}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <Text style={p.welcomeAddr}>Votre espace locataire</Text>
                )}
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ── Signalements ─────────────────────────────────────────────────── */}
        <View style={p.section}>
          <Text style={p.sectionLabel}>Signalements</Text>

          {/* Grille 2 colonnes + CTA pleine largeur */}
          <View style={p.sigGrid}>
            {/* Ligne 1 : Mes signalements + Archivés côte à côte */}
            <View style={p.sigRow}>
              <Pressable
                style={({ pressed }) => [p.sigTile, p.sigTilePrimary, pressed && { opacity: 0.82 }]}
                onPress={() => setSigView("list")}
              >
                <View style={[p.sigTileIcon, { backgroundColor: "rgba(245,158,11,0.22)" }]}>
                  <Ionicons name="list" size={22} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={p.sigTileTitle}>Mes signalements</Text>
                  <Text style={p.sigTileSub}>
                    {activeReports.length === 0
                      ? "Aucun en cours"
                      : `${activeReports.length} actif${activeReports.length > 1 ? "s" : ""}`}
                  </Text>
                </View>
                {pendingCount > 0 && <View style={p.pendingDot} />}
              </Pressable>

              <Pressable
                style={({ pressed }) => [p.sigTile, p.sigTileArchive, pressed && { opacity: 0.82 }]}
                onPress={() => setSigView("archived")}
              >
                <View style={[p.sigTileIcon, { backgroundColor: "rgba(99,102,241,0.18)" }]}>
                  <Ionicons name="archive" size={20} color="#818CF8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[p.sigTileTitle, { color: "rgba(255,255,255,0.75)" }]}>Archivés</Text>
                  <Text style={p.sigTileSub}>
                    {archivedReports.length === 0 ? "Aucun" : `${archivedReports.length} archivé${archivedReports.length > 1 ? "s" : ""}`}
                  </Text>
                </View>
              </Pressable>
            </View>

            {/* Ligne 2 : Nouveau signalement — bouton CTA pleine largeur */}
            <Pressable
              style={({ pressed }) => [p.sigCta, pressed && { opacity: 0.86 }]}
              onPress={() => setShowModal(true)}
            >
              <View style={[p.sigCtaIcon, { backgroundColor: "rgba(139,92,246,0.25)" }]}>
                <Ionicons name="add-circle" size={20} color="#A78BFA" />
              </View>
              <Text style={p.sigCtaText}>Nouveau signalement</Text>
              <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
            </Pressable>
          </View>
        </View>

        {/* ── Services ─────────────────────────────────────────────────────── */}
        <View style={p.section}>
          <Text style={p.sectionLabel}>Services</Text>
          <View style={p.servicesGrid}>
            {[
              { icon: "document-text-outline", label: "Mes documents", sub: "Quittances, bail, autres", color: "#3B82F6", onPress: () => router.push("/documents" as any) },
              { icon: "clipboard-outline",     label: "États des lieux", sub: `${reports.length} disponible${reports.length > 1 ? "s" : ""}`, color: "#10B981", onPress: () => {} },
              { icon: "construct-outline",     label: "Interventions", sub: "Suivi & demandes travaux", color: "#F59E0B",
                onPress: () => router.push("/interventions" as any) },
              { icon: "chatbubble-outline",    label: "Messagerie", sub: "Contacter le bailleur", color: COLORS.teal,
                onPress: () => router.push("/messages" as any) },
            ].map((srv) => (
              <Pressable
                key={srv.label}
                style={({ pressed }) => [p.serviceCard, pressed && { opacity: 0.8 }]}
                onPress={srv.onPress}
              >
                <View style={[p.serviceIconBox, { backgroundColor: srv.color + "22" }]}>
                  <Ionicons name={srv.icon as any} size={20} color={srv.color} />
                </View>
                <Text style={p.serviceLabel}>{srv.label}</Text>
                <Text style={p.serviceSub}>{srv.sub}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Mon logement ─────────────────────────────────────────────────── */}
        <View style={p.section}>
          <Text style={p.sectionLabel}>Mon logement</Text>
          {propLoading
            ? <View style={p.loadingBox}><ActivityIndicator color={COLORS.teal} size="small" /></View>
            : property
            ? <PropertyInfoCard property={property} />
            : <View style={p.emptyCard}>
                <Ionicons name="home-outline" size={22} color="rgba(255,255,255,0.2)" />
                <Text style={p.emptyText}>Logement introuvable. Contactez votre bailleur.</Text>
              </View>}
        </View>

        {/* ── États des lieux ───────────────────────────────────────────────── */}
        {reports.length > 0 && (
          <View style={p.section}>
            <Text style={p.sectionLabel}>États des lieux</Text>
            <View style={{ gap: 8 }}>
              {reports.map((r) => (
                <InventoryCard
                  key={r.id} report={r}
                  onPress={() => router.push(`/inventory/${r.id}?propertyId=${rentalInfo!.propertyId}` as any)}
                />
              ))}
            </View>
          </View>
        )}


        {/* ── Informations ──────────────────────────────────────────────────── */}
        <View style={p.section}>
          <Text style={p.sectionLabel}>Informations</Text>
          <View style={p.linksCard}>
            {[
              { label: "Politique de confidentialité", icon: "shield-checkmark-outline", url: "https://maintena-pro.fr/privacy-policy" },
              { label: "Conditions d'utilisation",     icon: "document-text-outline",    url: "https://maintena-pro.fr/privacy-policy" },
            ].map((lnk, i) => (
              <View key={lnk.label}>
                {i > 0 && <View style={p.linkDivider} />}
                <Pressable
                  style={({ pressed }) => [p.linkRow, pressed && { opacity: 0.6 }]}
                  onPress={() => Linking.openURL(lnk.url).catch(() => {})}
                >
                  <Ionicons name={lnk.icon as any} size={15} color="rgba(255,255,255,0.4)" />
                  <Text style={p.linkText}>{lnk.label}</Text>
                  <Ionicons name="chevron-forward" size={12} color="rgba(255,255,255,0.2)" />
                </Pressable>
              </View>
            ))}
          </View>

          {/* Suppression compte directe */}
          <Pressable
            style={({ pressed }) => [p.deleteAccountBtn, pressed && { opacity: 0.7 }]}
            onPress={() => wConfirm(
              "Supprimer mon compte",
              "Cette action est irréversible. Votre compte et toutes vos données seront définitivement supprimés.",
              () => wConfirm(
                "Confirmer la suppression",
                `Supprimer définitivement le compte ${user?.email} ? Impossible d'annuler.`,
                async () => {
                  try {
                    await deleteAccount();
                  } catch (e: any) {
                    if (Platform.OS === "web") {
                      window.alert(e?.message ?? "Impossible de supprimer le compte. Réessayez.");
                    } else {
                      Alert.alert("Erreur", e?.message ?? "Impossible de supprimer le compte. Réessayez.");
                    }
                  }
                },
                "Supprimer définitivement",
              ),
              "Continuer",
            )}
          >
            <Ionicons name="trash-outline" size={14} color="rgba(255,255,255,0.3)" />
            <Text style={p.deleteAccountText}>Supprimer mon compte</Text>
          </Pressable>

          <Text style={p.version}>Maintena · v1.0 · {new Date().getFullYear()}</Text>
        </View>
      </ScrollView>

      {rentalInfo?.propertyId && user?.uid && (
        <ReportModal
          visible={showModal}
          onClose={() => setShowModal(false)}
          propertyId={rentalInfo.propertyId}
          tenantUserId={user.uid}
          tenantName={user.displayName ?? undefined}
        />
      )}
    </LinearGradient>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const h = StyleSheet.create({
  bar:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 12 },
  left:  { flexDirection: "row", alignItems: "center", gap: 8 },
  right: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.teal },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: "#EF4444", paddingHorizontal: 6,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  logoutBtn: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
});

const p = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 26 },

  // Bienvenue
  welcomeCard: { borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: "rgba(14,186,170,0.2)" },
  welcomeGrad: { padding: 18 },
  welcomeRow:  { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarBox:   {
    width: 50, height: 50, borderRadius: 15,
    backgroundColor: "rgba(14,186,170,0.2)", borderWidth: 1.5, borderColor: "rgba(14,186,170,0.4)",
    alignItems: "center", justifyContent: "center",
  },
  avatarText:  { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.teal },
  welcomeName:     { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  welcomeAddr:     { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  welcomeAddrCity: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.35)" },

  // Sections
  section:      { gap: 10 },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.3)", letterSpacing: 1.2, textTransform: "uppercase" },

  // Signalements grid
  // Signalements — nouvelle grille
  sigGrid: { gap: 8 },
  sigRow:  { flexDirection: "row", gap: 8 },

  sigTile: {
    flex: 1, borderRadius: 16, padding: 14, gap: 10,
    borderWidth: 1, minHeight: 90,
  },
  sigTilePrimary: { backgroundColor: "rgba(245,158,11,0.1)", borderColor: "rgba(245,158,11,0.2)" },
  sigTileArchive: { backgroundColor: "rgba(99,102,241,0.07)", borderColor: "rgba(99,102,241,0.15)" },
  sigTileIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sigTileTitle:   { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff", marginBottom: 2 },
  sigTileSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)", lineHeight: 14 },

  sigCta: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(139,92,246,0.1)", borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: "rgba(139,92,246,0.22)",
  },
  sigCtaIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  sigCtaText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#C4B5FD" },

  pendingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },

  // Services grid
  servicesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  serviceCard:  {
    width: "47%", alignItems: "flex-start", gap: 10, padding: 16,
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  serviceIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  serviceLabel:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  serviceSub:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", lineHeight: 15 },


  // Liens
  linksCard:   { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  linkRow:     { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  linkText:    { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.65)" },
  linkDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.07)", marginLeft: 43 },
  version:     { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.2)", textAlign: "center", marginTop: 4 },
  deleteAccountBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 6 },
  deleteAccountText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.3)", textDecorationLine: "underline" },

  // États communs
  loadingBox: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 14, padding: 24, alignItems: "center" },
  emptyCard:  { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  emptyText:  { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.4)", lineHeight: 18, flex: 1 },
});
