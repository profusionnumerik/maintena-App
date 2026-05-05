import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { wa, wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  orderBy, query, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { useCoPro } from "@/context/CoProContext";
import { CoPro } from "@/shared/types";

interface ProviderContact {
  id: string;
  coProId: string;
  coProName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  createdAt: string;
}

const EMPTY_FORM = { firstName: "", lastName: "", email: "", phone: "", company: "" };

function safeHaptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export default function AnnuairePrestatairesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { currentCopro, copros } = useCoPro();

  const [contacts, setContacts] = useState<ProviderContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ProviderContact | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<typeof EMPTY_FORM>>({});

  // Subscribe to providerContacts across ALL admin copros
  const loadedCount = useRef(0);
  useEffect(() => {
    if (copros.length === 0) { setLoading(false); return; }

    const contactsMap: Record<string, ProviderContact[]> = {};
    loadedCount.current = 0;

    const unsubscribers = copros.map((copro) => {
      const q = query(
        collection(db, "copros", copro.id, "providerContacts"),
        orderBy("lastName", "asc")
      );
      return onSnapshot(q, (snap) => {
        contactsMap[copro.id] = snap.docs.map((d) => ({
          id: d.id,
          coProId: copro.id,
          coProName: copro.name,
          ...d.data(),
        } as ProviderContact));

        // Merge all copros' contacts sorted by lastName
        const all = Object.values(contactsMap).flat().sort((a, b) =>
          a.lastName.localeCompare(b.lastName, "fr")
        );
        setContacts(all);

        loadedCount.current += 1;
        if (loadedCount.current >= copros.length) setLoading(false);
      }, () => {
        loadedCount.current += 1;
        if (loadedCount.current >= copros.length) setLoading(false);
      });
    });

    return () => unsubscribers.forEach((u) => u());
  }, [copros.map((c) => c.id).join(",")]);

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.firstName.toLowerCase().includes(q) ||
      c.lastName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.coProName.toLowerCase().includes(q)
    );
  });

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setModalVisible(true);
  };

  const openEdit = (c: ProviderContact) => {
    setEditing(c);
    setForm({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, company: c.company });
    setErrors({});
    setModalVisible(true);
  };

  const validate = (): boolean => {
    const e: Partial<typeof EMPTY_FORM> = {};
    if (!form.firstName.trim()) e.firstName = "Prénom requis";
    if (!form.lastName.trim()) e.lastName = "Nom requis";
    if (!form.email.trim()) e.email = "Email requis";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email invalide";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    // When editing: write back to original copro. When adding: write to currentCopro.
    const targetCoProId = editing ? editing.coProId : currentCopro?.id;
    if (!targetCoProId) return;
    setSaving(true);
    try {
      const data = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        company: form.company.trim(),
      };
      if (editing) {
        await updateDoc(doc(db, "copros", targetCoProId, "providerContacts", editing.id), data);
      } else {
        await addDoc(collection(db, "copros", targetCoProId, "providerContacts"), {
          ...data,
          createdAt: new Date().toISOString(),
        });
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
    } catch {
      wa("Erreur", "Impossible d'enregistrer le contact.");
    } finally {
      setSaving(false);
    }
  }, [form, editing, currentCopro?.id]);

  const handleDelete = (c: ProviderContact) => {
    wConfirm(
      "Supprimer ce contact ?",
      `${c.firstName} ${c.lastName} sera retiré de l'annuaire.`,
      async () => {
        try {
          await deleteDoc(doc(db, "copros", c.coProId, "providerContacts", c.id));
        } catch {
          wa("Erreur", "Impossible de supprimer ce contact.");
        }
      },
      "Supprimer",
    );
  };

  const multiCopro = copros.length > 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.title}>Annuaire prestataires</Text>
        <Pressable style={styles.addBtn} onPress={() => { safeHaptic(); openAdd(); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={COLORS.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={multiCopro ? "Rechercher par nom, résidence…" : "Rechercher par nom, email…"}
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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={COLORS.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={40} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                {search ? "Aucun résultat" : "Aucun contact dans l'annuaire"}
              </Text>
              {!search && (
                <Pressable style={styles.emptyAddBtn} onPress={openAdd}>
                  <Text style={styles.emptyAddText}>Ajouter un prestataire</Text>
                </Pressable>
              )}
            </View>
          ) : (
            filtered.map((c) => (
              <Pressable key={`${c.coProId}-${c.id}`} style={styles.card} onPress={() => openEdit(c)}>
                <View style={styles.cardAvatar}>
                  <Text style={styles.cardAvatarText}>
                    {(c.firstName[0] ?? "") + (c.lastName[0] ?? "")}
                  </Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{c.firstName} {c.lastName}</Text>
                  {!!c.company && <Text style={styles.cardCompany}>{c.company}</Text>}
                  <View style={styles.cardMeta}>
                    {!!c.phone && (
                      <View style={styles.cardMetaItem}>
                        <Ionicons name="call-outline" size={12} color={COLORS.textMuted} />
                        <Text style={styles.cardMetaText}>{c.phone}</Text>
                      </View>
                    )}
                    {!!c.email && (
                      <View style={styles.cardMetaItem}>
                        <Ionicons name="mail-outline" size={12} color={COLORS.textMuted} />
                        <Text style={styles.cardMetaText} numberOfLines={1}>{c.email}</Text>
                      </View>
                    )}
                  </View>
                  {multiCopro && (
                    <View style={styles.coProBadge}>
                      <Ionicons name="business-outline" size={10} color={COLORS.primary} />
                      <Text style={styles.coProBadgeText} numberOfLines={1}>{c.coProName}</Text>
                    </View>
                  )}
                </View>
                <Pressable style={styles.deleteBtn} onPress={() => { safeHaptic(); handleDelete(c); }}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.danger} />
                </Pressable>
              </Pressable>
            ))
          )}
          <View style={{ height: insets.bottom + 24 }} />
        </ScrollView>
      )}

      {/* Add / Edit modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setModalVisible(false)}>
              <Text style={styles.modalCancel}>Annuler</Text>
            </Pressable>
            <Text style={styles.modalTitle}>{editing ? "Modifier le contact" : "Nouveau contact"}</Text>
            <Pressable onPress={handleSave} disabled={saving}>
              {saving
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Text style={styles.modalSave}>Enregistrer</Text>}
            </Pressable>
          </View>

          {/* Copro badge when editing */}
          {editing && multiCopro && (
            <View style={styles.editCoProRow}>
              <Ionicons name="business-outline" size={13} color={COLORS.primary} />
              <Text style={styles.editCoProText}>{editing.coProName}</Text>
            </View>
          )}
          {!editing && multiCopro && currentCopro && (
            <View style={styles.editCoProRow}>
              <Ionicons name="business-outline" size={13} color={COLORS.primary} />
              <Text style={styles.editCoProText}>Ajouté à : {currentCopro.name}</Text>
            </View>
          )}

          <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
            <Field label="Prénom *" error={errors.firstName}>
              <TextInput
                style={[styles.input, !!errors.firstName && styles.inputError]}
                value={form.firstName}
                onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
                placeholder="Jean"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Nom *" error={errors.lastName}>
              <TextInput
                style={[styles.input, !!errors.lastName && styles.inputError]}
                value={form.lastName}
                onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
                placeholder="Dupont"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <Field label="Email *" error={errors.email}>
              <TextInput
                style={[styles.input, !!errors.email && styles.inputError]}
                value={form.email}
                onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
                placeholder="jean.dupont@exemple.fr"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </Field>
            <Field label="Téléphone">
              <TextInput
                style={styles.input}
                value={form.phone}
                onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
                placeholder="06 12 34 56 78"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="phone-pad"
              />
            </Field>
            <Field label="Profession / Société">
              <TextInput
                style={styles.input}
                value={form.company}
                onChangeText={(v) => setForm((f) => ({ ...f, company: v }))}
                placeholder="Plombier, Électricien…"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="words"
              />
            </Field>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
    backgroundColor: "#fff",
  },
  backBtn: { padding: 4 },
  title: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  addBtn: {
    backgroundColor: COLORS.primary, borderRadius: 20, width: 36, height: 36,
    alignItems: "center", justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fff", margin: 12, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text },
  list: { paddingHorizontal: 12, paddingTop: 4 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  emptyAddBtn: {
    marginTop: 8, backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10,
  },
  emptyAddText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  card: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardAvatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary + "20",
    alignItems: "center", justifyContent: "center", marginRight: 12,
  },
  cardAvatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.primary },
  cardInfo: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  cardCompany: { fontSize: 12, color: COLORS.primary, fontFamily: "Inter_500Medium", marginTop: 1 },
  cardMeta: { flexDirection: "row", gap: 12, marginTop: 4, flexWrap: "wrap" },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  cardMetaText: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  coProBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5,
    backgroundColor: COLORS.primary + "10", paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, alignSelf: "flex-start",
  },
  coProBadgeText: { fontSize: 11, color: COLORS.primary, fontFamily: "Inter_500Medium" },
  deleteBtn: { padding: 8 },
  modal: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalCancel: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  modalSave: { fontSize: 15, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  editCoProRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 20, paddingVertical: 8, backgroundColor: COLORS.primary + "08",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  editCoProText: { fontSize: 13, color: COLORS.primary, fontFamily: "Inter_500Medium" },
  modalBody: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  field: { marginBottom: 16 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, marginBottom: 6 },
  fieldError: { fontSize: 12, color: COLORS.danger, fontFamily: "Inter_400Regular", marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
    fontFamily: "Inter_400Regular", color: COLORS.text, backgroundColor: "#fff",
  },
  inputError: { borderColor: COLORS.danger },
});
