/**
 * app/inventory/[id]/rooms.tsx
 * Liste des pièces et annexes du rapport.
 * Permet d'ajouter une pièce / annexe personnalisée.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  addDoc, collection, doc, onSnapshot, orderBy,
  query, updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { COLORS } from "@/constants/colors";
import {
  InventoryRoom, InventoryReport,
  RoomType, AnnexType,
  ELEMENT_CONDITION_COLORS,
  ELEMENT_CONDITION_LABELS,
} from "@/shared/types";
import {
  DEFAULT_ROOM_ITEMS, DEFAULT_ANNEX_ITEMS,
  ROOM_TYPE_LABELS, ANNEX_TYPE_LABELS,
} from "@/lib/inventoryDefaults";

const ROOM_TYPES: RoomType[] = [
  "entree", "sejour", "salon", "cuisine",
  "chambre", "salle_bains", "salle_eau", "wc",
  "couloir", "dressing", "bureau", "buanderie", "cellier",
];
const ANNEX_TYPES: AnnexType[] = [
  "garage", "parking", "cave", "grenier",
  "balcon", "terrasse", "jardin", "cour", "dependance", "local",
];

export default function RoomsScreen() {
  const { id, propertyId } = useLocalSearchParams<{ id: string; propertyId: string }>();
  const router              = useRouter();
  const insets              = useSafeAreaInsets();

  const [rooms, setRooms]       = useState<InventoryRoom[]>([]);
  const [report, setReport]     = useState<InventoryReport | null>(null);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isAnnex, setIsAnnex]   = useState(false);
  const [pickedType, setPickedType] = useState<RoomType | AnnexType | null>(null);
  const [customName, setCustomName] = useState("");
  const [saving, setSaving]     = useState(false);

  const paddingTop = Platform.OS === "web" ? 67 + 12 : insets.top + 8;

  // Écoute rapport
  useEffect(() => {
    if (!id || !propertyId) return;
    return onSnapshot(
      doc(db, "properties", propertyId, "inventoryReports", id),
      (snap) => snap.exists() && setReport({ id: snap.id, ...snap.data() } as InventoryReport)
    );
  }, [id, propertyId]);

  // Écoute pièces
  useEffect(() => {
    if (!id || !propertyId) return;
    return onSnapshot(
      query(
        collection(db, "properties", propertyId, "inventoryReports", id, "rooms"),
        orderBy("order", "asc")
      ),
      (snap) => {
        setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryRoom)));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [id, propertyId]);

  const isDraft = !report || report.status === "draft";

  const openAddModal = (annex: boolean) => {
    setIsAnnex(annex);
    setPickedType(null);
    setCustomName("");
    setShowModal(true);
  };

  const handleAddRoom = async () => {
    if (!pickedType && !customName.trim()) return;
    setSaving(true);
    try {
      const type   = pickedType ?? "custom";
      const isAnx  = isAnnex;
      const name   = customName.trim() ||
        (isAnnex
          ? ANNEX_TYPE_LABELS[type as AnnexType] ?? type
          : ROOM_TYPE_LABELS[type as RoomType] ?? type);
      const items  = isAnnex
        ? (DEFAULT_ANNEX_ITEMS[type as AnnexType] ?? [])
        : (DEFAULT_ROOM_ITEMS[type as RoomType] ?? []);

      await addDoc(
        collection(db, "properties", propertyId, "inventoryReports", id, "rooms"),
        {
          reportId:          id,
          name,
          type,
          isAnnex:           isAnx,
          order:             rooms.length,
          photos:            [],
          items,
          observation:       "",
          tenantObservation: "",
          createdAt:         new Date().toISOString(),
          updatedAt:         new Date().toISOString(),
        }
      );
      setShowModal(false);
    } catch {
      Alert.alert("Erreur", "Impossible d'ajouter la pièce.");
    } finally {
      setSaving(false);
    }
  };

  const goToRoom = (room: InventoryRoom) => {
    router.push(`/inventory/${id}/room/${room.id}?propertyId=${propertyId}` as any);
  };

  const mainRooms  = rooms.filter((r) => !r.isAnnex);
  const annexRooms = rooms.filter((r) => r.isAnnex);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>
        <Text style={s.headerTitle}>Pièces & annexes</Text>
        {isDraft && (
          <Pressable style={s.addBtn} onPress={() => openAddModal(false)}>
            <Ionicons name="add" size={18} color="#fff" />
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color="#8B5CF6" size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Pièces principales */}
          <Text style={s.groupLabel}>Pièces ({mainRooms.length})</Text>
          {mainRooms.length === 0 ? (
            <View style={s.emptyGroup}>
              <Text style={s.emptyGroupText}>Aucune pièce</Text>
            </View>
          ) : (
            <View style={s.list}>
              {mainRooms.map((room, idx) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  isLast={idx === mainRooms.length - 1}
                  onPress={() => goToRoom(room)}
                />
              ))}
            </View>
          )}

          {isDraft && (
            <Pressable style={s.addRoomBtn} onPress={() => openAddModal(false)}>
              <Ionicons name="add-circle-outline" size={18} color="#8B5CF6" />
              <Text style={s.addRoomBtnText}>Ajouter une pièce</Text>
            </Pressable>
          )}

          {/* Annexes */}
          <Text style={[s.groupLabel, { marginTop: 20 }]}>Annexes ({annexRooms.length})</Text>
          {annexRooms.length === 0 ? (
            <View style={s.emptyGroup}>
              <Text style={s.emptyGroupText}>Aucune annexe</Text>
            </View>
          ) : (
            <View style={s.list}>
              {annexRooms.map((room, idx) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  isLast={idx === annexRooms.length - 1}
                  onPress={() => goToRoom(room)}
                />
              ))}
            </View>
          )}

          {isDraft && (
            <Pressable style={s.addRoomBtn} onPress={() => openAddModal(true)}>
              <Ionicons name="add-circle-outline" size={18} color="#8B5CF6" />
              <Text style={s.addRoomBtnText}>Ajouter une annexe</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* Modal ajout pièce */}
      <Modal
        visible={showModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowModal(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowModal(false)}>
          <Pressable style={[s.modalSheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>
              {isAnnex ? "Ajouter une annexe" : "Ajouter une pièce"}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.modalSubLabel}>Type</Text>
              <View style={s.typeGrid}>
                {(isAnnex ? ANNEX_TYPES : ROOM_TYPES).map((t) => (
                  <Pressable
                    key={t}
                    style={[s.typeChip, pickedType === t && s.typeChipActive]}
                    onPress={() => { setPickedType(t); setCustomName(""); }}
                  >
                    <Text style={[s.typeChipText, pickedType === t && s.typeChipTextActive]}>
                      {isAnnex
                        ? ANNEX_TYPE_LABELS[t as AnnexType]
                        : ROOM_TYPE_LABELS[t as RoomType]}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  key="custom"
                  style={[s.typeChip, pickedType === null && customName.length > 0 && s.typeChipActive]}
                  onPress={() => setPickedType(null)}
                >
                  <Text style={[
                    s.typeChipText,
                    pickedType === null && customName.length > 0 && s.typeChipTextActive,
                  ]}>
                    Personnalisé
                  </Text>
                </Pressable>
              </View>

              <Text style={[s.modalSubLabel, { marginTop: 12 }]}>Nom personnalisé (optionnel)</Text>
              <TextInput
                style={s.nameInput}
                placeholder={isAnnex ? "Ex : Box voiture..." : "Ex : Chambre parentale..."}
                placeholderTextColor={COLORS.textMuted}
                value={customName}
                onChangeText={(t) => { setCustomName(t); if (t) setPickedType(null); }}
                maxLength={60}
              />
            </ScrollView>

            <Pressable
              style={[s.confirmBtn, (!pickedType && !customName.trim()) && s.confirmBtnDis]}
              onPress={handleAddRoom}
              disabled={saving || (!pickedType && !customName.trim())}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.confirmBtnText}>Ajouter</Text>
              }
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Ligne pièce ─────────────────────────────────────────────────────────────
function RoomRow({
  room, onPress, isLast,
}: {
  room: InventoryRoom;
  onPress: () => void;
  isLast: boolean;
}) {
  const checkedItems = room.items.filter((i) =>
    i.condition !== "not_checked" && i.condition !== "absent"
  ).length;
  const totalItems   = room.items.length;
  const progress     = totalItems > 0 ? checkedItems / totalItems : 0;

  const worstCondition = room.items.reduce<string | null>((worst, item) => {
    const order = ["damaged", "poor", "fair", "good", "excellent", "new", "not_checked", "absent", "other"];
    if (!worst) return item.condition;
    return order.indexOf(item.condition) < order.indexOf(worst) ? item.condition : worst;
  }, null);

  const condColor = worstCondition && worstCondition !== "not_checked"
    ? ELEMENT_CONDITION_COLORS[worstCondition as keyof typeof ELEMENT_CONDITION_COLORS]
    : COLORS.textMuted;

  return (
    <Pressable
      style={({ pressed }) => [r.row, !isLast && r.rowBorder, pressed && { opacity: 0.65 }]}
      onPress={onPress}
    >
      <View style={r.icon}>
        <Ionicons
          name={room.isAnnex ? "cube-outline" : "home-outline"}
          size={18}
          color="#8B5CF6"
        />
      </View>
      <View style={r.info}>
        <Text style={r.name}>{room.name}</Text>
        <Text style={r.count}>
          {checkedItems}/{totalItems} éléments vérifiés
        </Text>
        {/* Barre de progression */}
        <View style={r.progressBar}>
          <View style={[r.progressFill, { width: `${progress * 100}%` as any, backgroundColor: condColor }]} />
        </View>
      </View>
      {room.photos.length > 0 && (
        <View style={r.photoBadge}>
          <Ionicons name="camera" size={10} color={COLORS.textMuted} />
          <Text style={r.photoBadgeText}>{room.photos.length}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={COLORS.textMuted} />
    </Pressable>
  );
}

const r = StyleSheet.create({
  row:        { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  rowBorder:  { borderBottomWidth: 1, borderBottomColor: COLORS.border },
  icon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: "rgba(139,92,246,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  info:   { flex: 1 },
  name:   { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  count:  { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  progressBar: {
    height: 3, backgroundColor: COLORS.surfaceAlt, borderRadius: 2,
    marginTop: 5, overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 2 },
  photoBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  photoBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
});

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", color: COLORS.text },
  addBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: "#8B5CF6",
    alignItems: "center", justifyContent: "center",
  },

  scroll: { padding: 16, gap: 4 },

  groupLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 8,
  },
  list: {
    backgroundColor: "#fff", borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, overflow: "hidden",
  },
  emptyGroup: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: "center",
  },
  emptyGroupText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  addRoomBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center",
    padding: 12, marginTop: 8,
    backgroundColor: "rgba(139,92,246,0.06)", borderRadius: 12,
    borderWidth: 1, borderColor: "rgba(139,92,246,0.15)", borderStyle: "dashed",
  },
  addRoomBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#8B5CF6" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: "80%",
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text, marginBottom: 16 },
  modalSubLabel: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8,
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  typeChipActive: { borderColor: "#8B5CF6", backgroundColor: "rgba(139,92,246,0.08)" },
  typeChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textSecondary },
  typeChipTextActive: { color: "#8B5CF6", fontFamily: "Inter_700Bold" },

  nameInput: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12,
    padding: 12, fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.text, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 16,
  },
  confirmBtn: {
    backgroundColor: "#8B5CF6", borderRadius: 14,
    paddingVertical: 14, alignItems: "center", marginTop: 8,
  },
  confirmBtnDis: { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
});
