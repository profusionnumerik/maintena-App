/**
 * app/inventory/[id]/equipment.tsx
 * Liste des équipements fournis avec le logement.
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
import {
  EquipmentItem, EquipmentCategory, ElementCondition,
  ELEMENT_CONDITION_LABELS, ELEMENT_CONDITION_COLORS,
} from "@/shared/types";
import { ConditionPicker } from "@/components/inventory/ConditionPicker";
import { v4 as randomUUID } from "uuid";

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  appliance: "Électroménager",
  heating:   "Chauffage",
  cooling:   "Climatisation / Ventilation",
  furniture: "Mobilier",
  lighting:  "Éclairage",
  detector:  "Détecteurs (fumée, CO…)",
  other:     "Autre",
};

const CATEGORY_ICONS: Record<EquipmentCategory, string> = {
  appliance: "cube-outline",
  heating:   "flame-outline",
  cooling:   "snow-outline",
  furniture: "bed-outline",
  lighting:  "bulb-outline",
  detector:  "warning-outline",
  other:     "construct-outline",
};

const ALL_CATS: EquipmentCategory[] = [
  "appliance", "heating", "cooling", "furniture", "lighting", "detector", "other",
];

export default function EquipmentScreen() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const router              = useRouter();
  const insets              = useSafeAreaInsets();

  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [dirty, setDirty]         = useState(false);

  const [showAdd, setShowAdd]       = useState(false);
  const [addName, setAddName]       = useState("");
  const [addCat, setAddCat]         = useState<EquipmentCategory>("appliance");
  const [addCond, setAddCond]       = useState<ElementCondition>("good");
  const [addSerial, setAddSerial]   = useState("");
  const [addObs, setAddObs]         = useState("");

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  useEffect(() => {
    if (!id || !propertyId) return;
    return onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id),
      (snap) => {
        if (snap.exists()) setEquipment(snap.data().equipment ?? []);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id, propertyId]);

  const save = useCallback(async (newEq?: EquipmentItem[]) => {
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        { equipment: newEq ?? equipment, updatedAt: new Date().toISOString() }
      );
      setDirty(false);
    } catch {
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  }, [equipment, propertyId, id]);

  const addItem = async () => {
    if (!addName.trim()) return;
    const newItem: EquipmentItem = {
      id:           randomUUID(),
      name:         addName.trim(),
      category:     addCat,
      condition:    addCond,
      serialNumber: addSerial.trim() || undefined,
      observation:  addObs.trim() || undefined,
    };
    const updated = [...equipment, newItem];
    setEquipment(updated);
    setShowAdd(false);
    setAddName(""); setAddSerial(""); setAddObs(""); setAddCond("good");
    await save(updated);
  };

  const updateItem = (itemId: string, patch: Partial<EquipmentItem>) => {
    const updated = equipment.map((e) => e.id === itemId ? { ...e, ...patch } : e);
    setEquipment(updated);
    setDirty(true);
  };

  const removeItem = (itemId: string) => {
    Alert.alert("Supprimer cet équipement ?", "", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          const updated = equipment.filter((e) => e.id !== itemId);
          setEquipment(updated);
          await save(updated);
        },
      },
    ]);
  };

  // Regroupement par catégorie
  const grouped = ALL_CATS.reduce<Record<EquipmentCategory, EquipmentItem[]>>(
    (acc, cat) => {
      acc[cat] = equipment.filter((e) => e.category === cat);
      return acc;
    },
    {} as any
  );

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={s.headerTitle}>Équipements ({equipment.length})</Text>
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
            {equipment.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="construct-outline" size={48} color={COLORS.textMuted} style={{ opacity: 0.3 }} />
                <Text style={s.emptyTitle}>Aucun équipement</Text>
                <Text style={s.emptyDesc}>
                  Ajoutez les équipements fournis avec le logement (électroménager, chauffage, mobilier…).
                </Text>
                <Pressable style={s.emptyBtn} onPress={() => setShowAdd(true)}>
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={s.emptyBtnText}>Ajouter un équipement</Text>
                </Pressable>
              </View>
            ) : (
              ALL_CATS.map((cat) => {
                if (grouped[cat].length === 0) return null;
                return (
                  <View key={cat} style={{ marginBottom: 16 }}>
                    <Text style={s.catLabel}>
                      {CATEGORY_LABELS[cat]} ({grouped[cat].length})
                    </Text>
                    <View style={s.list}>
                      {grouped[cat].map((item, idx) => (
                        <EquipRow
                          key={item.id}
                          item={item}
                          isLast={idx === grouped[cat].length - 1}
                          onChange={(patch) => updateItem(item.id, patch)}
                          onRemove={() => removeItem(item.id)}
                        />
                      ))}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Modal ajout */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={s.overlay} onPress={() => setShowAdd(false)}>
          <ScrollView style={s.sheet} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Ajouter un équipement</Text>

            <Text style={s.fieldLabel}>Nom *</Text>
            <TextInput
              style={s.input}
              placeholder="Ex : Lave-linge, Radiateur élec., Canapé…"
              placeholderTextColor={COLORS.textMuted}
              value={addName}
              onChangeText={setAddName}
              autoFocus
            />

            <Text style={s.fieldLabel}>Catégorie</Text>
            <View style={s.catGrid}>
              {ALL_CATS.map((c) => (
                <Pressable
                  key={c}
                  style={[s.catChip, addCat === c && s.catChipActive]}
                  onPress={() => setAddCat(c)}
                >
                  <Ionicons
                    name={CATEGORY_ICONS[c] as any}
                    size={13}
                    color={addCat === c ? "#8B5CF6" : COLORS.textMuted}
                  />
                  <Text style={[s.catChipText, addCat === c && s.catChipTextActive]}>
                    {CATEGORY_LABELS[c]}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.fieldLabel, { marginTop: 12 }]}>État</Text>
            <ConditionPicker
              value={addCond}
              onChange={setAddCond}
              compact
            />

            <Text style={[s.fieldLabel, { marginTop: 12 }]}>Numéro de série (optionnel)</Text>
            <TextInput
              style={s.input}
              placeholder="Ex : SN-123456"
              placeholderTextColor={COLORS.textMuted}
              value={addSerial}
              onChangeText={setAddSerial}
            />

            <Text style={s.fieldLabel}>Observation (optionnel)</Text>
            <TextInput
              style={[s.input, { minHeight: 60 }]}
              placeholder="État, remarques…"
              placeholderTextColor={COLORS.textMuted}
              value={addObs}
              onChangeText={setAddObs}
              multiline
            />

            <Pressable
              style={[s.confirmBtn, !addName.trim() && s.confirmBtnDis]}
              onPress={addItem}
              disabled={!addName.trim()}
            >
              <Text style={s.confirmBtnText}>Ajouter</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Ligne équipement ─────────────────────────────────────────────────────────
function EquipRow({
  item, isLast, onChange, onRemove,
}: {
  item: EquipmentItem;
  isLast: boolean;
  onChange: (p: Partial<EquipmentItem>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const condColor = ELEMENT_CONDITION_COLORS[item.condition];

  return (
    <View style={[er.container, !isLast && er.border]}>
      <Pressable style={er.row} onPress={() => setExpanded((e) => !e)}>
        <View style={[er.condDot, { backgroundColor: condColor }]} />
        <View style={er.info}>
          <Text style={er.name}>{item.name}</Text>
          {item.serialNumber ? (
            <Text style={er.serial}>N° {item.serialNumber}</Text>
          ) : null}
        </View>
        <Text style={[er.condLabel, { color: condColor }]}>
          {ELEMENT_CONDITION_LABELS[item.condition]}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={COLORS.textMuted}
        />
      </Pressable>

      {expanded && (
        <View style={er.body}>
          <ConditionPicker
            value={item.condition}
            onChange={(c) => onChange({ condition: c })}
            compact
          />
          {item.observation ? (
            <Text style={er.obs}>{item.observation}</Text>
          ) : null}
          <Pressable style={er.removeBtn} onPress={onRemove}>
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
            <Text style={er.removeBtnText}>Supprimer</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const er = StyleSheet.create({
  container: { backgroundColor: "#fff" },
  border:    { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  row: { flexDirection: "row", alignItems: "center", padding: 14, gap: 10 },
  condDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  info:    { flex: 1 },
  name:    { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  serial:  { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  condLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  body:    { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  obs:     { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  removeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 8,
  },
  removeBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
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
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  addBtn: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: "#8B5CF6",
    alignItems: "center", justifyContent: "center",
  },
  saveBtn: { backgroundColor: "#8B5CF6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  saveBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },

  scroll: { padding: 16 },
  catLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.7,
    marginBottom: 8,
  },
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
    maxHeight: "90%",
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
  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  catChipActive:    { borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)" },
  catChipText:      { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  catChipTextActive: { color: "#8B5CF6", fontFamily: "Inter_700Bold" },
  confirmBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", marginTop: 8,
  },
  confirmBtnDis:  { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
