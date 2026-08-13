/**
 * app/inventory/[id]/keys.tsx
 * Inventaire des clés et accès (clés, badges, télécommandes…).
 */
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import { KeyItem, KeyItemType } from "@/shared/types";
import { v4 as randomUUID } from "uuid";

const KEY_TYPE_LABELS: Record<KeyItemType, string> = {
  apartment:       "Clé appartement",
  mailbox:         "Clé boîte aux lettres",
  badge:           "Badge / Digicode",
  garage_remote:   "Télécommande garage",
  parking_badge:   "Badge parking",
  basement:        "Clé cave / sous-sol",
  other:           "Autre accès",
};

const KEY_TYPE_ICONS: Record<KeyItemType, string> = {
  apartment:       "key-outline",
  mailbox:         "mail-outline",
  badge:           "card-outline",
  garage_remote:   "car-outline",
  parking_badge:   "business-outline",
  basement:        "arrow-down-circle-outline",
  other:           "lock-open-outline",
};

const ALL_KEY_TYPES: KeyItemType[] = [
  "apartment", "mailbox", "badge", "garage_remote", "parking_badge", "basement", "other",
];

export default function KeysScreen() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const router              = useRouter();
  const insets              = useSafeAreaInsets();

  const [keys, setKeys]       = useState<KeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);

  const [showAdd, setShowAdd]         = useState(false);
  const [addType, setAddType]         = useState<KeyItemType>("apartment");
  const [addQty, setAddQty]           = useState("1");
  const [addDesc, setAddDesc]         = useState("");
  const [addObs, setAddObs]           = useState("");

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  useEffect(() => {
    if (!id || !propertyId) return;
    return onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id),
      (snap) => {
        if (snap.exists()) setKeys(snap.data().keyItems ?? []);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id, propertyId]);

  const save = useCallback(async (newKeys?: KeyItem[]) => {
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        { keyItems: newKeys ?? keys, updatedAt: new Date().toISOString() }
      );
      setDirty(false);
    } catch {
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  }, [keys, propertyId, id]);

  const addKey = async () => {
    const qty = parseInt(addQty, 10) || 1;
    const newKey: KeyItem = {
      id:          randomUUID(),
      type:        addType,
      quantity:    qty,
      description: addDesc.trim() || undefined,
      observation: addObs.trim() || undefined,
    };
    const updated = [...keys, newKey];
    setKeys(updated);
    setShowAdd(false);
    setAddDesc(""); setAddObs(""); setAddQty("1");
    await save(updated);
  };

  const updateKey = (keyId: string, patch: Partial<KeyItem>) => {
    const updated = keys.map((k) => k.id === keyId ? { ...k, ...patch } : k);
    setKeys(updated);
    setDirty(true);
  };

  const removeKey = (keyId: string) => {
    Alert.alert("Supprimer cet accès ?", "", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          const updated = keys.filter((k) => k.id !== keyId);
          setKeys(updated);
          await save(updated);
        },
      },
    ]);
  };

  const totalKeys = keys.reduce((sum, k) => sum + k.quantity, 0);

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <View style={s.headerInfo}>
          <Text style={s.headerTitle}>Clés & accès</Text>
          <Text style={s.headerSub}>{totalKeys} accès au total</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {saving && <ActivityIndicator size="small" color="#8B5CF6" />}
          {dirty && !saving && (
            <Pressable style={s.saveBtn} onPress={() => save()}>
              <Text style={s.saveBtnText}>Sauvegarder</Text>
            </Pressable>
          )}
          <Pressable style={s.addBtn} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#8B5CF6" size="large" /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {keys.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="key-outline" size={48} color={COLORS.textMuted} style={{ opacity: 0.3 }} />
                <Text style={s.emptyTitle}>Aucun accès renseigné</Text>
                <Text style={s.emptyDesc}>Ajoutez les clés, badges et télécommandes remis au locataire.</Text>
                <Pressable style={s.emptyBtn} onPress={() => setShowAdd(true)}>
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={s.emptyBtnText}>Ajouter un accès</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.list}>
                {keys.map((k, idx) => (
                  <KeyRow
                    key={k.id}
                    item={k}
                    isLast={idx === keys.length - 1}
                    onChange={(patch) => updateKey(k.id, patch)}
                    onRemove={() => removeKey(k.id)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Modal ajout */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={s.overlay} onPress={() => setShowAdd(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Ajouter un accès</Text>

            <Text style={s.fieldLabel}>Type</Text>
            <View style={s.typeGrid}>
              {ALL_KEY_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[s.typeChip, addType === t && s.typeChipActive]}
                  onPress={() => setAddType(t)}
                >
                  <Ionicons
                    name={KEY_TYPE_ICONS[t] as any}
                    size={14}
                    color={addType === t ? "#8B5CF6" : COLORS.textMuted}
                  />
                  <Text style={[s.typeChipText, addType === t && s.typeChipTextActive]}>
                    {KEY_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 12 }]}>Quantité</Text>
            <TextInput
              style={s.input}
              value={addQty}
              onChangeText={setAddQty}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor={COLORS.textMuted}
            />

            <Text style={s.fieldLabel}>Description (optionnel)</Text>
            <TextInput
              style={s.input}
              placeholder="Ex : Clé porte palière"
              placeholderTextColor={COLORS.textMuted}
              value={addDesc}
              onChangeText={setAddDesc}
            />

            <Text style={s.fieldLabel}>Observation (optionnel)</Text>
            <TextInput
              style={[s.input, { minHeight: 50 }]}
              placeholder="Ex : Légèrement usée"
              placeholderTextColor={COLORS.textMuted}
              value={addObs}
              onChangeText={setAddObs}
              multiline
            />

            <Pressable style={s.confirmBtn} onPress={addKey}>
              <Text style={s.confirmBtnText}>Ajouter</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Ligne clé ────────────────────────────────────────────────────────────────
function KeyRow({
  item, isLast, onChange, onRemove,
}: {
  item: KeyItem;
  isLast: boolean;
  onChange: (p: Partial<KeyItem>) => void;
  onRemove: () => void;
}) {
  return (
    <View style={[kr.row, !isLast && kr.rowBorder]}>
      <View style={kr.icon}>
        <Ionicons name={KEY_TYPE_ICONS[item.type] as any} size={18} color="#8B5CF6" />
      </View>
      <View style={kr.body}>
        <Text style={kr.type}>{KEY_TYPE_LABELS[item.type]}</Text>
        {item.description ? <Text style={kr.desc}>{item.description}</Text> : null}
        {item.observation ? <Text style={kr.obs}>{item.observation}</Text> : null}
      </View>
      <View style={kr.qtyBox}>
        <Pressable
          onPress={() => onChange({ quantity: Math.max(1, item.quantity - 1) })}
          style={kr.qtyBtn}
        >
          <Ionicons name="remove" size={14} color={COLORS.textSecondary} />
        </Pressable>
        <Text style={kr.qty}>{item.quantity}</Text>
        <Pressable
          onPress={() => onChange({ quantity: item.quantity + 1 })}
          style={kr.qtyBtn}
        >
          <Ionicons name="add" size={14} color={COLORS.textSecondary} />
        </Pressable>
      </View>
      <Pressable onPress={onRemove} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color="#EF4444" />
      </Pressable>
    </View>
  );
}

const kr = StyleSheet.create({
  row:       { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  icon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: "rgba(139,92,246,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1 },
  type: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  desc: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  obs:  { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, fontStyle: "italic" },
  qtyBox: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 4,
  },
  qtyBtn: { width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  qty:    { fontSize: 15, fontFamily: "Inter_700Bold", color: COLORS.text, minWidth: 20, textAlign: "center" },
});

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center",
  },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub:   { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  addBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: "#8B5CF6",
    alignItems: "center", justifyContent: "center",
  },
  saveBtn: { backgroundColor: "#8B5CF6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  saveBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  scroll: { padding: 16 },
  list: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 80, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  emptyDesc:  { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, textAlign: "center" },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8,
    backgroundColor: "#8B5CF6", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12,
  },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 16,
  },
  sheetTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 16 },
  fieldLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6,
  },
  input: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12, padding: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 12,
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  typeChipActive: { borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)" },
  typeChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  typeChipTextActive: { color: "#8B5CF6", fontFamily: "Inter_700Bold" },
  confirmBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", marginTop: 4,
  },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
