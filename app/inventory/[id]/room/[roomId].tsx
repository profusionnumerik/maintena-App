/**
 * app/inventory/[id]/room/[roomId].tsx
 * Éditeur d'une pièce : items + état + observations + photos.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { COLORS } from "@/constants/colors";
import {
  InventoryRoom, RoomItem, ElementCondition, PhotoRecord,
  ELEMENT_CONDITION_LABELS, ELEMENT_CONDITION_COLORS,
  MAX_PHOTOS_PER_ROOM, MAX_PHOTOS_PER_ITEM,
} from "@/shared/types";
import { ConditionPicker } from "@/components/inventory/ConditionPicker";
import { PhotoStrip } from "@/components/inventory/PhotoStrip";
import { getSuggestions, getRoomSuggestions } from "@/lib/observationSuggestions";
import { v4 as randomUUID } from "uuid";

export default function RoomEditorScreen() {
  const { id, roomId, propertyId } =
    useLocalSearchParams<{ id: string; roomId: string; propertyId: string }>();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { user } = useAuth();

  const uid = user?.uid ?? "";
  const [plan, setPlan] = useState<import("@/shared/types").SubscriptionPlan | undefined>(undefined);

  // Lire le plan d'abonnement de l'utilisateur (une seule fois)
  useEffect(() => {
    if (!user?.uid) return;
    import("firebase/firestore").then(({ getDoc, doc: fsDoc }) =>
      getDoc(fsDoc(db, "users", user.uid)).then((snap) => {
        if (snap.exists()) setPlan(snap.data()?.subscription?.plan ?? undefined);
      }).catch(() => {})
    );
  }, [user?.uid]);

  const [room, setRoom]       = useState<InventoryRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  // État local pour l'édition
  const [items, setItems]               = useState<RoomItem[]>([]);
  const [roomPhotos, setRoomPhotos]     = useState<PhotoRecord[]>([]);
  const [observation, setObservation]   = useState("");
  const [generalCond, setGeneralCond]   = useState<ElementCondition>("not_checked");
  const [generalNote, setGeneralNote]   = useState("");
  const [showAddItem, setShowAddItem]   = useState(false);
  const [newItemName, setNewItemName]   = useState("");
  const [dirty, setDirty]               = useState(false);

  // Suggestions IA
  const [suggestions, setSuggestions]   = useState<string[]>([]);
  const [suggestTarget, setSuggestTarget] = useState<"room" | string>("room");
  const [showSuggest, setShowSuggest]   = useState(false);

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  // Écoute Firestore
  useEffect(() => {
    if (!id || !roomId || !propertyId) return;
    return onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id, "rooms", roomId),
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as InventoryRoom;
          setRoom(data);
          if (!dirty) {
            setItems(data.items ?? []);
            setRoomPhotos(data.photos ?? []);
            setObservation(data.observation ?? "");
            setGeneralCond(data.generalCondition ?? "not_checked");
            setGeneralNote("");
          }
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id, roomId, propertyId]);

  // Sauvegarder — strip undefined (Firestore refuse les champs undefined)
  const clean = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

  const save = useCallback(async (force = false) => {
    if (!dirty && !force) return;
    if (!propertyId || !id || !roomId) {
      Alert.alert("Erreur", "Identifiants manquants.");
      return;
    }
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "properties", propertyId, "inventoryReports", id, "rooms", roomId),
        {
          items:            clean(items),
          photos:           clean(roomPhotos),
          observation:      observation ?? "",
          generalCondition: generalCond ?? "not_checked",
          updatedAt:        new Date().toISOString(),
        }
      );
      setDirty(false);
    } catch (e) {
      console.error("[RoomEditor] save error", e);
      Alert.alert("Erreur", "Impossible de sauvegarder.");
    } finally {
      setSaving(false);
    }
  }, [dirty, items, roomPhotos, observation, generalCond, propertyId, id, roomId]);

  // Auto-save quand on quitte
  const handleBack = async () => {
    if (dirty) await save(true);
    router.back();
  };

  const updateItem = (itemId: string, patch: Partial<RoomItem>) => {
    setItems((prev) =>
      prev.map((it) => it.id === itemId ? { ...it, ...patch } : it)
    );
    setDirty(true);
  };

  const addItem = () => {
    const name = newItemName.trim();
    if (!name) return;
    const newItem: RoomItem = {
      id:        randomUUID(),
      name,
      condition: "not_checked",
      photos:    [],
    };
    setItems((prev) => [...prev, newItem]);
    setNewItemName("");
    setShowAddItem(false);
    setDirty(true);
  };

  // Ouvrir les suggestions IA
  const openSuggest = (target: "room" | string, condition: ElementCondition, name?: string) => {
    const list = target === "room"
      ? getRoomSuggestions(condition)
      : getSuggestions(name ?? "", condition);
    setSuggestions(list);
    setSuggestTarget(target);
    setShowSuggest(true);
  };

  // Appliquer une suggestion
  const applySuggestion = (text: string) => {
    if (suggestTarget === "room") {
      setObservation(text);
    } else {
      updateItem(suggestTarget, { observation: text });
    }
    setDirty(true);
    setShowSuggest(false);
  };

  const removeItem = (itemId: string) => {
    Alert.alert(
      "Supprimer l'élément ?",
      "Cette action est irréversible.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer", style: "destructive",
          onPress: () => {
            setItems((prev) => prev.filter((it) => it.id !== itemId));
            setDirty(true);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color="#8B5CF6" size="large" />
      </View>
    );
  }

  if (!room) {
    return (
      <View style={[s.root, s.center]}>
        <Text style={s.notFound}>Pièce introuvable</Text>
        <Pressable style={s.backBtnAlt} onPress={() => router.back()}>
          <Text style={s.backBtnAltText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  // Stats
  const checked = items.filter((i) => i.condition !== "not_checked").length;
  const total   = items.length;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={handleBack} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{room.name}</Text>
          <Text style={s.headerSub}>{checked}/{total} éléments vérifiés</Text>
        </View>
        {saving ? (
          <ActivityIndicator color="#8B5CF6" size="small" />
        ) : dirty ? (
          <Pressable style={s.saveBtn} onPress={() => save()}>
            <Text style={s.saveBtnText}>Sauvegarder</Text>
          </Pressable>
        ) : (
          <View style={s.savedBadge}>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={s.savedText}>Sauvegardé</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* État général de la pièce */}
          <Text style={s.sectionLabel}>État général de la pièce</Text>
          <View style={s.card}>
            <ConditionPicker
              value={generalCond}
              onChange={(c) => { setGeneralCond(c); setDirty(true); }}
              conditionNote={generalNote}
              onNoteChange={(n) => { setGeneralNote(n); setDirty(true); }}
            />
          </View>

          {/* Observation bailleur */}
          <View style={s.obsHeader}>
            <Text style={[s.sectionLabel, { marginTop: 16, marginBottom: 0 }]}>Observation globale</Text>
            <Pressable
              style={s.aiBtn}
              onPress={() => openSuggest("room", generalCond)}
            >
              <Text style={s.aiBtnIcon}>✨</Text>
              <Text style={s.aiBtnText}>Suggestion IA</Text>
            </Pressable>
          </View>
          <TextInput
            style={s.textarea}
            placeholder="Observation générale sur la pièce..."
            placeholderTextColor={COLORS.textMuted}
            value={observation}
            onChangeText={(t) => { setObservation(t); setDirty(true); }}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Photos de la pièce */}
          <View style={s.photosCard}>
            <Text style={s.photosLabel}>
              Photos de la pièce
              <Text style={s.photosHint}> (max {MAX_PHOTOS_PER_ROOM})</Text>
            </Text>
            <PhotoStrip
              photos={roomPhotos}
              maxPhotos={MAX_PHOTOS_PER_ROOM}
              target="room"
              propertyId={propertyId}
              reportId={id}
              uid={uid}
              plan={plan}
              onChange={(p) => { setRoomPhotos(p); setDirty(true); }}
            />
          </View>

          {/* Liste des éléments */}
          <View style={s.itemsHeader}>
            <Text style={s.sectionLabel}>Éléments ({total})</Text>
            <Pressable onPress={() => setShowAddItem(true)} style={s.addItemBtn}>
              <Ionicons name="add" size={15} color="#8B5CF6" />
              <Text style={s.addItemBtnText}>Ajouter</Text>
            </Pressable>
          </View>

          {items.map((item, idx) => (
            <ItemRow
              key={item.id}
              item={item}
              isLast={idx === items.length - 1}
              onChange={(patch) => updateItem(item.id, patch)}
              onRemove={() => removeItem(item.id)}
              onSuggest={() => openSuggest(item.id, item.condition, item.name)}
              uid={uid}
              plan={plan}
              propertyId={propertyId}
              reportId={id}
            />
          ))}

          {items.length === 0 && (
            <View style={s.emptyItems}>
              <Text style={s.emptyItemsText}>Aucun élément. Appuyez sur "Ajouter".</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal suggestions IA */}
      <Modal
        visible={showSuggest}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSuggest(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowSuggest(false)}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.modalHandle} />
            <View style={s.suggestHeader}>
              <Text style={s.modalTitle}>✨ Suggestions</Text>
              <Text style={s.suggestSub}>Appuyez pour insérer</Text>
            </View>
            {suggestions.map((sug, i) => (
              <Pressable
                key={i}
                style={({ pressed }) => [s.suggestItem, pressed && { opacity: 0.7 }]}
                onPress={() => applySuggestion(sug)}
              >
                <View style={s.suggestBullet}>
                  <Text style={s.suggestBulletText}>{i + 1}</Text>
                </View>
                <Text style={s.suggestText}>{sug}</Text>
                <Ionicons name="chevron-forward" size={14} color={COLORS.textMuted} />
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Modal ajout élément */}
      <Modal
        visible={showAddItem}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddItem(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowAddItem(false)}>
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Nouvel élément</Text>
            <TextInput
              style={s.addInput}
              placeholder="Nom de l'élément (ex: Radiateur)"
              placeholderTextColor={COLORS.textMuted}
              value={newItemName}
              onChangeText={setNewItemName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addItem}
            />
            <Pressable
              style={[s.confirmBtn, !newItemName.trim() && s.confirmBtnDis]}
              onPress={addItem}
              disabled={!newItemName.trim()}
            >
              <Text style={s.confirmBtnText}>Ajouter l'élément</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Ligne d'un élément ───────────────────────────────────────────────────────
function ItemRow({
  item, onChange, onRemove, onSuggest, isLast,
  uid, plan, propertyId, reportId,
}: {
  item: RoomItem;
  onChange: (patch: Partial<RoomItem>) => void;
  onRemove: () => void;
  onSuggest: () => void;
  isLast: boolean;
  uid: string;
  plan?: string;
  propertyId: string;
  reportId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const condColor = ELEMENT_CONDITION_COLORS[item.condition];

  return (
    <View style={[ir.container, !isLast && ir.containerBorder]}>
      {/* En-tête collapse */}
      <Pressable style={ir.row} onPress={() => setExpanded((e) => !e)}>
        <View style={[ir.dot, { backgroundColor: condColor }]} />
        <Text style={ir.name}>{item.name}</Text>
        <Text style={[ir.condLabel, { color: condColor }]}>
          {ELEMENT_CONDITION_LABELS[item.condition]}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={COLORS.textMuted}
        />
      </Pressable>

      {expanded && (
        <View style={ir.body}>
          <ConditionPicker
            value={item.condition}
            onChange={(c) => onChange({ condition: c })}
            conditionNote={item.conditionNote}
            onNoteChange={(n) => onChange({ conditionNote: n })}
            compact
          />
          {/* Observation + bouton IA */}
          <View style={ir.obsRow}>
            <TextInput
              style={[ir.obs, { flex: 1 }]}
              placeholder="Observation sur cet élément..."
              placeholderTextColor={COLORS.textMuted}
              value={item.observation ?? ""}
              onChangeText={(t) => onChange({ observation: t })}
              multiline
              numberOfLines={2}
              textAlignVertical="top"
            />
            <Pressable style={ir.aiBtn} onPress={onSuggest} hitSlop={8}>
              <Text style={ir.aiBtnText}>✨</Text>
            </Pressable>
          </View>
          {/* Photos de l'élément */}
          <View style={ir.photoSection}>
            <Text style={ir.photoLabel}>
              Photos
              <Text style={ir.photoHint}> (max {MAX_PHOTOS_PER_ITEM})</Text>
            </Text>
            <PhotoStrip
              photos={item.photos ?? []}
              maxPhotos={MAX_PHOTOS_PER_ITEM}
              target={`item-${item.id}`}
              propertyId={propertyId}
              reportId={reportId}
              uid={uid}
              plan={plan as any}
              onChange={(p) => onChange({ photos: p })}
            />
          </View>

          <Pressable style={ir.removeBtn} onPress={onRemove}>
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
            <Text style={ir.removeBtnText}>Supprimer</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const ir = StyleSheet.create({
  container:       { backgroundColor: "#fff" },
  containerBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  row: {
    flexDirection: "row", alignItems: "center", gap: 10, padding: 14,
  },
  dot:       { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  name:      { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  condLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  body:      { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  obs: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 10, padding: 10,
    fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border, minHeight: 56,
  },
  obsRow:  { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  aiBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(139,92,246,0.1)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(139,92,246,0.2)",
    marginTop: 2,
  },
  aiBtnText: { fontSize: 16 },
  removeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 8,
  },
  removeBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  photoSection: { gap: 4 },
  photoLabel:   { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  photoHint:    { fontFamily: "Inter_400Regular", textTransform: "none", letterSpacing: 0 },
});

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1 },
  headerTitle:  { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  headerSub:    { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },

  saveBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  saveBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  savedBadge:  { flexDirection: "row", alignItems: "center", gap: 4 },
  savedText:   { fontSize: 12, fontFamily: "Inter_500Medium", color: "#10B981" },

  scroll: { padding: 16, gap: 4 },

  sectionLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 8,
  },

  card: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 4,
  },

  textarea: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border,
    minHeight: 80, textAlignVertical: "top", marginBottom: 4,
  },

  itemsHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 16, marginBottom: 8,
  },
  addItemBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  addItemBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  emptyItems: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12, padding: 16,
    alignItems: "center", borderWidth: 1, borderColor: COLORS.border,
  },
  emptyItemsText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  notFound:       { fontSize: 16, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  backBtnAlt:     { backgroundColor: COLORS.surfaceAlt, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  backBtnAltText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },

  photosCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.border, marginTop: 12,
  },
  photosLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 8,
  },
  photosHint: { fontFamily: "Inter_400Regular", textTransform: "none", letterSpacing: 0 },

  obsHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 16, marginBottom: 8,
  },
  aiBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(139,92,246,0.08)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.2)",
  },
  aiBtnIcon: { fontSize: 13 },
  aiBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  suggestHeader: { marginBottom: 12 },
  suggestSub:    { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  suggestItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  suggestBullet: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(139,92,246,0.1)",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  suggestBulletText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#8B5CF6" },
  suggestText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.text, lineHeight: 18 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border,
    alignSelf: "center", marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 14 },
  addInput: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12, padding: 14,
    fontSize: 15, fontFamily: "Inter_400Regular", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border, marginBottom: 14,
  },
  confirmBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 14,
    paddingVertical: 14, alignItems: "center",
  },
  confirmBtnDis: { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
