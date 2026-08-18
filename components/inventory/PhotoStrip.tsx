/**
 * components/inventory/PhotoStrip.tsx
 * Bande de photos horizontale avec ajout (galerie / caméra) et suppression.
 * Gestion du quota de stockage intégrée.
 */
import { useState } from "react";
import {
  ActivityIndicator, Alert, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { PhotoRecord, SubscriptionPlan } from "@/shared/types";
import {
  uploadInventoryPhoto, deleteInventoryPhoto,
  getStorageQuota, getStorageUsed, formatBytes,
} from "@/lib/inventoryStorage";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  photos:     PhotoRecord[];
  maxPhotos:  number;
  /** Chemin Firebase Storage : "room" ou "item-{itemId}" */
  target:     string;
  propertyId: string;
  reportId:   string;
  uid:        string;
  plan?:      SubscriptionPlan;
  onChange:   (photos: PhotoRecord[]) => void;
  /** Si false, masque les boutons d'ajout/suppression */
  editable?:  boolean;
}

// ─── Visionneuse plein écran ──────────────────────────────────────────────────

function PhotoViewer({
  photos, index, onClose, onDelete, editable,
}: {
  photos: PhotoRecord[];
  index: number;
  onClose: () => void;
  onDelete: (idx: number) => void;
  editable?: boolean;
}) {
  const [current, setCurrent] = useState(index);
  const photo = photos[current];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={v.backdrop}>
        {/* Close */}
        <Pressable style={v.closeBtn} onPress={onClose} hitSlop={16}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>

        {/* Navigation */}
        {current > 0 && (
          <Pressable style={[v.navBtn, v.navLeft]} onPress={() => setCurrent((c) => c - 1)} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </Pressable>
        )}
        {current < photos.length - 1 && (
          <Pressable style={[v.navBtn, v.navRight]} onPress={() => setCurrent((c) => c + 1)} hitSlop={12}>
            <Ionicons name="chevron-forward" size={26} color="#fff" />
          </Pressable>
        )}

        {/* Image */}
        <Image
          source={{ uri: photo?.url }}
          style={v.image}
          contentFit="contain"
        />

        {/* Caption + delete */}
        <View style={v.footer}>
          {photo?.caption ? (
            <Text style={v.caption}>{photo.caption}</Text>
          ) : null}
          <Text style={v.counter}>{current + 1} / {photos.length}</Text>
          {editable && (
            <Pressable
              style={v.deleteBtn}
              onPress={() => {
                Alert.alert("Supprimer cette photo ?", undefined, [
                  { text: "Annuler", style: "cancel" },
                  {
                    text: "Supprimer", style: "destructive",
                    onPress: () => {
                      onDelete(current);
                      if (current >= photos.length - 1) {
                        if (photos.length === 1) { onClose(); return; }
                        setCurrent((c) => Math.max(0, c - 1));
                      }
                    },
                  },
                ]);
              }}
            >
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={v.deleteTxt}>Supprimer</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const v = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.95)",
    alignItems: "center", justifyContent: "center",
  },
  closeBtn:  { position: "absolute", top: 52, right: 20, zIndex: 10 },
  navBtn:    { position: "absolute", zIndex: 10 },
  navLeft:   { left: 12, top: "50%" },
  navRight:  { right: 12, top: "50%" },
  image:     { width: "90%", height: "65%" },
  footer:    { position: "absolute", bottom: 40, left: 0, right: 0, alignItems: "center", gap: 8 },
  caption:   { fontSize: 13, color: "rgba(255,255,255,0.7)", textAlign: "center", paddingHorizontal: 32 },
  counter:   { fontSize: 11, color: "rgba(255,255,255,0.4)" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 6,
               backgroundColor: "rgba(239,68,68,0.25)", borderRadius: 10,
               paddingHorizontal: 16, paddingVertical: 8, marginTop: 4 },
  deleteTxt: { fontSize: 13, color: "#fff", fontFamily: "Inter_600SemiBold" },
});

// ─── Composant principal ──────────────────────────────────────────────────────

