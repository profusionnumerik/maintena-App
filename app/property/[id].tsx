import { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { auth, db, storage } from "@/lib/firebase";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Linking } from "react-native";
import { notifyTenantReportUpdated } from "@/lib/notifications";
import {
  RentalProperty,
  PropertyTenant,
  PropertyDocument,
  PropertyDocumentType,
  PropertyStatus,
  PropertyIntervention,
  RentalInterventionStatus,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ICONS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUS_COLORS,
  PROPERTY_DOCUMENT_TYPE_LABELS,
  PROPERTY_DOCUMENT_TYPE_ICONS,
  TENANT_STATUS_LABELS,
  TENANT_STATUS_COLORS,
  RENTAL_INTERVENTION_STATUS_LABELS,
  RENTAL_INTERVENTION_STATUS_COLORS,
} from "@/shared/types";

// ─── Hub tabs ─────────────────────────────────────────────────────────────────

type HubTab = "overview" | "reports" | "messages" | "interventions" | "documents";

const HUB_TABS: { key: HubTab; label: string; icon: string }[] = [
  { key: "overview",      label: "Aperçu",         icon: "home-outline" },
  { key: "reports",       label: "Signalements",   icon: "warning-outline" },
  { key: "messages",      label: "Messages",        icon: "chatbubbles-outline" },
  { key: "interventions", label: "Interventions",   icon: "construct-outline" },
  { key: "documents",     label: "Documents",       icon: "folder-outline" },
];

// ─── Signalements types ───────────────────────────────────────────────────────

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
  landlordNote?:     string;
  landlordResponse?: string;
  archivedByLandlord?: boolean;
  createdAt: string;
  updatedAt: string;
}

const REPORT_CATEGORIES: Record<ReportCategory, { label: string; icon: string }> = {
  plomberie:   { label: "Plomberie",        icon: "water" },
  electricite: { label: "Électricité",       icon: "flash" },
  chauffage:   { label: "Chauffage / Clim",  icon: "flame" },
  serrurerie:  { label: "Serrurerie",         icon: "key" },
  menage:      { label: "Propreté / Ménage", icon: "brush" },
  nuisible:    { label: "Nuisibles",          icon: "bug" },
  structure:   { label: "Murs / Structure",   icon: "home" },
  autre:       { label: "Autre",              icon: "ellipsis-horizontal-circle" },
};

const REPORT_STATUS: Record<ReportStatus, { label: string; color: string; bg: string }> = {
  pending:     { label: "Nouveau",   color: "#EF4444", bg: "#FEF2F2" },
  in_progress: { label: "En cours", color: "#F59E0B", bg: "#FFFBEB" },
  resolved:    { label: "Résolu",   color: "#10B981", bg: "#F0FDF4" },
};

const REPORT_NEXT: Record<ReportStatus, ReportStatus | null> = {
  pending: "in_progress",
  in_progress: "resolved",
  resolved: null,
};

// ─── Interventions constantes ─────────────────────────────────────────────────

