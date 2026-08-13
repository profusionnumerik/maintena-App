import { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import {
  RentalProperty,
  PropertyTenant,
  PropertyDocument,
  PropertyDocumentType,
  PropertyStatus,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPE_ICONS,
  PROPERTY_STATUS_LABELS,
  PROPERTY_STATUS_COLORS,
  PROPERTY_DOCUMENT_TYPE_LABELS,
  PROPERTY_DOCUMENT_TYPE_ICONS,
  TENANT_STATUS_LABELS,
  TENANT_STATUS_COLORS,
} from "@/shared/types";
import { Linking } from "react-native";

// ─── Petit badge statut ───────────────────────────────────────────────────────

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
  wrap: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});

// ─── Gestion documents ─────────────────────────────────────────────────────────

const DOC_TYPES: PropertyDocumentType[] = ["lease", "dpe", "invoice", "quote", "other"];

function AddDocModal({
  propertyId, landlordId, onClose,
}: { propertyId: string; landlordId: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [type, setType]       = useState<PropertyDocumentType>("other");
  const [label, setLabel]     = useState("");
  const [url, setUrl]         = useState("");
  const [visible, setVisible] = useState(true);
  const [saving, setSaving]   = useState(false);

  const handleSave = async () => {
    if (!label.trim()) { Alert.alert("Nom manquant"); return; }
    if (!url.trim())   { Alert.alert("Lien manquant", "Collez l'URL du document (Google Drive, Dropbox…)"); return; }
    setSaving(true);
    try {
      await addDoc(collection(db, "properties", propertyId, "documents"), {
        propertyId,
        landlordId,
        type,
        label: label.trim(),
        url: url.trim(),
        visibleToTenant: visible,
        uploadedBy: landlordId,
        createdAt: new Date().toISOString(),
      } satisfies Omit<PropertyDocument, "id">);
      onClose();
    } catch {
      Alert.alert("Erreur", "Impossible d'ajouter le document.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide">
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ justifyContent: "flex-end" }}
        >
          <View style={[addDoc_.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={addDoc_.handle} />
            <Text style={addDoc_.title}>Ajouter un document</Text>

            <Text style={addDoc_.label}>Type de document</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {DOC_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    style={[addDoc_.chip, type === t && addDoc_.chipActive]}
                    onPress={() => setType(t)}
                  >
                    <Ionicons
                      name={PROPERTY_DOCUMENT_TYPE_ICONS[t] as any}
                      size={14}
                      color={type === t ? COLORS.primary : COLORS.textMuted}
                    />
                    <Text style={[addDoc_.chipText, type === t && addDoc_.chipTextActive]}>
                      {PROPERTY_DOCUMENT_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={addDoc_.label}>Nom du document *</Text>
            <TextInput
              style={addDoc_.input}
              placeholder="ex : Bail signé 2026"
              placeholderTextColor={COLORS.textMuted}
              value={label}
              onChangeText={setLabel}
            />

            <Text style={addDoc_.label}>Lien (URL) *</Text>
            <TextInput
              style={addDoc_.input}
              placeholder="https://drive.google.com/…"
              placeholderTextColor={COLORS.textMuted}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              keyboardType="url"
            />

            <Pressable
              style={addDoc_.toggleRow}
              onPress={() => setVisible((v) => !v)}
            >
              <View style={[addDoc_.toggle, visible && addDoc_.toggleOn]}>
                <View style={[addDoc_.toggleDot, visible && addDoc_.toggleDotOn]} />
              </View>
              <Text style={addDoc_.toggleLabel}>Visible par le locataire</Text>
            </Pressable>

            <Pressable style={addDoc_.btn} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={addDoc_.btnText}>Ajouter</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function DocumentsSection({ propertyId, landlordId }: { propertyId: string; landlordId: string }) {
  const [docs, setDocs]       = useState<PropertyDocument[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "properties", propertyId, "documents"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyDocument)));
    });
  }, [propertyId]);

  const handleDelete = (docId: string, docLabel: string) => {
    Alert.alert(
      "Supprimer le document ?",
      `"${docLabel}" sera supprimé.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () =>
            deleteDoc(doc(db, "properties", propertyId, "documents", docId)).catch(() =>
              Alert.alert("Erreur", "Impossible de supprimer.")
            ),
        },
      ]
    );
  };

  const handleOpen = async (url: string) => {
    try {
      if (await Linking.canOpenURL(url)) await Linking.openURL(url);
      else Alert.alert("Lien invalide", url);
    } catch {
      Alert.alert("Erreur", "Impossible d'ouvrir le lien.");
    }
  };

  const handleToggleVisible = async (d: PropertyDocument) => {
    await updateDoc(doc(db, "properties", propertyId, "documents", d.id), {
      visibleToTenant: !d.visibleToTenant,
    }).catch(() => Alert.alert("Erreur", "Impossible de modifier."));
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
                <Ionicons
                  name={PROPERTY_DOCUMENT_TYPE_ICONS[d.type] as any}
                  size={18}
                  color={d.visibleToTenant ? "#3B82F6" : COLORS.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={docSec.rowLabel} numberOfLines={1}>{d.label}</Text>
                <Text style={docSec.rowType}>{PROPERTY_DOCUMENT_TYPE_LABELS[d.type]}</Text>
              </View>
              <Ionicons name="open-outline" size={14} color={COLORS.textMuted} />
            </Pressable>

            <View style={docSec.rowActions}>
              <Pressable style={docSec.visibleBtn} onPress={() => handleToggleVisible(d)}>
                <Ionicons
                  name={d.visibleToTenant ? "eye" : "eye-off-outline"}
                  size={14}
                  color={d.visibleToTenant ? "#10B981" : COLORS.textMuted}
                />
                <Text style={[docSec.visibleText, d.visibleToTenant && { color: "#10B981" }]}>
                  {d.visibleToTenant ? "Visible locataire" : "Non visible"}
                </Text>
              </Pressable>
              <Pressable onPress={() => handleDelete(d.id, d.label)} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
              </Pressable>
            </View>
          </View>
        ))
      )}

      {showAdd && (
        <AddDocModal
          propertyId={propertyId}
          landlordId={landlordId}
          onClose={() => setShowAdd(false)}
        />
      )}
    </View>
  );
}

const addDoc_ = StyleSheet.create({
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 16,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 20 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    backgroundColor: "#FAFAFA", marginBottom: 14,
  },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: "#F8F8F8",
  },
  chipActive: { borderColor: COLORS.primary, backgroundColor: "#EEF2FF" },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  chipTextActive: { color: COLORS.primary },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, flex: 1 },
  toggle: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: "#E2E8F0",
    justifyContent: "center", paddingHorizontal: 3,
  },
  toggleOn: { backgroundColor: "#10B981" },
  toggleDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
  },
  toggleDotOn: { alignSelf: "flex-end" },
  btn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: "center",
  },
  btnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

const docSec = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: COLORS.primary, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  empty: { alignItems: "center", gap: 6, paddingVertical: 20 },
  emptyText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  emptyDesc: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  row: {
    backgroundColor: "#fff", borderRadius: 12,
    marginBottom: 8, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  icon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  rowType: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  rowActions: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingBottom: 10,
    borderTopWidth: 1, borderTopColor: "#F0F0F0", paddingTop: 8,
  },
  visibleBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  visibleText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
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
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: "rgba(139,92,246,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#8B5CF6" },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  email: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  dates: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  badge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});

// ─── Utilitaires date masquée ─────────────────────────────────────────────────

/**
 * Masque DD/MM/YYYY : insère les / automatiquement, bloque les caractères non numériques.
 * Retourne la valeur affichée (ex: "12/08/2026").
 */
function maskDate(raw: string, prev: string): string {
  // Suppression : laisser passer tel quel (on retire juste le dernier char)
  if (raw.length < prev.length) return raw;

  // Ne garder que les chiffres
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return "";

  let result = "";
  if (digits.length <= 2) {
    result = digits;
  } else if (digits.length <= 4) {
    result = digits.slice(0, 2) + "/" + digits.slice(2);
  } else {
    result = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4, 8);
  }
  return result;
}

/** Convertit DD/MM/YYYY → YYYY-MM-DD pour l'API (retourne "" si invalide/incomplet). */
function displayToISO(display: string): string {
  const parts = display.split("/");
  if (parts.length !== 3 || parts[2].length !== 4) return "";
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return "";
  return `${yyyy}-${mm}-${dd}`;
}

/** Convertit YYYY-MM-DD → DD/MM/YYYY pour l'affichage. */
function isoToDisplay(iso: string): string {
  if (!iso || iso.length < 10) return "";
  const [yyyy, mm, dd] = iso.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Modal invitation locataire ───────────────────────────────────────────────

interface InviteFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  leaseStartDate: string; // DD/MM/YYYY affiché
  leaseEndDate: string;   // DD/MM/YYYY affiché
}

function InviteModal({
  visible,
  propertyId,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  propertyId: string;
  onClose: () => void;
  onSuccess: (token: string, tenantName: string) => void;
}) {
  const [form, setForm] = useState<InviteFormData>({
    firstName: "", lastName: "", email: "",
    phone: "", leaseStartDate: "", leaseEndDate: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof InviteFormData) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  /** Handler spécial pour les champs de date avec masque */
  const setDate = (k: "leaseStartDate" | "leaseEndDate") => (raw: string) => {
    setForm((f) => ({ ...f, [k]: maskDate(raw, f[k]) }));
  };

  const canSubmit =
    form.firstName.trim() && form.lastName.trim() && form.email.trim();

  const handleInvite = useCallback(async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) throw new Error("Non authentifié");

      const startISO = displayToISO(form.leaseStartDate);
      const endISO   = displayToISO(form.leaseEndDate);

      const res = await apiRequest(
        "POST",
        "/api/rental/invite-tenant",
        {
          propertyId,
          firstName:      form.firstName.trim(),
          lastName:       form.lastName.trim(),
          email:          form.email.trim().toLowerCase(),
          phone:          form.phone.trim() || undefined,
          leaseStartDate: startISO || undefined,
          leaseEndDate:   endISO   || undefined,
        },
        { Authorization: `Bearer ${token}` }
      );

      const data = await res.json();
      const tenantName = `${form.firstName.trim()} ${form.lastName.trim()}`;
      onSuccess(data.token as string, tenantName);
      setForm({ firstName: "", lastName: "", email: "", phone: "", leaseStartDate: "", leaseEndDate: "" });
      onClose();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message ?? "Impossible d'envoyer l'invitation. Réessayez.");
    } finally {
      setSaving(false);
    }
  }, [form, propertyId, onSuccess, canSubmit]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#fff" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={invS.header}>
          <Text style={invS.title}>Inviter un locataire</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={invS.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={invS.section}>Identité</Text>

          <View style={invS.row}>
            <View style={{ flex: 1 }}>
              <Text style={invS.label}>Prénom *</Text>
              <TextInput
                style={invS.input}
                placeholder="Léa"
                placeholderTextColor={COLORS.textMuted}
                value={form.firstName}
                onChangeText={set("firstName")}
                autoCorrect={false}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={invS.label}>Nom *</Text>
              <TextInput
                style={invS.input}
                placeholder="Dupont"
                placeholderTextColor={COLORS.textMuted}
                value={form.lastName}
                onChangeText={set("lastName")}
                autoCorrect={false}
              />
            </View>
          </View>

          <Text style={invS.label}>Email *</Text>
          <TextInput
            style={invS.input}
            placeholder="lea.dupont@email.com"
            placeholderTextColor={COLORS.textMuted}
            value={form.email}
            onChangeText={set("email")}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={invS.label}>
            Téléphone <Text style={invS.optional}>(opt.)</Text>
          </Text>
          <TextInput
            style={invS.input}
            placeholder="06 12 34 56 78"
            placeholderTextColor={COLORS.textMuted}
            value={form.phone}
            onChangeText={set("phone")}
            keyboardType="phone-pad"
          />

          <Text style={[invS.section, { marginTop: 16 }]}>Bail</Text>

          <View style={invS.row}>
            <View style={{ flex: 1 }}>
              <Text style={invS.label}>
                Début <Text style={invS.optional}>(opt.)</Text>
              </Text>
              <TextInput
                style={invS.input}
                placeholder="JJ/MM/AAAA"
                placeholderTextColor={COLORS.textMuted}
                value={form.leaseStartDate}
                onChangeText={setDate("leaseStartDate")}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={invS.label}>
                Fin <Text style={invS.optional}>(opt.)</Text>
              </Text>
              <TextInput
                style={invS.input}
                placeholder="JJ/MM/AAAA"
                placeholderTextColor={COLORS.textMuted}
                value={form.leaseEndDate}
                onChangeText={setDate("leaseEndDate")}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
          </View>

          <Text style={invS.hint}>
            Un email avec un code d'accès à 6 chiffres sera envoyé au locataire.
          </Text>

          <View style={invS.actions}>
            <Pressable style={invS.cancelBtn} onPress={onClose}>
              <Text style={invS.cancelText}>Annuler</Text>
            </Pressable>
            <Pressable
              style={[invS.sendBtn, (!canSubmit || saving) && invS.sendBtnDisabled]}
              onPress={handleInvite}
              disabled={!canSubmit || saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <>
                    <Ionicons name="paper-plane" size={16} color="#fff" />
                    <Text style={invS.sendText}>Envoyer l'invitation</Text>
                  </>
              }
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const invS = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  content: { padding: 20, gap: 4 },
  section: {
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary, marginBottom: 8, letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, marginBottom: 6, marginTop: 10 },
  optional: { fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  row: { flexDirection: "row", gap: 12 },
  input: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: "Inter_400Regular", color: COLORS.text,
  },
  hint: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, marginTop: 16, lineHeight: 17,
  },
  actions: { flexDirection: "row", gap: 12, marginTop: 24 },
  cancelBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    borderRadius: 12, paddingVertical: 14, backgroundColor: COLORS.surfaceAlt,
  },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  sendBtn: {
    flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 12, paddingVertical: 14, backgroundColor: "#8B5CF6",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

// ─── Modal token généré ───────────────────────────────────────────────────────

function TokenModal({
  visible,
  token,
  tenantName,
  onClose,
}: {
  visible: boolean;
  token: string;
  tenantName: string;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={tokS.overlay}>
        <View style={tokS.card}>
          <View style={tokS.iconWrap}>
            <Ionicons name="checkmark-circle" size={48} color="#10B981" />
          </View>
          <Text style={tokS.title}>Invitation envoyée !</Text>
          <Text style={tokS.subtitle}>
            Un email a été envoyé à {tenantName}.{"\n"}
            Le code ci-dessous est valable 30 jours.
          </Text>
          <View style={tokS.tokenBox}>
            <Text style={tokS.tokenLabel}>Code d'accès</Text>
            <Text style={tokS.token}>{token}</Text>
          </View>
          <Text style={tokS.note}>
            Notez ce code — il ne sera plus affiché après fermeture.
          </Text>
          <Pressable style={tokS.closeBtn} onPress={onClose}>
            <Text style={tokS.closeText}>Fermer</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const tokS = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  card: {
    backgroundColor: "#fff", borderRadius: 24, padding: 28,
    width: "100%", maxWidth: 360, alignItems: "center", gap: 12,
  },
  iconWrap: { marginBottom: 4 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 20,
  },
  tokenBox: {
    backgroundColor: "rgba(139,92,246,0.07)",
    borderRadius: 14, paddingHorizontal: 24, paddingVertical: 16,
    alignItems: "center", width: "100%",
    borderWidth: 2, borderColor: "rgba(139,92,246,0.2)", marginVertical: 4,
  },
  tokenLabel: {
    fontSize: 11, fontFamily: "Inter_600SemiBold",
    color: "#8B5CF6", letterSpacing: 1, textTransform: "uppercase",
  },
  token: {
    fontSize: 34, fontFamily: "Inter_700Bold",
    color: "#8B5CF6", letterSpacing: 8, marginTop: 6,
  },
  note: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center",
  },
  closeBtn: {
    marginTop: 8, backgroundColor: "#8B5CF6",
    borderRadius: 12, paddingHorizontal: 32, paddingVertical: 13, width: "100%",
    alignItems: "center",
  },
  closeText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});

// ─── Écran principal ──────────────────────────────────────────────────────────

export default function PropertyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [property, setProperty]     = useState<RentalProperty | null>(null);
  const [tenants, setTenants]       = useState<PropertyTenant[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [tokenModal, setTokenModal] = useState<{ visible: boolean; token: string; name: string }>({
    visible: false, token: "", name: "",
  });

  // Chargement du logement
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "properties", id), (snap) => {
      if (snap.exists()) {
        setProperty({ id: snap.id, ...snap.data() } as RentalProperty);
      }
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [id]);

  // Chargement des locataires en temps réel
  useEffect(() => {
    if (!id) return;
    const q = query(
      collection(db, "properties", id, "tenants"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setTenants(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PropertyTenant)));
    });
    return unsub;
  }, [id]);

  const activeTenants  = tenants.filter((t) => t.status === "active" || t.status === "invited");
  const pastTenants    = tenants.filter((t) => t.status === "departed");

  const handleInviteSuccess = useCallback((token: string, name: string) => {
    setShowInvite(false);
    setTokenModal({ visible: true, token, name });
  }, []);

  const paddingTop = Platform.OS === "web" ? 67 + 16 : insets.top + 8;

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color="#8B5CF6" size="large" />
      </View>
    );
  }

  if (!property) {
    return (
      <View style={[s.root, s.center]}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.textMuted} />
        <Text style={s.notFoundText}>Logement introuvable</Text>
        <Pressable style={s.backBtnAlt} onPress={() => router.back()}>
          <Text style={s.backBtnAltText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const typeIcon = PROPERTY_TYPE_ICONS[property.propertyType] as any;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {property.address}
            {property.apartmentNumber ? ` — Apt ${property.apartmentNumber}` : ""}
          </Text>
          <Text style={s.headerSub}>
            {property.postalCode} {property.city}
          </Text>
        </View>
        <StatusBadge status={property.status} />
      </View>

      <ScrollView
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Infos logement */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Informations</Text>
          <View style={s.infoCard}>
            <View style={s.infoRow}>
              <View style={s.infoIconBox}>
                <Ionicons name={typeIcon} size={18} color="#8B5CF6" />
              </View>
              <Text style={s.infoLabel}>Type</Text>
              <Text style={s.infoValue}>{PROPERTY_TYPE_LABELS[property.propertyType]}</Text>
            </View>
            {!!property.surface && (
              <View style={[s.infoRow, s.infoRowDivider]}>
                <View style={s.infoIconBox}>
                  <Ionicons name="resize-outline" size={18} color="#8B5CF6" />
                </View>
                <Text style={s.infoLabel}>Surface</Text>
                <Text style={s.infoValue}>{property.surface} m²</Text>
              </View>
            )}
            {!!property.numberOfRooms && (
              <View style={[s.infoRow, s.infoRowDivider]}>
                <View style={s.infoIconBox}>
                  <Ionicons name="grid-outline" size={18} color="#8B5CF6" />
                </View>
                <Text style={s.infoLabel}>Pièces</Text>
                <Text style={s.infoValue}>{property.numberOfRooms}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Locataires actifs / en attente */}
        <View style={s.section}>
          <View style={s.sectionRow}>
            <Text style={s.sectionTitle}>
              Locataire{activeTenants.length > 1 ? "s" : ""}
              {activeTenants.length > 0 ? ` (${activeTenants.length})` : ""}
            </Text>
            <Pressable
              style={s.inviteBtn}
              onPress={() => setShowInvite(true)}
            >
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

        {/* Anciens locataires */}
        {pastTenants.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Historique locataires</Text>
            {pastTenants.map((t) => <TenantRow key={t.id} tenant={t} />)}
          </View>
        )}

        {/* Documents */}
        <View style={s.section}>
          <DocumentsSection
            propertyId={id ?? ""}
            landlordId={user?.uid ?? ""}
          />
        </View>
      </ScrollView>

      {/* Modals */}
      <InviteModal
        visible={showInvite}
        propertyId={id ?? ""}
        onClose={() => setShowInvite(false)}
        onSuccess={handleInviteSuccess}
      />
      <TokenModal
        visible={tokenModal.visible}
        token={tokenModal.token}
        tenantName={tokenModal.name}
        onClose={() => setTokenModal((p) => ({ ...p, visible: false }))}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text,
  },
  headerSub: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1,
  },

  scroll: { padding: 16, gap: 4 },

  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary, marginBottom: 10,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  sectionRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 10,
  },
  inviteBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#8B5CF6", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  inviteBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  infoCard: {
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 14,
  },
  infoRowDivider: {
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  infoIconBox: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: "rgba(139,92,246,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  infoLabel: {
    flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text,
  },

  empty: {
    alignItems: "center", gap: 8, paddingVertical: 24,
    backgroundColor: "#fff", borderRadius: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  emptyInviteBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4,
    borderWidth: 1, borderColor: "#8B5CF6", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  emptyInviteText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  phaseCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  phaseText: {
    flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, lineHeight: 18,
  },

  notFoundText: { fontSize: 16, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  backBtnAlt: {
    marginTop: 8, backgroundColor: COLORS.surfaceAlt,
    borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10,
  },
  backBtnAltText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
});