export function PhotoStrip({
  photos, maxPhotos, target, propertyId, reportId, uid, plan,
  onChange, editable = true,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);

  const canAdd = editable && photos.length < maxPhotos;

  const pickImage = async (source: "camera" | "gallery") => {
    try {
      let result: ImagePicker.ImagePickerResult;

      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== "granted") {
          Alert.alert("Permission refusée", "Autorisez l'accès à la caméra dans les réglages.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.9,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== "granted") {
          Alert.alert("Permission refusée", "Autorisez l'accès à la galerie dans les réglages.");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images",
          quality: 0.9,
          allowsEditing: false,
        });
      }

      if (result.canceled || !result.assets?.[0]?.uri) return;

      setUploading(true);
      const record = await uploadInventoryPhoto({
        propertyId,
        reportId,
        target,
        localUri: result.assets[0].uri,
        uid,
        plan,
      });

      onChange([...photos, record]);
    } catch (err) {
      Alert.alert("Erreur upload", err instanceof Error ? err.message : "Impossible d'ajouter la photo.");
    } finally {
      setUploading(false);
    }
  };

  const handleAdd = () => {
    if (!canAdd) return;
    if (Platform.OS === "web") {
      pickImage("gallery");
      return;
    }
    Alert.alert("Ajouter une photo", undefined, [
      { text: "Prendre une photo",    onPress: () => pickImage("camera") },
      { text: "Choisir dans la galerie", onPress: () => pickImage("gallery") },
      { text: "Annuler", style: "cancel" },
    ]);
  };

  const handleDelete = async (idx: number) => {
    const photo = photos[idx];
    const next  = photos.filter((_, i) => i !== idx);
    onChange(next);                       // optimistic UI
    await deleteInventoryPhoto(photo.url, uid);
  };

  return (
    <View style={s.root}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.strip}
      >
        {/* Miniatures existantes */}
        {photos.map((p, idx) => (
          <Pressable
            key={p.url + idx}
            style={s.thumb}
            onPress={() => setViewerIdx(idx)}
          >
            <Image source={{ uri: p.url }} style={s.thumbImg} contentFit="cover" />
          </Pressable>
        ))}

        {/* Bouton ajouter */}
        {canAdd && (
          <Pressable style={s.addBtn} onPress={handleAdd} disabled={uploading}>
            {uploading ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={20} color={COLORS.primary} />
                <Text style={s.addTxt}>Photo</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Compteur / max */}
        {photos.length > 0 && (
          <View style={s.counter}>
            <Text style={s.counterTxt}>{photos.length}/{maxPhotos}</Text>
          </View>
        )}
      </ScrollView>

      {/* Visionneuse plein écran */}
      {viewerIdx !== null && (
        <PhotoViewer
          photos={photos}
          index={viewerIdx}
          onClose={() => setViewerIdx(null)}
          onDelete={(idx) => {
            handleDelete(idx);
            if (photos.length <= 1) setViewerIdx(null);
          }}
          editable={editable}
        />
      )}
    </View>
  );
}

// ─── Quota badge (à afficher dans le header de l'éditeur) ────────────────────

export function StorageQuotaBadge({
  uid, plan,
}: { uid: string; plan?: SubscriptionPlan }) {
  const [used, setUsed]   = useState<number | null>(null);
  const quota             = getStorageQuota(plan);
  const pct               = used !== null ? Math.min(100, (used / quota) * 100) : 0;

  useState(() => {
    getStorageUsed(uid).then(setUsed).catch(() => {});
  });

  if (used === null) return null;

  const color = pct > 90 ? "#EF4444" : pct > 70 ? "#F59E0B" : "#10B981";

  return (
    <View style={q.badge}>
      <View style={q.bar}>
        <View style={[q.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[q.label, { color }]}>
        {formatBytes(used)} / {formatBytes(quota)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:  { marginVertical: 6 },
  strip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2, paddingVertical: 2 },

  thumb: {
    width: 76, height: 76, borderRadius: 10, overflow: "hidden",
    borderWidth: 1, borderColor: COLORS.border,
  },
  thumbImg: { width: "100%", height: "100%" },

  addBtn: {
    width: 76, height: 76, borderRadius: 10,
    borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center", gap: 4,
    backgroundColor: `${COLORS.primary}08`,
  },
  addTxt: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: COLORS.primary },

  counter: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  counterTxt: { fontSize: 11, fontFamily: "Inter_700Bold", color: COLORS.textMuted },
});

const q = StyleSheet.create({
  badge: { gap: 3 },
  bar: {
    height: 3, borderRadius: 2,
    backgroundColor: COLORS.border,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: 2 },
  label: { fontSize: 10, fontFamily: "Inter_500Medium" },
});
