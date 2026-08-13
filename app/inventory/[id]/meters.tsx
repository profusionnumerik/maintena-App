/**
 * app/inventory/[id]/meters.tsx
 * Relevés de compteurs : eau froide, eau chaude, gaz, électricité.
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
  MeterReading, MeterType,
  METER_TYPE_LABELS, METER_TYPE_UNITS,
} from "@/shared/types";
import { v4 as randomUUID } from "uuid";

const METER_ICONS: Record<MeterType, string> = {
  electricity: "flash-outline",
  gas:         "flame-outline",
  water_cold:  "water-outline",
  water_hot:   "thermometer-outline",
  other:       "speedometer-outline",
};

const METER_COLORS: Record<MeterType, string> = {
  electricity: "#F59E0B",
  gas:         "#EF4444",
  water_cold:  "#3B82F6",
  water_hot:   "#F97316",
  other:       "#8B5CF6",
};

const ALL_TYPES: MeterType[] = ["electricity", "water_cold", "water_hot", "gas", "other"];

export default function MetersScreen() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const router              = useRouter();
  const insets              = useSafeAreaInsets();

  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [dirty, setDirty]       = useState(false);

  const [showAdd, setShowAdd]       = useState(false);
  const [addType, setAddType]       = useState<MeterType>("electricity");
  const [addNumber, setAddNumber]   = useState("");
  const [addIndex, setAddIndex]     = useState("");
  const [addComment, setAddComment] = useState("");

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  useEffect(() => {
    if (!id || !propertyId) return;
    return onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id),
      (snap) => {
        if (snap.exists()) {
          setReadings(snap.data().meterReadings ?? []);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id, propertyId]);

  const save = useCallback(async (newReadings?: MeterReading[]) => {
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id),
        { meterReadings: newReadings ?? readings, updatedAt: new Date().toISOString() }
      );
      setDirty(false);
    } catch {
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  }, [readings, propertyId, id]);

  const updateReading = (readingId: string, patch: Partial<MeterReading>) => {
    const updated = readings.map((r) => r.id === readingId ? { ...r, ...patch } : r);
    setReadings(updated);
    setDirty(true);
  };

  const addReading = async () => {
    if (!addIndex.trim()) return;
    const newR: MeterReading = {
      id:      randomUUID(),
      type:    addType,
      number:  addNumber.trim() || undefined,
      index:   addIndex.trim(),
      unit:    METER_TYPE_UNITS?.[addType] ?? "",
      date:    new Date().toISOString().slice(0, 10),
      comment: addComment.trim() || undefined,
    };
    const updated = [...readings, newR];
    setReadings(updated);
    setShowAdd(false);
    setAddNumber(""); setAddIndex(""); setAddComment("");
    await save(updated);
  };

  const removeReading = (rid: string) => {
    Alert.alert("Supprimer ce compteur ?", "", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer", style: "destructive",
        onPress: async () => {
          const updated = readings.filter((r) => r.id !== rid);
          setReadings(updated);
          await save(updated);
        },
      },
    ]);
  };

  return (
    <View style={s.root}>
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={s.headerTitle}>Compteurs</Text>
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
            {readings.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="speedometer-outline" size={48} color={COLORS.textMuted} style={{ opacity: 0.3 }} />
                <Text style={s.emptyTitle}>Aucun compteur</Text>
                <Text style={s.emptyDesc}>Ajoutez les relevés de compteurs du logement.</Text>
                <Pressable style={s.emptyBtn} onPress={() => setShowAdd(true)}>
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={s.emptyBtnText}>Ajouter un compteur</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.list}>
                {readings.map((r, idx) => (
                  <MeterCard
                    key={r.id}
                    reading={r}
                    isLast={idx === readings.length - 1}
                    onChange={(patch) => updateReading(r.id, patch)}
                    onRemove={() => removeReading(r.id)}
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
            <Text style={s.sheetTitle}>Ajouter un compteur</Text>

            <Text style={s.fieldLabel}>Type de compteur</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {ALL_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    style={[s.typeChip, addType === t && { borderColor: METER_COLORS[t], backgroundColor: METER_COLORS[t] + "14" }]}
                    onPress={() => setAddType(t)}
                  >
                    <Ionicons name={METER_ICONS[t] as any} size={14} color={addType === t ? METER_COLORS[t] : COLORS.textMuted} />
                    <Text style={[s.typeChipText, addType === t && { color: METER_COLORS[t] }]}>
                      {METER_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={s.fieldLabel}>Numéro de compteur (optionnel)</Text>
            <TextInput
              style={s.input}
              placeholder="Ex : 123456789"
              placeholderTextColor={COLORS.textMuted}
              value={addNumber}
              onChangeText={setAddNumber}
              keyboardType="default"
            />

            <Text style={s.fieldLabel}>Relevé (index) *</Text>
            <TextInput
              style={s.input}
              placeholder="Ex : 00123.45"
              placeholderTextColor={COLORS.textMuted}
              value={addIndex}
              onChangeText={setAddIndex}
              keyboardType="decimal-pad"
            />

            <Text style={s.fieldLabel}>Commentaire (optionnel)</Text>
            <TextInput
              style={[s.input, { minHeight: 60 }]}
              placeholder="Ex : Compteur commun, diviseur 3"
              placeholderTextColor={COLORS.textMuted}
              value={addComment}
              onChangeText={setAddComment}
              multiline
            />

            <Pressable
              style={[s.confirmBtn, !addIndex.trim() && s.confirmBtnDis]}
              onPress={addReading}
              disabled={!addIndex.trim()}
            >
              <Text style={s.confirmBtnText}>Ajouter</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Carte compteur ───────────────────────────────────────────────────────────
function MeterCard({
  reading, isLast, onChange, onRemove,
}: {
  reading: MeterReading;
  isLast: boolean;
  onChange: (p: Partial<MeterReading>) => void;
  onRemove: () => void;
}) {
  const color = METER_COLORS[reading.type];
  const icon  = METER_ICONS[reading.type] as any;
  return (
    <View style={[mc.row, !isLast && mc.rowBorder]}>
      <View style={[mc.icon, { backgroundColor: color + "14" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View style={mc.body}>
        <Text style={mc.type}>{METER_TYPE_LABELS[reading.type]}</Text>
        {reading.number ? <Text style={mc.number}>N° {reading.number}</Text> : null}
        <View style={mc.indexRow}>
          <TextInput
            style={mc.indexInput}
            value={reading.index}
            onChangeText={(t) => onChange({ index: t })}
            keyboardType="decimal-pad"
            placeholder="Index"
            placeholderTextColor={COLORS.textMuted}
          />
          <Text style={mc.unit}>{reading.unit}</Text>
        </View>
        {reading.comment ? <Text style={mc.comment}>{reading.comment}</Text> : null}
      </View>
      <Pressable onPress={onRemove} hitSlop={10}>
        <Ionicons name="trash-outline" size={18} color="#EF4444" />
      </Pressable>
    </View>
  );
}

const mc = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 12 },
  rowBorder:  { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  icon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  body:      { flex: 1 },
  type:      { fontSize: 14, fontFamily: "Inter_700Bold", color: COLORS.text },
  number:    { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  indexRow:  { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  indexInput:{
    flex: 1, backgroundColor: COLORS.surfaceAlt, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border,
  },
  unit:    { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  comment: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 4 },
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
  saveBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
  },
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
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  typeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  confirmBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 14, paddingVertical: 14,
    alignItems: "center", marginTop: 4,
  },
  confirmBtnDis:  { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