const INT_CAT_ICONS: Record<string, string> = {
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

// ─── Petit badge statut logement ─────────────────────────────────────────────

function StatusBadge({ status }: { status: PropertyStatus }) {
  const color = PROPERTY_STATUS_COLORS[status];
  return (
    <View style={[badgeS.wrap, { backgroundColor: `${color}18` }]}>
      <View style={[badgeS.dot, { backgroundColor: color }]} />
      <Text style={[badgeS.label, { color }]}>{PROPERTY_STATUS_LABELS[status]}</Text>
    </View>
  );
}
const badgeS = StyleSheet.create({
  wrap:  { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  dot:   { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ─── Carte locataire ──────────────────────────────────────────────────────────

function TenantRow({ tenant }: { tenant: PropertyTenant }) {
  const sc = TENANT_STATUS_COLORS[tenant.status];
  return (
    <View style={tenantS.row}>
      <View style={tenantS.avatar}>
        <Text style={tenantS.avatarText}>
          {(tenant.firstName[0] ?? "") + (tenant.lastName[0] ?? "")}
        </Text>
      </View>
      <View style={tenantS.info}>
        <Text style={tenantS.name}>{tenant.firstName} {tenant.lastName}</Text>
        <Text style={tenantS.email} numberOfLines={1}>{tenant.email}</Text>
        {tenant.leaseStartDate && (
          <Text style={tenantS.dates}>
            Depuis le {new Date(tenant.leaseStartDate).toLocaleDateString("fr-FR")}
            {tenant.leaseEndDate ? ` → ${new Date(tenant.leaseEndDate).toLocaleDateString("fr-FR")}` : ""}
          </Text>
        )}
      </View>
      <View style={[tenantS.badge, { backgroundColor: `${sc}18` }]}>
        <Text style={[tenantS.badgeText, { color: sc }]}>
          {TENANT_STATUS_LABELS[tenant.status]}
        </Text>
      </View>
    </View>
  );
}
const tenantS = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  avatar:     { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(139,92,246,0.12)", alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#8B5CF6" },
  info:       { flex: 1, gap: 2 },
  name:       { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  email:      { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  dates:      { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  badge:      { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText:  { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

// ─── Modal détail signalement ─────────────────────────────────────────────────

function ReportDetailModal({ report, onClose, onUpdated }: {
  report: TenantReport; onClose: () => void; onUpdated: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [note, setNote]           = useState(report.landlordNote ?? "");
  const [response, setResponse]   = useState(report.landlordResponse ?? "");
  const [saving, setSaving]       = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [keyboardH, setKeyboardH] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => setKeyboardH(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const cfg = REPORT_STATUS[report.status];
  const cat = REPORT_CATEGORIES[report.category] ?? REPORT_CATEGORIES.autre;
  const nextStatus = REPORT_NEXT[report.status];
  const isArchived = !!report.archivedByLandlord;

  const save = async (newStatus?: ReportStatus) => {
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        landlordNote: note.trim(), landlordResponse: response.trim(),
        updatedAt: new Date().toISOString(),
      };
      if (newStatus) updates.status = newStatus;
      await updateDoc(doc(db, "properties", report.propertyId, "tenantReports", report.id), updates);
      if (newStatus && report.tenantUserId && (newStatus === "in_progress" || newStatus === "resolved")) {
        notifyTenantReportUpdated({ tenantUserId: report.tenantUserId, status: newStatus, propertyId: report.propertyId });
      }
      onUpdated();
      if (newStatus) onClose();
    } catch { Alert.alert("Erreur", "Impossible de sauvegarder."); }
    finally { setSaving(false); }
  };

  const toggleArchive = async () => {
    setArchiving(true);
    try {
      await updateDoc(doc(db, "properties", report.propertyId, "tenantReports", report.id),
        { archivedByLandlord: !isArchived, updatedAt: new Date().toISOString() });
      onUpdated(); onClose();
    } catch { Alert.alert("Erreur", "Impossible d'archiver."); }
    finally { setArchiving(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]} onPress={onClose} />
        <View style={[rdm.sheet, { bottom: keyboardH, paddingBottom: insets.bottom + 20 }]}>
          <View style={rdm.handle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={rdm.header}>
              <View style={[rdm.catIcon, { backgroundColor: isArchived ? "#F1F5F9" : cfg.bg }]}>
                <Ionicons name={isArchived ? "archive-outline" : (cat.icon as any)} size={20} color={isArchived ? "#6366F1" : cfg.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={rdm.catLabel}>{cat.label}</Text>
              </View>
              <View style={[rdm.badge, { backgroundColor: isArchived ? "#EEF2FF" : cfg.bg }]}>
                <Text style={[rdm.badgeText, { color: isArchived ? "#6366F1" : cfg.color }]}>
                  {isArchived ? "Archivé" : cfg.label}
                </Text>
              </View>
            </View>

            <Text style={rdm.desc}>{report.description}</Text>
            <Text style={rdm.date}>
              Signalé le {new Date(report.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}
            </Text>

            <View style={rdm.fieldGroup}>
              <View style={rdm.fieldLabelRow}>
                <Ionicons name="chatbubble-outline" size={13} color="#8B5CF6" />
                <Text style={rdm.fieldLabel}>Réponse au locataire</Text>
              </View>
              <TextInput
                style={rdm.noteInput}
                placeholder="Saisissez une réponse visible par le locataire…"
                placeholderTextColor={COLORS.textMuted}
                value={response} onChangeText={setResponse} multiline numberOfLines={3}
              />
            </View>

            <View style={rdm.fieldGroup}>
              <View style={rdm.fieldLabelRow}>
                <Ionicons name="lock-closed-outline" size={13} color={COLORS.textMuted} />
                <Text style={[rdm.fieldLabel, { color: COLORS.textMuted }]}>Note interne (bailleur uniquement)</Text>
              </View>
              <TextInput
                style={rdm.noteInput}
                placeholder="Action prévue, contact artisan…"
                placeholderTextColor={COLORS.textMuted}
                value={note} onChangeText={setNote} multiline numberOfLines={2}
              />
            </View>

            <View style={rdm.actions}>
              <Pressable style={rdm.saveBtn} onPress={() => save()} disabled={saving || archiving}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={rdm.saveBtnText}>Enregistrer</Text>}
              </Pressable>
              {nextStatus && !isArchived && (
                <Pressable style={[rdm.nextBtn, { borderColor: REPORT_STATUS[nextStatus].color }]} onPress={() => save(nextStatus)} disabled={saving || archiving}>
                  <Text style={[rdm.nextBtnText, { color: REPORT_STATUS[nextStatus].color }]}>
                    {nextStatus === "in_progress" ? "Marquer « En cours »" : "Marquer « Résolu »"}
                  </Text>
                </Pressable>
              )}
              <Pressable style={[rdm.archiveBtn, isArchived && rdm.archiveBtnActive]} onPress={toggleArchive} disabled={saving || archiving}>
                {archiving ? (
                  <ActivityIndicator size="small" color={isArchived ? "#6366F1" : COLORS.textMuted} />
                ) : (
                  <>
                    <Ionicons name={isArchived ? "arrow-undo-outline" : "archive-outline"} size={15} color={isArchived ? "#6366F1" : COLORS.textMuted} />
                    <Text style={[rdm.archiveBtnText, isArchived && { color: "#6366F1" }]}>
                      {isArchived ? "Restaurer" : "Archiver ce signalement"}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const rdm = StyleSheet.create({
  sheet:        { position: "absolute", left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12, maxHeight: "90%" },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 16 },
  header:       { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  catIcon:      { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  catLabel:     { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  badge:        { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText:    { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  desc:         { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 21, marginBottom: 6 },
  date:         { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 16 },
  fieldGroup:   { marginBottom: 14 },
  fieldLabelRow:{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  fieldLabel:   { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  noteInput:    { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#FAFAFA", minHeight: 60, textAlignVertical: "top" },
  actions:      { gap: 10, marginTop: 4, marginBottom: 8 },
  saveBtn:      { backgroundColor: "#8B5CF6", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  saveBtnText:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  nextBtn:      { borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1.5, backgroundColor: "transparent" },
  nextBtnText:  { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  archiveBtn:   { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 },
  archiveBtnActive: {},
  archiveBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
});

// ─── Gestion documents ─────────────────────────────────────────────────────────

const DOC_TYPES: PropertyDocumentType[] = ["lease", "dpe", "invoice", "quote", "other"];
type AddMode = "file" | "link";

function AddDocModal({ propertyId, landlordId, onClose }: { propertyId: string; landlordId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [mode, setMode]       = useState<AddMode>("file");
  const [type, setType]       = useState<PropertyDocumentType>("other");
  const [label, setLabel]     = useState("");
  const [url, setUrl]         = useState("");
  const [visible, setVisible] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [fileUri, setFileUri]   = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [fileMime, setFileMime] = useState<string>("application/octet-stream");

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true });
    if (res.canceled) return;
    const asset = res.assets[0];
    setFileUri(asset.uri); setFileName(asset.name ?? "document.pdf"); setFileMime(asset.mimeType ?? "application/pdf");
    if (!label) setLabel(asset.name?.replace(/\.[^.]+$/, "") ?? "");
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission refusée", "Autorisez l'accès à la photothèque."); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsMultipleSelection: false });
    if (res.canceled) return;
    const asset = res.assets[0];
    const ext  = asset.uri.split(".").pop()?.toLowerCase() ?? "jpg";
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    setFileUri(asset.uri); setFileName(`image.${ext}`); setFileMime(mime);
    if (!label) setLabel("Photo");
  };

  const handleSave = async () => {
    if (!label.trim()) { Alert.alert("Nom manquant"); return; }
    if (mode === "link") {
      if (!url.trim()) { Alert.alert("Lien manquant", "Collez l'URL du document."); return; }
      setSaving(true);
      try {
        await addDoc(collection(db, "properties", propertyId, "documents"), {
          propertyId, landlordId, type, label: label.trim(), url: url.trim(),
          visibleToTenant: visible, uploadedBy: landlordId, createdAt: new Date().toISOString(),
        } satisfies Omit<PropertyDocument, "id">);
        onClose();
      } catch { Alert.alert("Erreur", "Impossible d'ajouter le document."); }
      finally { setSaving(false); }
      return;
    }
    if (!fileUri) { Alert.alert("Fichier manquant", "Choisissez un fichier PDF, PNG ou JPG."); return; }
    setSaving(true);
    try {
      const resp = await fetch(fileUri);
      const blob = await resp.blob();
      const ext  = fileName.split(".").pop() ?? "pdf";
      const id   = Date.now().toString(36);
      const ref  = storageRef(storage, `properties/${propertyId}/documents/${id}.${ext}`);
      await uploadBytes(ref, blob, { contentType: fileMime });
      const downloadUrl = await getDownloadURL(ref);
      await addDoc(collection(db, "properties", propertyId, "documents"), {
        propertyId, landlordId, type, label: label.trim(), url: downloadUrl,
        visibleToTenant: visible, uploadedBy: landlordId, mimeType: fileMime,
        createdAt: new Date().toISOString(),
      } satisfies Omit<PropertyDocument, "id">);
      onClose();
    } catch (e) {
      console.warn("[AddDocModal] upload", e);
      Alert.alert("Erreur", "Impossible d'uploader le fichier.");
    } finally { setSaving(false); }
  };

  return (
    <Modal visible transparent animationType="slide">
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ justifyContent: "flex-end" }}>
          <View style={[addDoc_.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={addDoc_.handle} />
            <Text style={addDoc_.title}>Ajouter un document</Text>
            <View style={addDoc_.tabs}>
              {(["file", "link"] as AddMode[]).map((m) => (
                <Pressable key={m} style={[addDoc_.tab, mode === m && addDoc_.tabActive]} onPress={() => setMode(m)}>
                  <Ionicons name={m === "file" ? "cloud-upload-outline" : "link-outline"} size={14} color={mode === m ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[addDoc_.tabText, mode === m && addDoc_.tabTextActive]}>{m === "file" ? "Fichier" : "Lien URL"}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={addDoc_.label}>Type de document</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {DOC_TYPES.map((t) => (
                  <Pressable key={t} style={[addDoc_.chip, type === t && addDoc_.chipActive]} onPress={() => setType(t)}>
                    <Ionicons name={PROPERTY_DOCUMENT_TYPE_ICONS[t] as any} size={14} color={type === t ? COLORS.primary : COLORS.textMuted} />
                    <Text style={[addDoc_.chipText, type === t && addDoc_.chipTextActive]}>{PROPERTY_DOCUMENT_TYPE_LABELS[t]}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Text style={addDoc_.label}>Nom du document *</Text>
            <TextInput style={addDoc_.input} placeholder="ex : Bail signé 2026" placeholderTextColor={COLORS.textMuted} value={label} onChangeText={setLabel} />
            {mode === "file" ? (
              <View style={{ gap: 8, marginBottom: 14 }}>
                <Text style={addDoc_.label}>Fichier (PDF, PNG, JPG)</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable style={[addDoc_.fileBtn, { flex: 1 }]} onPress={pickFile}>
                    <Ionicons name="document-outline" size={16} color={COLORS.primary} />
                    <Text style={addDoc_.fileBtnText}>PDF</Text>
                  </Pressable>
                  <Pressable style={[addDoc_.fileBtn, { flex: 1 }]} onPress={pickImage}>
                    <Ionicons name="image-outline" size={16} color={COLORS.primary} />
                    <Text style={addDoc_.fileBtnText}>PNG / JPG</Text>
                  </Pressable>
                </View>
                {fileUri ? (
                  <View style={addDoc_.fileChosen}>
                    <Ionicons name={fileMime.startsWith("image") ? "image-outline" : "document-text-outline"} size={16} color="#10B981" />
                    <Text style={addDoc_.fileChosenText} numberOfLines={1}>{fileName}</Text>
                    <Pressable onPress={() => { setFileUri(null); setFileName(""); }}>
                      <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
                    </Pressable>
                  </View>
                ) : (
                  <Text style={addDoc_.fileHint}>Aucun fichier sélectionné</Text>
                )}
              </View>
            ) : (
              <>
                <Text style={addDoc_.label}>Lien (URL) *</Text>
                <TextInput style={[addDoc_.input, { marginBottom: 14 }]} placeholder="https://drive.google.com/…" placeholderTextColor={COLORS.textMuted} value={url} onChangeText={setUrl} autoCapitalize="none" keyboardType="url" />
              </>
            )}
            <Pressable style={addDoc_.toggleRow} onPress={() => setVisible((v) => !v)}>
              <View style={[addDoc_.toggle, visible && addDoc_.toggleOn]}>
                <View style={[addDoc_.toggleDot, visible && addDoc_.toggleDotOn]} />
              </View>
              <Text style={addDoc_.toggleLabel}>Visible par le locataire</Text>
            </Pressable>
            <Pressable style={addDoc_.btn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={addDoc_.btnText}>{mode === "file" ? "Uploader et ajouter" : "Ajouter"}</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const addDoc_ = StyleSheet.create({
  sheet:         { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 12 },
  handle:        { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 16 },
  title:         { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 20 },
  label:         { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  input:         { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#FAFAFA", marginBottom: 14 },
  chip:          { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#F8F8F8" },
  chipActive:    { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  chipText:      { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chipTextActive:{ color: COLORS.primary },
  toggleRow:     { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  toggleLabel:   { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, flex: 1 },
  toggle:        { width: 44, height: 26, borderRadius: 13, backgroundColor: "#E2E8F0", justifyContent: "center", paddingHorizontal: 3 },
  toggleOn:      { backgroundColor: "#10B981" },
  toggleDot:     { width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
  toggleDotOn:   { alignSelf: "flex-end" },
  tabs:          { flexDirection: "row", gap: 8, marginBottom: 18 },
  tab:           { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#F8F8F8" },
  tabActive:     { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  tabText:       { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  tabTextActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  fileBtn:       { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: "dashed", backgroundColor: "#EEF2FF" },
  fileBtnText:   { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  fileChosen:    { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 8, padding: 10, borderWidth: 1, borderColor: "#D1FAE5" },
  fileChosenText:{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#065F46" },
  fileHint:      { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  btn:           { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText:       { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

function DocumentsSection({ propertyId, landlordId }: { propertyId: string; landlordId: string }) {
  const [docs, setDocs]       = useState<PropertyDocument[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "properties", propertyId, "documents"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyDocument))));
  }, [propertyId]);

  const handleDelete = (docId: string, docLabel: string) => {
    Alert.alert("Supprimer le document ?", `"${docLabel}" sera supprimé.`, [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => deleteDoc(doc(db, "properties", propertyId, "documents", docId)).catch(() => Alert.alert("Erreur", "Impossible de supprimer.")) },
    ]);
  };

  const handleOpen = async (url: string) => {
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
      else Alert.alert("Lien invalide", url);
    } catch { Alert.alert("Erreur", "Impossible d'ouvrir le lien."); }
  };

  const handleToggleVisible = async (d: PropertyDocument) => {
    await updateDoc(doc(db, "properties", propertyId, "documents", d.id), { visibleToTenant: !d.visibleToTenant }).catch(() => Alert.alert("Erreur", "Impossible de modifier."));
  };

  return (
    <View>
      <View style={docSec.header}>
        <Text style={docSec.sectionTitle}>Documents</Text>
        <Pressable style={docSec.addBtn} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={16} color={COLORS.primary} />
          <Text style={docSec.addBtnText}>Ajouter</Text>
        </Pressable>
      </View>
      {docs.length === 0 ? (
        <View style={docSec.empty}>
          <Ionicons name="folder-outline" size={32} color={COLORS.textMuted} style={{ opacity: 0.5 }} />
          <Text style={docSec.emptyText}>Aucun document</Text>
          <Text style={docSec.emptyDesc}>Bail, DPE, factures… ajoutez un lien vers vos documents.</Text>
        </View>
      ) : (
        docs.map((d) => (
          <View key={d.id} style={docSec.row}>
            <Pressable style={docSec.rowMain} onPress={() => handleOpen(d.url)}>
              <View style={[docSec.icon, { backgroundColor: d.visibleToTenant ? "#EFF6FF" : "#F8FAFC" }]}>
                <Ionicons name={PROPERTY_DOCUMENT_TYPE_ICONS[d.type] as any} size={18} color={d.visibleToTenant ? "#3B82F6" : COLORS.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={docSec.rowLabel} numberOfLines={1}>{d.label}</Text>
                <Text style={docSec.rowType}>{PROPERTY_DOCUMENT_TYPE_LABELS[d.type]}</Text>
              </View>
              <Ionicons name="open-outline" size={14} color={COLORS.textMuted} />
            </Pressable>
            <View style={docSec.rowActions}>
              <Pressable style={docSec.visibleBtn} onPress={() => handleToggleVisible(d)}>
                <Ionicons name={d.visibleToTenant ? "eye" : "eye-off-outline"} size={14} color={d.visibleToTenant ? "#10B981" : COLORS.textMuted} />
                <Text style={[docSec.visibleText, d.visibleToTenant && { color: "#10B981" }]}>{d.visibleToTenant ? "Visible locataire" : "Non visible"}</Text>
              </Pressable>
              <Pressable onPress={() => handleDelete(d.id, d.label)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
              </Pressable>
            </View>
          </View>
        ))
      )}
      {showAdd && <AddDocModal propertyId={propertyId} landlordId={landlordId} onClose={() => setShowAdd(false)} />}
    </View>
  );
}

const docSec = StyleSheet.create({
  header:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle:{ fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  addBtn:      { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  addBtnText:  { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  empty:       { alignItems: "center", gap: 6, paddingVertical: 20 },
  emptyText:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyDesc:   { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  row:         { backgroundColor: "#fff", borderRadius: 12, marginBottom: 8, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  rowMain:     { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  icon:        { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel:    { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  rowType:     { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  rowActions:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: "#F0F0F0", paddingTop: 8 },
  visibleBtn:  { flexDirection: "row", alignItems: "center", gap: 5 },
  visibleText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
});

// ─── Utilitaires date masquée ─────────────────────────────────────────────────

function maskDate(raw: string, prev: string): string {
  if (raw.length < prev.length) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";
  let result = "";
  if (digits.length <= 2) result = digits;
  else if (digits.length <= 4) result = digits.slice(0, 2) + "/" + digits.slice(2);
  else result = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4, 8);
  return result;
}
function displayToISO(display: string): string {
  const parts = display.split("/");
  if (parts.length !== 3 || parts[2].length !== 4) return "";
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return "";
  return `${yyyy}-${mm}-${dd}`;
}
function isoToDisplay(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const [yyyy, mm, dd] = iso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Modal invitation locataire ───────────────────────────────────────────────

interface InviteFormData {
  firstName: string; lastName: string; email: string; phone: string;
  leaseStartDate: string; leaseEndDate: string;
}

function InviteModal({ visible, propertyId, onClose, onSuccess }: {
  visible: boolean; propertyId: string; onClose: () => void; onSuccess: (token: string, tenantName: string) => void;
}) {
  const [form, setForm] = useState<InviteFormData>({ firstName: "", lastName: "", email: "", phone: "", leaseStartDate: "", leaseEndDate: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof InviteFormData) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const canSubmit = form.firstName.trim() && form.lastName.trim() && form.email.trim();

  const handleSend = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) throw new Error("Non authentifié");
      const startISO = displayToISO(form.leaseStartDate);
      const endISO   = displayToISO(form.leaseEndDate);
      const res = await apiRequest("POST", "/api/rental/invite-tenant", {
        propertyId, firstName: form.firstName.trim(), lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(), phone: form.phone.trim() || undefined,
        leaseStartDate: startISO || undefined, leaseEndDate: endISO || undefined,
      }, { Authorization: `Bearer ${idToken}` });
      const data = await res.json();
      onSuccess(data.token as string, `${form.firstName.trim()} ${form.lastName.trim()}`);
      setForm({ firstName: "", lastName: "", email: "", phone: "", leaseStartDate: "", leaseEndDate: "" });
      onClose();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message ?? "Impossible d'envoyer l'invitation. Réessayez.");
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"} onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#fff" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={invS.header}>
          <Text style={invS.title}>Inviter un locataire</Text>
          <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={COLORS.text} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={invS.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={invS.hint}>Un email sera envoyé au locataire avec un code d'accès pour rejoindre votre logement.</Text>
          {([["Prénom *", "firstName", "given-name", "default"], ["Nom *", "lastName", "family-name", "default"], ["Email *", "email", "email", "email-address"], ["Téléphone", "phone", "tel", "phone-pad"]] as const).map(([lbl, key, auto, keyType]) => (
            <View key={key} style={invS.field}>
              <Text style={invS.label}>{lbl}</Text>
              <TextInput style={invS.input} placeholder={lbl.replace(" *", "")} placeholderTextColor={COLORS.textMuted} value={form[key as keyof InviteFormData]} onChangeText={set(key as keyof InviteFormData)} autoComplete={auto as any} keyboardType={keyType as any} autoCapitalize={key === "email" ? "none" : "words"} />
            </View>
          ))}
          <View style={invS.row}>
            <View style={{ flex: 1 }}>
              <Text style={invS.label}>Début de bail *</Text>
              <TextInput style={invS.input} placeholder="JJ/MM/AAAA" placeholderTextColor={COLORS.textMuted} value={form.leaseStartDate} onChangeText={(v) => setForm((f) => ({ ...f, leaseStartDate: maskDate(v, f.leaseStartDate) }))} keyboardType="number-pad" maxLength={10} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={invS.label}>Fin de bail</Text>
              <TextInput style={invS.input} placeholder="JJ/MM/AAAA" placeholderTextColor={COLORS.textMuted} value={form.leaseEndDate} onChangeText={(v) => setForm((f) => ({ ...f, leaseEndDate: maskDate(v, f.leaseEndDate) }))} keyboardType="number-pad" maxLength={10} />
            </View>
          </View>
          <View style={invS.actions}>
            <Pressable style={invS.cancelBtn} onPress={onClose}><Text style={invS.cancelText}>Annuler</Text></Pressable>
            <Pressable style={[invS.sendBtn, (!canSubmit || saving) && invS.sendBtnDisabled]} onPress={handleSend} disabled={!canSubmit || saving}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <><Ionicons name="paper-plane-outline" size={16} color="#fff" /><Text style={invS.sendText}>Envoyer</Text></>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const invS = StyleSheet.create({
  header:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title:         { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  scroll:        { padding: 20, gap: 4 },
  hint:          { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 19, marginBottom: 16 },
  field:         { marginBottom: 14 },
  label:         { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  row:           { flexDirection: "row", gap: 12, marginBottom: 14 },
  input:         { backgroundColor: COLORS.surfaceAlt, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", color: COLORS.text },
  actions:       { flexDirection: "row", gap: 12, marginTop: 8 },
  cancelBtn:     { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, paddingVertical: 14, backgroundColor: COLORS.surfaceAlt },
  cancelText:    { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  sendBtn:       { flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14, backgroundColor: "#8B5CF6" },
  sendBtnDisabled:{ opacity: 0.5 },
  sendText:      { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

function TokenModal({ visible, token, tenantName, onClose }: { visible: boolean; token: string; tenantName: string; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={tokS.overlay}>
        <View style={tokS.card}>
          <Ionicons name="checkmark-circle" size={48} color="#10B981" style={{ marginBottom: 4 }} />
          <Text style={tokS.title}>Invitation envoyée !</Text>
          <Text style={tokS.subtitle}>Un email a été envoyé à {tenantName}.{"\n"}Le code ci-dessous est valable 30 jours.</Text>
          <View style={tokS.tokenBox}>
            <Text style={tokS.tokenLabel}>Code d'accès</Text>
            <Text style={tokS.token}>{token}</Text>
          </View>
          <Text style={tokS.note}>Notez ce code — il ne sera plus affiché après fermeture.</Text>
          <Pressable style={tokS.closeBtn} onPress={onClose}><Text style={tokS.closeText}>Fermer</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const tokS = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 24 },
  card:       { backgroundColor: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 360, alignItems: "center", gap: 12 },
  title:      { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle:   { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 20 },
  tokenBox:   { backgroundColor: "rgba(139,92,246,0.07)", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 16, alignItems: "center", width: "100%", borderWidth: 2, borderColor: "rgba(139,92,246,0.2)", marginVertical: 4 },
  tokenLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#8B5CF6", letterSpacing: 1, textTransform: "uppercase" },
  token:      { fontSize: 34, fontFamily: "Inter_700Bold", color: "#8B5CF6", letterSpacing: 8, marginTop: 6 },
  note:       { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  closeBtn:   { marginTop: 8, backgroundColor: "#8B5CF6", borderRadius: 12, paddingHorizontal: 32, paddingVertical: 13, width: "100%", alignItems: "center" },
  closeText:  { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { user } = useAuth();

  const [property, setProperty]     = useState<RentalProperty | null>(null);
  const [tenants, setTenants]       = useState<PropertyTenant[]>([]);
  const [reports, setReports]       = useState<TenantReport[]>([]);
  const [interventions, setInterventions] = useState<PropertyIntervention[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [tokenModal, setTokenModal] = useState<{ visible: boolean; token: string; name: string }>({ visible: false, token: "", name: "" });
  const [hubTab, setHubTab]         = useState<HubTab>("overview");
  const [selectedReport, setSelectedReport] = useState<TenantReport | null>(null);

  // Chargement du logement
  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "properties", id), (snap) => {
      if (snap.exists()) setProperty({ id: snap.id, ...snap.data() } as RentalProperty);
      setLoading(false);
    }, () => setLoading(false));
  }, [id]);

  // Locataires
  useEffect(() => {
    if (!id) return;
    return onSnapshot(query(collection(db, "properties", id, "tenants"), orderBy("createdAt", "desc")), (snap) => {
      setTenants(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyTenant)));
    });
  }, [id]);

  // Signalements
  useEffect(() => {
    if (!id) return;
    return onSnapshot(query(collection(db, "properties", id, "tenantReports"), orderBy("createdAt", "desc")), (snap) => {
      setReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as TenantReport)));
    }, (err) => console.warn("[PropertyHub] tenantReports", err));
  }, [id]);

  // Interventions
  useEffect(() => {
    if (!id) return;
    return onSnapshot(query(collection(db, "properties", id, "interventions"), orderBy("createdAt", "desc")), (snap) => {
      setInterventions(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyIntervention)));
    }, (err) => console.warn("[PropertyHub] interventions", err));
  }, [id]);

  const activeTenants = tenants.filter((t) => t.status === "active" || t.status === "invited");
  const pastTenants   = tenants.filter((t) => t.status === "departed");

  const handleInviteSuccess = useCallback((token: string, name: string) => {
    setShowInvite(false);
    setTokenModal({ visible: true, token, name });
  }, []);

  const pendingReports = reports.filter((r) => !r.archivedByLandlord && r.status === "pending").length;
  const activeInterventions = interventions.filter((i) => i.status !== "completed" && i.status !== "cancelled").length;

  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 8;

  if (loading) return <View style={[s.root, s.center]}><ActivityIndicator color="#8B5CF6" size="large" /></View>;
  if (!property) return (
    <View style={[s.root, s.center]}>
      <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
      <Text style={s.notFoundText}>Logement introuvable</Text>
      <Pressable style={s.backBtnAlt} onPress={() => router.back()}><Text style={s.backBtnAltText}>Retour</Text></Pressable>
    </View>
  );

  const typeIcon = PROPERTY_TYPE_ICONS[property.propertyType] as any;

  // ── Contenu par onglet ─────────────────────────────────────────────────────

  const renderOverview = () => (
    <>
      {/* Infos logement */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Informations</Text>
        <View style={s.infoCard}>
          <View style={s.infoRow}>
            <View style={s.infoIconBox}><Ionicons name={typeIcon} size={18} color="#8B5CF6" /></View>
            <Text style={s.infoLabel}>Type</Text>
            <Text style={s.infoValue}>{PROPERTY_TYPE_LABELS[property.propertyType]}</Text>
          </View>
          {!!property.surface && (
            <View style={[s.infoRow, s.infoRowDivider]}>
              <View style={s.infoIconBox}><Ionicons name="resize-outline" size={18} color="#8B5CF6" /></View>
              <Text style={s.infoLabel}>Surface</Text>
              <Text style={s.infoValue}>{property.surface} m²</Text>
            </View>
          )}
          {!!property.numberOfRooms && (
            <View style={[s.infoRow, s.infoRowDivider]}>
              <View style={s.infoIconBox}><Ionicons name="grid-outline" size={18} color="#8B5CF6" /></View>
              <Text style={s.infoLabel}>Pièces</Text>
              <Text style={s.infoValue}>{property.numberOfRooms}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Locataires actifs */}
      <View style={s.section}>
        <View style={s.sectionRow}>
          <Text style={s.sectionTitle}>Locataire{activeTenants.length > 1 ? "s" : ""}{activeTenants.length > 0 ? ` (${activeTenants.length})` : ""}</Text>
          <Pressable style={s.inviteBtn} onPress={() => setShowInvite(true)}>
            <Ionicons name="person-add" size={15} color="#fff" />
            <Text style={s.inviteBtnText}>Inviter</Text>
          </Pressable>
        </View>
        {activeTenants.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="person-outline" size={36} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
            <Text style={s.emptyText}>Aucun locataire actif</Text>
            <Pressable style={s.emptyInviteBtn} onPress={() => setShowInvite(true)}>
              <Ionicons name="paper-plane-outline" size={16} color="#8B5CF6" />
              <Text style={s.emptyInviteText}>Envoyer une invitation</Text>
            </Pressable>
          </View>
        ) : (
          activeTenants.map((t) => <TenantRow key={t.id} tenant={t} />)
        )}
      </View>

      {pastTenants.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Historique locataires</Text>
          {pastTenants.map((t) => <TenantRow key={t.id} tenant={t} />)}
        </View>
      )}

      {/* Résumé rapide */}
      <View style={s.quickRow}>
        <Pressable style={s.quickCard} onPress={() => setHubTab("reports")}>
          <View style={[s.quickIcon, { backgroundColor: "#FEF2F2" }]}><Ionicons name="warning-outline" size={20} color="#EF4444" /></View>
          <Text style={s.quickCount}>{reports.filter((r) => !r.archivedByLandlord && r.status !== "resolved").length}</Text>
          <Text style={s.quickLabel}>Signalements actifs</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} style={{ marginTop: 4 }} />
        </Pressable>
        <Pressable style={s.quickCard} onPress={() => setHubTab("interventions")}>
          <View style={[s.quickIcon, { backgroundColor: "#FFFBEB" }]}><Ionicons name="construct-outline" size={20} color="#F59E0B" /></View>
          <Text style={s.quickCount}>{activeInterventions}</Text>
          <Text style={s.quickLabel}>Interventions en cours</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} style={{ marginTop: 4 }} />
        </Pressable>
        <Pressable style={s.quickCard} onPress={() => setHubTab("messages")}>
          <View style={[s.quickIcon, { backgroundColor: "rgba(139,92,246,0.1)" }]}><Ionicons name="chatbubbles-outline" size={20} color="#8B5CF6" /></View>
          <Text style={s.quickCount}></Text>
          <Text style={s.quickLabel}>Messagerie</Text>
          <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} style={{ marginTop: 4 }} />
        </Pressable>
      </View>
    </>
  );

  const renderReports = () => {
    const activeReports   = reports.filter((r) => !r.archivedByLandlord);
    const archivedReports = reports.filter((r) => r.archivedByLandlord);
    return (
      <View style={s.section}>
        {activeReports.length === 0 && archivedReports.length === 0 ? (
          <View style={s.tabEmpty}>
            <Ionicons name="checkmark-circle-outline" size={52} color={COLORS.textMuted} style={{ opacity: 0.3 }} />
            <Text style={s.tabEmptyTitle}>Aucun signalement</Text>
            <Text style={s.tabEmptyDesc}>Le locataire peut envoyer des signalements depuis son espace.</Text>
          </View>
        ) : (
          <>
            {activeReports.map((r) => {
              const cfg = REPORT_STATUS[r.status];
              const cat = REPORT_CATEGORIES[r.category] ?? REPORT_CATEGORIES.autre;
              return (
                <Pressable key={r.id} style={rpt.card} onPress={() => setSelectedReport(r)}>
                  <View style={[rpt.catIcon, { backgroundColor: cfg.bg }]}>
                    <Ionicons name={cat.icon as any} size={18} color={cfg.color} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={rpt.catLabel}>{cat.label}</Text>
                    <Text style={rpt.desc} numberOfLines={2}>{r.description}</Text>
                    <Text style={rpt.date}>{new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</Text>
                  </View>
                  <View style={[rpt.badge, { backgroundColor: cfg.bg }]}>
                    <Text style={[rpt.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </Pressable>
              );
            })}
            {archivedReports.length > 0 && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 16, marginBottom: 8 }]}>Archivés ({archivedReports.length})</Text>
                {archivedReports.map((r) => {
                  const cat = REPORT_CATEGORIES[r.category] ?? REPORT_CATEGORIES.autre;
                  return (
                    <Pressable key={r.id} style={[rpt.card, { opacity: 0.6 }]} onPress={() => setSelectedReport(r)}>
                      <View style={[rpt.catIcon, { backgroundColor: "#F1F5F9" }]}>
                        <Ionicons name="archive-outline" size={18} color="#6366F1" />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text style={rpt.catLabel}>{cat.label}</Text>
                        <Text style={rpt.desc} numberOfLines={1}>{r.description}</Text>
                      </View>
                      <View style={[rpt.badge, { backgroundColor: "#EEF2FF" }]}>
                        <Text style={[rpt.badgeText, { color: "#6366F1" }]}>Archivé</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </>
            )}
          </>
        )}
      </View>
    );
  };

  const renderMessages = () => (
    <View style={s.section}>
      <View style={msg.card}>
        <View style={msg.iconWrap}>
          <Ionicons name="chatbubbles" size={36} color="#8B5CF6" />
        </View>
        <Text style={msg.title}>Messagerie locataire</Text>
        <Text style={msg.desc}>
          Échangez directement avec {activeTenants.length > 0 ? `${activeTenants[0].firstName} ${activeTenants[0].lastName}` : "votre locataire"} par messages texte ou audio.
        </Text>
        <Pressable style={msg.openBtn} onPress={() => router.push(`/property-messages?propertyId=${id}` as any)}>
          <Ionicons name="chatbubbles-outline" size={18} color="#fff" />
          <Text style={msg.openBtnText}>Ouvrir la messagerie</Text>
          <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.7)" />
        </Pressable>
        {activeTenants.length === 0 && (
          <Text style={msg.noTenant}>Invitez d'abord un locataire pour activer la messagerie.</Text>
        )}
      </View>
    </View>
  );

  const renderInterventions = () => {
    const active   = interventions.filter((i) => i.status !== "completed" && i.status !== "cancelled");
    const done     = interventions.filter((i) => i.status === "completed");
    return (
      <View style={s.section}>
        {interventions.length === 0 ? (
          <View style={s.tabEmpty}>
            <Ionicons name="construct-outline" size={52} color={COLORS.textMuted} style={{ opacity: 0.3 }} />
            <Text style={s.tabEmptyTitle}>Aucune intervention</Text>
            <Text style={s.tabEmptyDesc}>Les interventions planifiées pour ce logement apparaîtront ici.</Text>
          </View>
        ) : (
          <>
            {active.map((item) => <InterventionRow key={item.id} item={item} />)}
            {done.length > 0 && (
              <>
                <Text style={[s.sectionTitle, { marginTop: 16, marginBottom: 8 }]}>Terminées ({done.length})</Text>
                {done.map((item) => <InterventionRow key={item.id} item={item} />)}
              </>
            )}
          </>
        )}
      </View>
    );
  };

  const renderDocuments = () => (
    <View style={s.section}>
      <DocumentsSection propertyId={id ?? ""} landlordId={user?.uid ?? ""} />
    </View>
  );

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {property.address}{property.apartmentNumber ? ` — Apt ${property.apartmentNumber}` : ""}
          </Text>
          <Text style={s.headerSub}>{property.postalCode} {property.city}</Text>
        </View>
        <StatusBadge status={property.status} />
      </View>

      {/* Tab bar */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={s.tabBar} contentContainerStyle={s.tabBarContent}
      >
        {HUB_TABS.map((tab) => {
          const isActive = hubTab === tab.key;
          const badge = tab.key === "reports" && pendingReports > 0 ? pendingReports
                      : tab.key === "interventions" && activeInterventions > 0 ? activeInterventions
                      : 0;
          return (
            <Pressable key={tab.key} style={[s.tab, isActive && s.tabActive]} onPress={() => setHubTab(tab.key)}>
              <Ionicons name={tab.icon as any} size={13} color={isActive ? "#8B5CF6" : COLORS.textMuted} />
              <Text style={[s.tabText, isActive && s.tabTextActive]}>{tab.label}</Text>
              {badge > 0 && (
                <View style={s.tabBadge}><Text style={s.tabBadgeText}>{badge}</Text></View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Contenu */}
      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        {hubTab === "overview"      && renderOverview()}
        {hubTab === "reports"       && renderReports()}
        {hubTab === "messages"      && renderMessages()}
        {hubTab === "interventions" && renderInterventions()}
        {hubTab === "documents"     && renderDocuments()}
      </ScrollView>

      {/* Modals */}
      <InviteModal visible={showInvite} propertyId={id ?? ""} onClose={() => setShowInvite(false)} onSuccess={handleInviteSuccess} />
      <TokenModal visible={tokenModal.visible} token={tokenModal.token} tenantName={tokenModal.name} onClose={() => setTokenModal((p) => ({ ...p, visible: false }))} />
      {selectedReport && (
        <ReportDetailModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onUpdated={() => {}} // onSnapshot auto-updates
        />
      )}
    </View>
  );
}

// ─── Carte intervention (inline) ──────────────────────────────────────────────

function InterventionRow({ item }: { item: PropertyIntervention }) {
  const statusColor = RENTAL_INTERVENTION_STATUS_COLORS[item.status];
  const statusLabel = RENTAL_INTERVENTION_STATUS_LABELS[item.status];
  const titleLow = item.title.toLowerCase();
  const catKey   = Object.keys(INT_CAT_ICONS).find((k) => titleLow.includes(k)) ?? "autre";
  const catIcon  = INT_CAT_ICONS[catKey];
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable style={[intv.card, item.status === "completed" && intv.cardDone]} onPress={() => setExpanded((v) => !v)}>
      <View style={[intv.rail, { backgroundColor: statusColor }]} />
      <View style={intv.body}>
        <View style={intv.topRow}>
          <View style={[intv.iconBox, { backgroundColor: statusColor + "22" }]}>
            <Ionicons name={catIcon as any} size={16} color={statusColor} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[intv.title, item.status === "completed" && intv.titleDone]} numberOfLines={expanded ? undefined : 1}>{item.title}</Text>
            <Text style={intv.meta}>{new Date(item.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</Text>
          </View>
          <View style={[intv.statusBadge, { backgroundColor: statusColor + "22" }]}>
            <View style={[intv.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[intv.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={13} color={COLORS.textMuted} />
        </View>
        {expanded && (
          <View style={intv.expandedBody}>
            {item.description ? <Text style={intv.desc}>{item.description}</Text> : null}
            {item.scheduledDate && (
              <View style={intv.infoRow}>
                <Ionicons name="calendar-outline" size={13} color="#3B82F6" />
                <Text style={intv.infoText}>Planifiée le {new Date(item.scheduledDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</Text>
              </View>
            )}
            {item.estimatedCost != null && (
              <View style={intv.infoRow}>
                <Ionicons name="cash-outline" size={13} color={COLORS.textMuted} />
                <Text style={intv.infoText}>Coût estimé : {item.estimatedCost.toLocaleString("fr-FR")} €{item.finalCost != null ? ` · Final : ${item.finalCost.toLocaleString("fr-FR")} €` : ""}</Text>
              </View>
            )}
            {item.report && (
              <View style={intv.reportBox}>
                <Ionicons name="document-text-outline" size={12} color="#8B5CF6" />
                <Text style={intv.reportText}>{item.report}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const intv = StyleSheet.create({
  card:         { flexDirection: "row", backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: COLORS.border, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  cardDone:     { opacity: 0.7 },
  rail:         { width: 4, alignSelf: "stretch" },
  body:         { flex: 1, padding: 14, gap: 8 },
  topRow:       { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBox:      { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title:        { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  titleDone:    { color: COLORS.textMuted },
  meta:         { fontSize: 10, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  statusBadge:  { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexShrink: 0 },
  statusDot:    { width: 5, height: 5, borderRadius: 3 },
  statusText:   { fontSize: 10, fontFamily: "Inter_700Bold" },
  expandedBody: { gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  desc:         { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 },
  infoRow:      { flexDirection: "row", alignItems: "center", gap: 7 },
  infoText:     { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  reportBox:    { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "rgba(139,92,246,0.06)", borderRadius: 8, padding: 10, borderLeftWidth: 2, borderLeftColor: "#8B5CF6" },
  reportText:   { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 17 },
});

const rpt = StyleSheet.create({
  card:     { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  catIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  catLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  desc:     { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 17 },
  date:     { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  badge:    { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4, flexShrink: 0 },
  badgeText:{ fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

const msg = StyleSheet.create({
  card:        { backgroundColor: "#fff", borderRadius: 20, padding: 28, alignItems: "center", gap: 14, borderWidth: 1, borderColor: COLORS.border, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  iconWrap:    { width: 72, height: 72, borderRadius: 22, backgroundColor: "rgba(139,92,246,0.08)", alignItems: "center", justifyContent: "center" },
  title:       { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  desc:        { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 20 },
  openBtn:     { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#8B5CF6", borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, marginTop: 4 },
  openBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  noTenant:    { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn:      { width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1 },
  headerTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },

  tabBar:        { flexGrow: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabBarContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  tab:           { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceAlt },
  tabActive:     { backgroundColor: "rgba(139,92,246,0.08)", borderColor: "#8B5CF6" },
  tabText:       { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  tabTextActive: { color: "#8B5CF6", fontFamily: "Inter_600SemiBold" },
  tabBadge:      { minWidth: 16, height: 16, borderRadius: 8, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  tabBadgeText:  { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },

  scroll:   { padding: 16, gap: 4 },
  section:  { marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },

  inviteBtn:      { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#8B5CF6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  inviteBtnText:  { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  infoCard:      { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
  infoRow:       { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  infoRowDivider:{ borderTopWidth: 1, borderTopColor: COLORS.border },
  infoIconBox:   { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(139,92,246,0.08)", alignItems: "center", justifyContent: "center" },
  infoLabel:     { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  infoValue:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },

  quickRow:      { flexDirection: "row", gap: 10, marginBottom: 20 },
  quickCard:     { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 14, alignItems: "center", gap: 4, borderWidth: 1, borderColor: COLORS.border },
  quickIcon:     { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  quickCount:    { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text },
  quickLabel:    { fontSize: 10, fontFamily: "Inter_500Medium", color: COLORS.textMuted, textAlign: "center" },

  empty:         { alignItems: "center", gap: 8, paddingVertical: 20 },
  emptyText:     { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyInviteBtn:{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "#8B5CF6" },
  emptyInviteText:{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  tabEmpty:      { alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 40, paddingHorizontal: 24 },
  tabEmptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary, textAlign: "center" },
  tabEmptyDesc:  { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center", lineHeight: 19 },

  notFoundText:  { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  backBtnAlt:    { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: COLORS.surfaceAlt, borderRadius: 10 },
  backBtnAltText:{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
});
