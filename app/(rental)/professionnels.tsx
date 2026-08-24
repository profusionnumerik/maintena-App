/**
 * Annuaire des professionnels — côté bailleur.
 * Stocké dans Firestore : users/{uid}/providerContacts
 */
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { wa, wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc, collection, deleteDoc, doc,
  onSnapshot, orderBy, query, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { HamburgerButton } from "@/components/rental/RentalDrawer";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProviderContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  specialty: string;
  createdAt: string;
}

const EMPTY_FORM = { firstName: "", lastName: "", email: "", phone: "", company: "", specialty: "" };

function safeHaptic(style = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS !== "web") Haptics.impactAsync(style);
}

// ─── Écran ────────────────────────────────────────────────────────────────────

export default function RentalProfessionnels() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [contacts, setContacts]     = useState<ProviderContact[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [modalVisible, setModal]    = useState(false);
  const [editing, setEditing]       = useState<ProviderContact | null>(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [errors, setErrors]         = useState<Partial<typeof EMPTY_FORM>>({});

  const paddingTop = Platform.OS === "web" ? 67 : insets.top;

  // ── Firestore listener ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const q = query(
      collection(db, "users", user.uid, "providerContacts"),
      orderBy("lastName", "asc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setContacts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProviderContact)));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [user?.uid]);

  // ── Filtrage ───────────────────────────────────────────────────────────────
  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.firstName.toLowerCase().includes(q) ||
      c.lastName.toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q) ||
      (c.specialty ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").includes(q)
    );
  });

  // ── CRUD ───────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null); setForm(EMPTY_FORM); setErrors({}); setModal(true);
  };

  const openEdit = (c: ProviderContact) => {
    setEditing(c);
    setForm({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, company: c.company, specialty: c.specialty ?? "" });
    setErrors({});
    setModal(true);
  };

  const validate = (): boolean => {
    const e: Partial<typeof EMPTY_FORM> = {};
    if (!form.firstName.trim()) e.firstName = "Prénom requis";
    if (!form.lastName.trim())  e.lastName  = "Nom requis";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = useCallback(async () => {
    if (!validate() || !user?.uid) return;
    setSaving(true);
    try {
      const data = {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        email:     form.email.trim().toLowerCase(),
        phone:     form.phone.trim(),
        company:   form.company.trim(),
        specialty: form.specialty.trim(),
      };
      if (editing) {
        await updateDoc(doc(db, "users", user.uid, "providerContacts", editing.id), data);
      } else {
        await addDoc(collection(db, "users", user.uid, "providerContacts"), {
          ...data, createdAt: new Date().toISOString(),
        });
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModal(false);
    } catch {
      wa("Erreur", "Impossible d'enregistrer le contact.");
    } finally {
      setSaving(false);
    }
  }, [form, editing, user?.uid]);

  const handleDelete = (c: ProviderContact) => {
    if (!user?.uid) return;
    safeHaptic();
    wConfirm(
      "Supprimer ce contact ?",
      `${c.firstName} ${c.lastName} sera retiré de votre carnet.`,
      async () => {
        try {
          await deleteDoc(doc(db, "users", user.uid!, "providerContacts", c.id));
        } catch {
          wa("Erreur", "Impossible de supprimer ce contact.");
        }
      },
      "Supprimer",
    );
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <View style={[s.root, { paddingTop }]}>
      {/* Header */}
      <View style={s.header}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 4 }}>
          <Text style={s.title}>Professionnels</Text>
          <Text style={s.subtitle}>Votre carnet d'artisans et prestataires</Text>
        </View>
        <Pressable style={s.addBtn} onPress={() => { safeHaptic(); openAdd(); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Recherche */}
      <View style={s.searchWrap}>
        <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
        <TextInput
          style={s.searchInput}
          placeholder="Nom, métier, entreprise…"
          placeholderTextColor={COLORS.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Liste */}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 48 }} color={COLORS.primary} />
      ) : (
        <ScrollView contentContainerStyle={s.list}>
          {filtered.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="people-outline" size={36} color={COLORS.primary} />
              </View>
              <Text style={s.emptyTitle}>{search ? "Aucun résultat" : "Carnet vide"}</Text>
              <Text style={s.emptyDesc}>
                {search
                  ? "Aucun professionnel ne correspond à votre recherche."
                  : "Enregistrez vos artisans de confiance —\nplombiers, électriciens, chauffagistes…"}
              </Text>
              {!search && (
                <Pressable style={s.emptyAddBtn} onPress={openAdd}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={s.emptyAddText}>Ajouter un professionnel</Text>
                </Pressable>
              )}
            </View>
          ) : (
            filtered.map((c) => (
              <Pressable key={c.id} style={s.card} onPress={() => openEdit(c)}>
                <View style={s.cardAvatar}>
                  <Text style={s.cardAvatarText}>
                    {(c.firstName[0] ?? "").toUpperCase() + (c.lastName[0] ?? "").toUpperCase()}
                  </Text>
                </View>
                <View style={s.cardInfo}>
                  <Text style={s.cardName}>{c.firstName} {c.lastName}</Text>
                  {!!(c.specialty || c.company) && (
                    <Text style={s.cardSpec} numberOfLines={1}>
                      {[c.specialty, c.company].filter(Boolean).join(" · ")}
                    </Text>
                  )}
                  <View style={s.cardMeta}>
                    {!!c.phone && (
                      <View style={s.metaItem}>
                        <Ionicons name="call-outline" size={12} color={COLORS.textMuted} />
                        <Text style={s.metaText}>{c.phone}</Text>
                      </View>
                    )}
                    {!!c.email && (
                      <View style={s.metaItem}>
                        <Ionicons name="mail-outline" size={12} color={COLORS.textMuted} />
                        <Text style={s.metaText} numberOfLines={1}>{c.email}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Pressable style={s.deleteBtn} onPress={() => handleDelete(c)}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </Pressable>
              </Pressable>
            ))
          )}
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      )}

      {/* Modal ajout / modification */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[s.modal, { paddingTop: insets.top + 16 }]}>
          <View style={s.modalHeader}>
            <Pressable onPress={() => setModal(false)}>
              <Text style={s.modalCancel}>Annuler</Text>
            </Pressable>
            <Text style={s.modalTitle}>{editing ? "Modifier le contact" : "Nouveau contact"}</Text>
            <Pressable onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={s.modalSave}>Enregistrer</Text>}
            </Pressable>
          </View>

          <ScrollView style={s.modalBody} keyboardShouldPersistTaps="handled">
            <Field label="Prénom *" error={errors.firstName}>
              <TextInput
                style={[s.input, !!errors.firstName && s.inputError]}
                value={form.firstName}
                onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
                placeholder="Jean"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Nom *" error={errors.lastName}>
              <TextInput
                style={[s.input, !!errors.lastName && s.inputError]}
                value={form.lastName}
                onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
                placeholder="Dupont"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Spécialité / Métier">
              <TextInput
                style={s.input}
                value={form.specialty}
                onChangeText={(v) => setForm((f) => ({ ...f, specialty: v }))}
                placeholder="Plombier, Électricien, Chauffagiste…"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Entreprise / Société">
              <TextInput
                style={s.input}
                value={form.company}
                onChangeText={(v) => setForm((f) => ({ ...f, company: v }))}
                placeholder="SARL Dupont Plomberie…"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Téléphone">
              <TextInput
                style={s.input}
                value={form.phone}
                onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                placeholder="06 12 34 56 78"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="phone-pad"
              />
            </Field>
            <Field label="Email">
              <TextInput
                style={s.input}
                value={form.email}
                onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                placeholder="jean.dupont@exemple.fr"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </Field>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

// ─── Champ formulaire ─────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
      {!!error && <Text style={s.fieldError}>{error}</Text>}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title:    { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  addBtn:   { backgroundColor: COLORS.primary, borderRadius: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center" },

  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", margin: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },

  list: { paddingHorizontal: 12, paddingTop: 4 },

  empty: { alignItems: "center", paddingTop: 64, gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: COLORS.primary + "12", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  emptyDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, textAlign: "center", lineHeight: 22 },
  emptyAddBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyAddText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },

  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#fff", borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary + "18", alignItems: "center", justifyContent: "center", marginRight: 12 },
  cardAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.primary },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  cardSpec: { fontSize: 12, color: COLORS.primary, fontFamily: "Inter_500Medium", marginTop: 1 },
  cardMeta: { flexDirection: "row", gap: 12, marginTop: 4, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  metaText: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  deleteBtn: { padding: 8 },

  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalCancel: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  modalTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  modalSave:   { fontSize: 15, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  modalBody: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },

  field:      { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, marginBottom: 6 },
  fieldError: { fontSize: 12, color: COLORS.danger, fontFamily: "Inter_400Regular", marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
    fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#fff",
  },
  inputError: { borderColor: COLORS.danger },
});
