import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS } from "@/constants/colors";
import { CategoryBadge } from "@/components/CategoryBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { StarRating } from "@/components/StarRating";
import { useInterventions } from "@/context/InterventionsContext";
import { useCoPro } from "@/context/CoProContext";
import { uploadPhoto } from "@/lib/storage";
import { CleaningArea, generateCleaningAreas } from "@/shared/types";

function formatFrenchPhone(value?: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "").slice(0, 10);
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

function getAppDownloadUrl(): string {
  return process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL?.trim() || "";
}

function getCategoryInviteCode(
  copro: any,
  category: string | undefined
): string {
  if (!copro || !category) return "";
  const value = copro?.categoryInviteCodes?.[category];
  return typeof value === "string" ? value.trim() : "";
}

function getCategoryLabel(category: string | undefined): string {
  if (!category) return "Prestation";

  const labels: Record<string, string> = {
    plomberie: "Plomberie",
    nettoyage: "Nettoyage",
    electricite: "Électricité",
    serrurerie: "Serrurerie",
    chauffage: "Chauffage",
    ascenseur: "Ascenseur",
    jardinage: "Jardinage",
    peinture: "Peinture",
    vitrerie: "Vitrerie",
    menuiserie: "Menuiserie",
  };

  return labels[category] || category;
}

function buildProviderShareMessage(params: {
  providerName: string;
  coproName: string;
  title: string;
  description: string;
  date: string;
  categoryLabel: string;
  categoryInviteCode: string;
  appLink?: string;
}) {
  return (
    `Bonjour ${params.providerName},\n\n` +
    `Une intervention vous a été attribuée.\n\n` +
    `Copropriété : ${params.coproName}\n` +
    `Intervention : ${params.title}\n` +
    `Catégorie : ${params.categoryLabel}\n` +
    `Date : ${params.date}\n` +
    `Description : ${params.description}\n\n` +
    `Code prestation : ${params.categoryInviteCode}\n` +
    (params.appLink ? `Application : ${params.appLink}\n` : "")
  );
}

function PhotoViewer({
  urls,
  startIndex,
  onClose,
}: {
  urls: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(startIndex);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={viewerStyles.overlay}>
        <Pressable style={viewerStyles.closeBtn} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>

        <Text style={viewerStyles.counter}>
          {current + 1} / {urls.length}
        </Text>

        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{
            x: current * Dimensions.get("window").width,
            y: 0,
          }}
          onMomentumScrollEnd={(e) =>
            setCurrent(
              Math.round(
                e.nativeEvent.contentOffset.x / Dimensions.get("window").width
              )
            )
          }
          style={{ flex: 1 }}
        >
          {urls.map((url, idx) => (
            <View key={idx} style={viewerStyles.page}>
              <Image
                source={{ uri: url }}
                style={viewerStyles.img}
                resizeMode="contain"
              />
            </View>
          ))}
        </ScrollView>

        {urls.length > 1 && (
          <View
            style={[viewerStyles.dots, { paddingBottom: insets.bottom + 12 }]}
          >
            {urls.map((_, idx) => (
              <View
                key={idx}
                style={[viewerStyles.dot, idx === current && viewerStyles.dotActive]}
              />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

const viewerStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#000" },
  closeBtn: {
    position: "absolute",
    top: 52,
    right: 20,
    zIndex: 10,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 20,
    padding: 6,
  },
  counter: {
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    zIndex: 10,
  },
  page: {
    width: Dimensions.get("window").width,
    justifyContent: "center",
    alignItems: "center",
  },
  img: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height * 0.85,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    paddingTop: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  dotActive: {
    backgroundColor: "#fff",
    width: 18,
  },
});

function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function InterventionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const {
    getIntervention,
    rateIntervention,
    deleteIntervention,
    deleteInterventionsByGroupId,
    updateIntervention,
  } = useInterventions();
  const { currentCopro, currentRole } = useCoPro();

  const isAdmin = currentRole === "admin";
  const isPrestataire = currentRole === "prestataire";
  const isProprietaire = currentRole === "propriétaire";
  const canRate = isProprietaire;
  const canDelete = isAdmin;

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const intervention = getIntervention(id ?? "");

  const [rating, setRating] = useState(intervention?.rating);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingCompletion, setIsUploadingCompletion] = useState(false);
  const [localCompletionPhotos, setLocalCompletionPhotos] = useState<string[]>([]);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [localChecklist, setLocalChecklist] = useState<Record<string, boolean>>(
    intervention?.cleaningChecklist ?? {}
  );
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [isSharingGuestInvite, setIsSharingGuestInvite] = useState(false);

  const [report, setReport] = useState(intervention?.interventionReport ?? "");
  const [remaining, setRemaining] = useState(
    intervention?.interventionRemaining ?? ""
  );

  const openViewer = (urls: string[], idx: number) => {
    setViewerPhotos(urls);
    setViewerIndex(idx);
  };

  const cleaningAreas = useMemo<CleaningArea[]>(() => {
    if (intervention?.category !== "nettoyage") return [];
    const config = currentCopro?.buildingConfig;
    if (!config) return [];
    return generateCleaningAreas(config);
  }, [intervention?.category, currentCopro?.buildingConfig]);

  const groupedCleaningAreas = useMemo<[string, CleaningArea[]][]>(() => {
    const groups: Record<string, CleaningArea[]> = {};
    cleaningAreas.forEach((a) => {
      if (!groups[a.group]) groups[a.group] = [];
      groups[a.group].push(a);
    });
    return Object.entries(groups);
  }, [cleaningAreas]);

  const handleToggleChecklistItem = async (areaId: string) => {
    if (!intervention || (!isAdmin && !isPrestataire)) return;

    const previous = localChecklist;
    const newValue = !localChecklist[areaId];
    const updated = { ...localChecklist, [areaId]: newValue };

    setLocalChecklist(updated);
    Haptics.selectionAsync();
    setSavingChecklist(true);

    try {
      await updateIntervention(intervention.id, {
        cleaningChecklist: updated,
      } as any);
    } catch {
      setLocalChecklist(previous);
      Alert.alert("Erreur", "Impossible de mettre à jour la checklist.");
    } finally {
      setSavingChecklist(false);
    }
  };

  if (!intervention) {
    return (
      <View style={styles.notFound}>
        <Ionicons name="alert-circle-outline" size={52} color={COLORS.textMuted} />
        <Text style={styles.notFoundText}>Intervention introuvable</Text>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const photos = intervention.photos ?? [];
  const completionPhotos = intervention.completionPhotos ?? [];
  const allCompletionPhotos = [...completionPhotos, ...localCompletionPhotos];
  const hasCompletionProof = completionPhotos.length > 0;
  const canSubmitReport = isPrestataire && intervention.status === "planifie";
  const hasSavedReport = !!intervention.interventionReport;
  const maxCompletionPhotos = 5;
  const remainingSlots = Math.max(0, maxCompletionPhotos - allCompletionPhotos.length);

  const invitedProvider = (intervention as any).invitedProvider;
  const isGuestUrgentIntervention =
    isAdmin &&
    (intervention as any).providerMode === "new" &&
    !!invitedProvider?.email;

  const handleRate = async (newRating: number) => {
    setRating(newRating);
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await rateIntervention(intervention.id, newRating);
    } finally {
      setIsSaving(false);
    }
  };

  const uploadAndSavePhotos = async (): Promise<string[]> => {
    if (localCompletionPhotos.length === 0) return [];

    if (!currentCopro?.id) {
      throw new Error("Copropriété introuvable.");
    }

    setIsUploadingCompletion(true);

    try {
      const uploaded: string[] = [];

      for (const uri of localCompletionPhotos) {
        const url = await uploadPhoto(currentCopro.id, intervention.id, uri);
        uploaded.push(url);
      }

      return uploaded;
    } finally {
      setIsUploadingCompletion(false);
    }
  };

  const handleSavePhotosOnly = async () => {
    if (localCompletionPhotos.length === 0) return;

    if (!currentCopro?.id) {
      Alert.alert(
        "Copropriété manquante",
        "Impossible d'envoyer les photos sans copropriété active."
      );
      return;
    }

    try {
      setIsUploadingCompletion(true);

      const uploaded: string[] = [];

      for (const uri of localCompletionPhotos) {
        const url = await uploadPhoto(currentCopro.id, intervention.id, uri);
        uploaded.push(url);
      }

      const existing = intervention.completionPhotos ?? [];

      await updateIntervention(intervention.id, {
        completionPhotos: [...existing, ...uploaded],
      } as any);

      setLocalCompletionPhotos([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      console.error("SAVE COMPLETION PHOTOS ERROR:", e);
      Alert.alert(
        "Erreur",
        e?.message ||
          "Impossible d'enregistrer les photos. Vérifiez votre connexion."
      );
    } finally {
      setIsUploadingCompletion(false);
    }
  };

  const pickCompletionPhoto = async () => {
    if (remainingSlots <= 0) return;

    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Permission refusée",
          "L'accès aux photos est nécessaire pour ajouter une preuve."
        );
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setLocalCompletionPhotos((prev) =>
        [...prev, result.assets[0].uri].slice(0, maxCompletionPhotos)
      );
    }
  };

  const takeCompletionPhoto = async () => {
    if (remainingSlots <= 0) return;

    if (Platform.OS === "web") {
      await pickCompletionPhoto();
      return;
    }

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission refusée", "L'accès à la caméra est nécessaire.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setLocalCompletionPhotos((prev) =>
        [...prev, result.assets[0].uri].slice(0, maxCompletionPhotos)
      );
    }
  };

  const handleMarkRealise = async () => {
    if (!report.trim()) {
      Alert.alert(
        "Rapport requis",
        "Veuillez remplir le rapport d’intervention avant de valider."
      );
      return;
    }

    try {
      const uploaded = await uploadAndSavePhotos();
      const existing = intervention.completionPhotos ?? [];

      const updates: Record<string, any> = {
        status: "en_cours",
        interventionReport: report.trim(),
        interventionRemaining: remaining.trim() || null,
        ...(uploaded.length > 0
          ? { completionPhotos: [...existing, ...uploaded] }
          : {}),
      };

      await updateIntervention(intervention.id, updates as any);

      setLocalCompletionPhotos([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert(
        "Erreur",
        "Impossible de mettre à jour l'intervention. Vérifiez votre connexion."
      );
    }
  };

  const handleValidate = async () => {
    if (!intervention.interventionReport && !report.trim()) {
      Alert.alert(
        "Rapport manquant",
        "Le prestataire doit remplir le rapport d’intervention avant validation."
      );
      return;
    }

    try {
      const uploaded = await uploadAndSavePhotos();
      const existing = intervention.completionPhotos ?? [];

      const updates: Record<string, any> = {
        status: "termine",
        ...(uploaded.length > 0
          ? { completionPhotos: [...existing, ...uploaded] }
          : {}),
      };

      await updateIntervention(intervention.id, updates as any);

      setLocalCompletionPhotos([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert(
        "Erreur",
        "Impossible de valider l'intervention. Vérifiez votre connexion."
      );
    }
  };

  const handleDelete = () => {
    const hasGroup = !!intervention.recurrenceGroupId;

    const doDelete = async (deleteAll: boolean) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      try {
        if (deleteAll && intervention.recurrenceGroupId) {
          await deleteInterventionsByGroupId(intervention.recurrenceGroupId);
        } else {
          await deleteIntervention(intervention.id);
        }
        router.back();
      } catch (e: any) {
        const code = e?.code ?? "";
        const msg = code.includes("permission-denied")
          ? "Vous n'avez pas les droits pour supprimer cette intervention."
          : e?.message ?? "Une erreur est survenue lors de la suppression.";
        Alert.alert("Erreur", msg);
      }
    };

    if (hasGroup) {
      Alert.alert(
        "Supprimer",
        "Cette intervention fait partie d'une série récurrente. Que souhaitez-vous supprimer ?",
        [
          { text: "Annuler", style: "cancel" },
          { text: "Celle-ci uniquement", onPress: () => doDelete(false) },
          {
            text: "Toute la série",
            style: "destructive",
            onPress: () => doDelete(true),
          },
        ]
      );
    } else {
      Alert.alert("Supprimer", "Voulez-vous supprimer cette intervention ?", [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: () => doDelete(false) },
      ]);
    }
  };

  const handleShareGuestInvite = async () => {
    if (!currentCopro?.id) {
      Alert.alert("Erreur", "Aucune copropriété active.");
      return;
    }

    if (!invitedProvider?.email) {
      Alert.alert("Erreur", "Aucun prestataire invité associé à cette intervention.");
      return;
    }

    const categoryInviteCode = getCategoryInviteCode(
      currentCopro,
      intervention.category
    );

    if (!categoryInviteCode) {
      Alert.alert(
        "Code manquant",
        `Aucun code prestation n'est défini pour la catégorie ${getCategoryLabel(
          intervention.category
        )}.`
      );
      return;
    }

    try {
      setIsSharingGuestInvite(true);

      const providerName =
        [invitedProvider.firstName, invitedProvider.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() || "Prestataire";

      const message = buildProviderShareMessage({
        providerName,
        coproName: currentCopro.name || "Copropriété",
        title: intervention.title,
        description: intervention.description || "",
        date: formatDateFull(intervention.date),
        categoryLabel: getCategoryLabel(intervention.category),
        categoryInviteCode,
        appLink: getAppDownloadUrl(),
      });

      await Share.share({
        title: "Partager l’intervention",
        message,
      });

      await updateIntervention(intervention.id, {
        guestInviteLastSharedAt: new Date().toISOString(),
        sharedCategoryInviteCode: categoryInviteCode,
      } as any);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.error("Guest invite share failed:", e);
      Alert.alert("Partage impossible", "Le message n’a pas pu être partagé.");
    } finally {
      setIsSharingGuestInvite(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[COLORS.dark, COLORS.darkMid]}
        style={[styles.heroGradient, { paddingTop: topPadding + 8 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.heroHeader}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backIconBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </Pressable>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {isAdmin && (
              <Pressable
                onPress={() => router.push(`/add?editId=${intervention.id}` as any)}
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name="pencil-outline"
                  size={20}
                  color="rgba(255,255,255,0.85)"
                />
              </Pressable>
            )}

            {canDelete && (
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color="rgba(255,100,100,0.9)"
                />
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.heroBadges}>
          <CategoryBadge category={intervention.category} />
          <StatusBadge status={intervention.status} />
          {hasCompletionProof && (
            <View style={styles.proofBadge}>
              <Ionicons name="checkmark-circle" size={12} color="#10B981" />
              <Text style={styles.proofBadgeText}>Preuve ajoutée</Text>
            </View>
          )}
        </View>

        <Text style={styles.heroTitle}>{intervention.title}</Text>

        {intervention.createdByName && (
          <View style={styles.createdByRow}>
            <Ionicons
              name="person-circle-outline"
              size={14}
              color="rgba(255,255,255,0.5)"
            />
            <Text style={styles.createdByText}>
              Ajouté par {intervention.createdByName}
            </Text>
          </View>
        )}
      </LinearGradient>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {viewerPhotos.length > 0 && (
          <PhotoViewer
            urls={viewerPhotos}
            startIndex={viewerIndex}
            onClose={() => setViewerPhotos([])}
          />
        )}

        {photos.length > 0 && (
          <View style={styles.photoSection}>
            <Text style={styles.sectionLabel}>
              Photos du signalement ({photos.length})
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photoScroll}
            >
              {photos.map((url, idx) => (
                <Pressable key={idx} onPress={() => openViewer(photos, idx)}>
                  <Image source={{ uri: url }} style={styles.photo} resizeMode="cover" />
                  <View style={styles.photoZoomHint}>
                    <Ionicons name="expand-outline" size={14} color="#fff" />
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <View
          style={[styles.completionCard, hasCompletionProof && styles.completionCardDone]}
        >
          <View style={styles.completionHeader}>
            <View
              style={[
                styles.completionIconWrap,
                hasCompletionProof && styles.completionIconWrapDone,
              ]}
            >
              <Ionicons
                name={hasCompletionProof ? "checkmark-circle" : "camera-outline"}
                size={20}
                color={hasCompletionProof ? "#10B981" : COLORS.primary}
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.completionTitle}>Photos de réalisation</Text>
              <Text style={styles.completionSub}>
                {hasCompletionProof
                  ? `${completionPhotos.length} photo${
                      completionPhotos.length > 1 ? "s" : ""
                    } de preuve${
                      allCompletionPhotos.length > completionPhotos.length
                        ? ` · ${
                            allCompletionPhotos.length - completionPhotos.length
                          } en attente d'enregistrement`
                        : " — travail validé"
                    }`
                  : isPrestataire
                  ? "Prenez des photos pour prouver la bonne réalisation du travail"
                  : intervention.status === "termine"
                  ? "Aucune photo de preuve — en attente du prestataire"
                  : "Les photos de preuve pourront être ajoutées par le prestataire"}
              </Text>
            </View>
          </View>

          {allCompletionPhotos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.completionScroll}
            >
              {allCompletionPhotos.map((uri, idx) => (
                <Pressable
                  key={idx}
                  style={styles.completionThumbWrap}
                  onPress={() => openViewer(allCompletionPhotos, idx)}
                >
                  <Image source={{ uri }} style={styles.completionThumb} resizeMode="cover" />

                  {isPrestataire && idx >= completionPhotos.length && (
                    <Pressable
                      style={styles.thumbRemove}
                      onPress={() =>
                        setLocalCompletionPhotos((p) =>
                          p.filter((_, i) => i !== idx - completionPhotos.length)
                        )
                      }
                    >
                      <Ionicons name="close-circle" size={18} color="#fff" />
                    </Pressable>
                  )}

                  {idx < completionPhotos.length && (
                    <View style={styles.thumbSaved}>
                      <Ionicons name="expand-outline" size={14} color="#fff" />
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          )}

          {isPrestataire && intervention.status !== "termine" && remainingSlots > 0 && (
            <View style={styles.completionActions}>
              <Pressable
                style={({ pressed }) => [styles.completionBtn, pressed && { opacity: 0.8 }]}
                onPress={takeCompletionPhoto}
              >
                <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
                <Text style={styles.completionBtnText}>Caméra</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.completionBtn, pressed && { opacity: 0.8 }]}
                onPress={pickCompletionPhoto}
              >
                <Ionicons name="images-outline" size={18} color={COLORS.primary} />
                <Text style={styles.completionBtnText}>Galerie</Text>
              </Pressable>
            </View>
          )}

          {isPrestataire && localCompletionPhotos.length > 0 && (
            <Pressable
              style={[styles.saveProofBtn, isUploadingCompletion && { opacity: 0.6 }]}
              onPress={handleSavePhotosOnly}
              disabled={isUploadingCompletion}
            >
              {isUploadingCompletion ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
                  <Text style={styles.saveProofBtnText}>
                    Enregistrer {localCompletionPhotos.length} photo
                    {localCompletionPhotos.length > 1 ? "s" : ""}
                  </Text>
                </>
              )}
            </Pressable>
          )}
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Date d'intervention</Text>
              <Text style={styles.infoValue}>{formatDateFull(intervention.date)}</Text>
            </View>
          </View>

          {(intervention as any).assignedToName && (
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="person-outline" size={18} color={COLORS.accent} />
              </View>
              <View>
                <Text style={styles.infoLabel}>Technicien / Prestataire</Text>
                <Text style={styles.infoValue}>{(intervention as any).assignedToName}</Text>
              </View>
            </View>
          )}

          {intervention.technicianPhone && (
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="call-outline" size={18} color={COLORS.teal} />
              </View>
              <View>
                <Text style={styles.infoLabel}>Téléphone intervenant</Text>
                <Text style={styles.infoValue}>
                  {formatFrenchPhone(intervention.technicianPhone)}
                </Text>
              </View>
            </View>
          )}

          {intervention.recurrenceGroupId && intervention.recurrenceTotal && (
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="repeat-outline" size={18} color={COLORS.primary} />
              </View>
              <View>
                <Text style={styles.infoLabel}>Récurrence</Text>
                <Text style={styles.infoValue}>
                  Intervention {intervention.recurrenceIndex}/{intervention.recurrenceTotal}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="time-outline" size={18} color={COLORS.warning} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Ajouté le</Text>
              <Text style={styles.infoValue}>{formatDateFull(intervention.createdAt)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.descCard}>
          <Text style={styles.descTitle}>Description</Text>
          <Text style={styles.descText}>
            {intervention.description || "Aucune description fournie."}
          </Text>
        </View>

        {isGuestUrgentIntervention && (
          <View style={styles.shareCard}>
            <View style={styles.shareCardHeader}>
              <View style={styles.shareCardIcon}>
                <Ionicons name="share-social-outline" size={18} color={COLORS.primary} />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.shareCardTitle}>Prestataire invité</Text>
                <Text style={styles.shareCardText}>
                  Cette intervention a été créée pour un prestataire non inscrit.
                  Vous pouvez partager le code prestation à tout moment par SMS,
                  mail ou WhatsApp.
                </Text>
              </View>
            </View>

            <Pressable
              onPress={handleShareGuestInvite}
              disabled={isSharingGuestInvite}
              style={({ pressed }) => [
                styles.shareBtn,
                pressed && { opacity: 0.85 },
                isSharingGuestInvite && { opacity: 0.65 },
              ]}
            >
              {isSharingGuestInvite ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={18} color="#fff" />
                  <Text style={styles.shareBtnText}>Partager l’intervention</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {canSubmitReport && (
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Rapport d’intervention *</Text>
            <Text style={styles.reportHint}>
              Décrivez précisément ce que vous avez fait. Ce rapport est obligatoire
              avant validation.
            </Text>

            <TextInput
              value={report}
              onChangeText={setReport}
              placeholder="Ex : remplacement du joint, serrage du raccord, test d’étanchéité effectué..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
              style={[styles.reportInput, styles.reportTextarea]}
            />

            <Text style={styles.reportTitleSecondary}>Travaux restants</Text>
            <Text style={styles.reportHint}>
              Indiquez ici ce qu’il reste à faire, si besoin.
            </Text>

            <TextInput
              value={remaining}
              onChangeText={setRemaining}
              placeholder="Ex : prévoir remplacement complet de la pièce lors d’un second passage"
              placeholderTextColor={COLORS.textMuted}
              multiline
              textAlignVertical="top"
              style={[styles.reportInput, styles.reportTextareaSmall]}
            />
          </View>
        )}

        {(hasSavedReport || report.trim()) && (
          <View style={styles.reportDisplayCard}>
            <Text style={styles.reportDisplayTitle}>Rapport prestataire</Text>
            <Text style={styles.reportDisplayText}>
              {intervention.interventionReport || report}
            </Text>

            {!!(intervention.interventionRemaining || remaining.trim()) && (
              <>
                <Text style={styles.reportDisplayTitleSecondary}>Travaux restants</Text>
                <Text style={styles.reportDisplayText}>
                  {intervention.interventionRemaining || remaining}
                </Text>
              </>
            )}
          </View>
        )}

        {intervention.category === "nettoyage" &&
          (groupedCleaningAreas.length > 0 ||
            Object.keys(localChecklist).length > 0) && (
            <View style={styles.checklistCard}>
              <View style={styles.checklistCardHeader}>
                <View style={styles.checklistCardIconWrap}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={18}
                    color={COLORS.teal}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.checklistCardTitle}>Zones de nettoyage</Text>
                  {groupedCleaningAreas.length > 0 && (
                    <Text style={styles.checklistCardSub}>
                      {Object.values(localChecklist).filter(Boolean).length}/
                      {cleaningAreas.length} zones effectuées
                    </Text>
                  )}
                </View>

                {savingChecklist && (
                  <ActivityIndicator size="small" color={COLORS.teal} />
                )}
              </View>

              {groupedCleaningAreas.length > 0 ? (
                groupedCleaningAreas.map(([group, areas]) => (
                  <View key={group} style={styles.checklistCardGroup}>
                    <Text style={styles.checklistCardGroupLabel}>{group}</Text>
                    {areas.map((area) => {
                      const checked = localChecklist[area.id] !== false;
                      const canEdit = isAdmin || isPrestataire;

                      return (
                        <Pressable
                          key={area.id}
                          style={[styles.checklistCardRow, !checked && { opacity: 0.55 }]}
                          onPress={canEdit ? () => handleToggleChecklistItem(area.id) : undefined}
                          disabled={!canEdit || savingChecklist}
                        >
                          <Ionicons
                            name={checked ? "checkbox" : "square-outline"}
                            size={20}
                            color={checked ? COLORS.teal : COLORS.textMuted}
                          />
                          <Text
                            style={[
                              styles.checklistCardAreaLabel,
                              !checked && styles.checklistCardAreaDone,
                            ]}
                          >
                            {area.label}
                          </Text>
                          {checked && (
                            <Ionicons name="checkmark" size={14} color={COLORS.teal} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              ) : (
                <View style={styles.checklistLegacyWrap}>
                  {Object.entries(localChecklist).map(([key, done]) => (
                    <View
                      key={key}
                      style={[styles.checklistCardRow, !done && { opacity: 0.55 }]}
                    >
                      <Ionicons
                        name={done ? "checkbox" : "square-outline"}
                        size={18}
                        color={done ? COLORS.teal : COLORS.textMuted}
                      />
                      <Text
                        style={[
                          styles.checklistCardAreaLabel,
                          !done && styles.checklistCardAreaDone,
                        ]}
                      >
                        {key}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {(isAdmin || isPrestataire) && groupedCleaningAreas.length > 0 && (
                <Text style={styles.checklistCardHint}>
                  Appuyez sur une zone pour la cocher / décocher
                </Text>
              )}
            </View>
          )}

        <View style={styles.ratingCard}>
          {intervention.status === "termine" ? (
            <>
              <Text style={styles.ratingTitle}>Évaluation de l'intervention</Text>
              <View style={styles.starsRow}>
                <StarRating
                  value={rating}
                  onChange={canRate ? handleRate : undefined}
                  size={40}
                  readonly={!canRate || isSaving}
                />
              </View>

              {rating ? (
                <Text style={styles.ratingFeedback}>
                  {rating === 1 && "Insuffisant — à améliorer"}
                  {rating === 2 && "Passable — peut mieux faire"}
                  {rating === 3 && "Bien réalisé"}
                  {rating === 4 && "Excellent — très bien fait !"}
                </Text>
              ) : canRate ? (
                <Text style={styles.ratingHint}>
                  Appuyez sur une étoile pour noter
                </Text>
              ) : (
                <Text style={styles.ratingHint}>Pas encore noté</Text>
              )}
            </>
          ) : intervention.status === "planifie" && isPrestataire ? (
            <>
              <Text style={styles.ratingTitle}>
                {intervention.category === "nettoyage"
                  ? "Preuve de nettoyage"
                  : "Marquer comme réalisée"}
              </Text>
              <Text style={styles.ratingHint}>
                {intervention.category === "nettoyage"
                  ? "Ajoutez une photo de preuve ci-dessus, remplissez le rapport, puis confirmez la réalisation"
                  : "Ajoutez une photo de preuve ci-dessus, remplissez le rapport, puis marquez l'intervention comme réalisée"}
              </Text>

              <Pressable
                onPress={handleMarkRealise}
                disabled={isUploadingCompletion || !report.trim()}
                style={({ pressed }) => [
                  styles.doneBtn,
                  pressed && { opacity: 0.85 },
                  (isUploadingCompletion || !report.trim()) && { opacity: 0.7 },
                ]}
              >
                {isUploadingCompletion ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <Text style={styles.doneBtnText}>
                      {intervention.category === "nettoyage"
                        ? localCompletionPhotos.length > 0
                          ? `Confirmer le nettoyage (${localCompletionPhotos.length} photo${
                              localCompletionPhotos.length > 1 ? "s" : ""
                            })`
                          : "Confirmer le nettoyage"
                        : localCompletionPhotos.length > 0
                        ? `Marquer réalisée (${localCompletionPhotos.length} photo${
                            localCompletionPhotos.length > 1 ? "s" : ""
                          })`
                        : "Marquer comme réalisée"}
                    </Text>
                  </>
                )}
              </Pressable>

              {!report.trim() && (
                <Text style={styles.mandatoryHint}>
                  Le rapport d’intervention est obligatoire avant validation.
                </Text>
              )}
            </>
          ) : intervention.status === "planifie" && isAdmin ? (
            <>
              <Text style={styles.ratingTitle}>En attente du prestataire</Text>
              <Text style={styles.ratingHint}>
                Le prestataire devra ajouter un rapport puis marquer cette
                intervention comme réalisée.
              </Text>
            </>
          ) : intervention.status === "en_cours" && isAdmin ? (
            <>
              <Text style={styles.ratingTitle}>Réalisée — à valider</Text>
              <Text style={styles.ratingHint}>
                Le prestataire a transmis un rapport et marqué cette intervention
                comme réalisée. Vérifiez et validez si le travail est correct.
              </Text>

              <Pressable
                onPress={handleValidate}
                disabled={isUploadingCompletion}
                style={({ pressed }) => [
                  styles.doneBtn,
                  { backgroundColor: COLORS.success },
                  pressed && { opacity: 0.85 },
                  isUploadingCompletion && { opacity: 0.7 },
                ]}
              >
                {isUploadingCompletion ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="shield-checkmark" size={18} color="#fff" />
                    <Text style={styles.doneBtnText}>Valider l'intervention</Text>
                  </>
                )}
              </Pressable>
            </>
          ) : intervention.status === "en_cours" && isPrestataire ? (
            <>
              <Text style={styles.ratingTitle}>En attente de validation</Text>
              <Text style={styles.ratingHint}>
                Vous avez transmis votre rapport. Le syndic va vérifier et valider
                le travail.
              </Text>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  heroGradient: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },

  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingVertical: 4,
  },

  backIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(255,100,100,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },

  heroBadges: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },

  heroTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#fff",
    lineHeight: 30,
  },

  createdByRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },

  createdByText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.4)",
  },

  proofBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(16,185,129,0.15)",
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
  },

  proofBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#10B981",
  },

  scroll: { flex: 1 },

  content: {
    padding: 16,
    gap: 14,
  },

  photoSection: { gap: 8 },

  sectionLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  photoScroll: {},

  photo: {
    width: 200,
    height: 150,
    borderRadius: 14,
    marginRight: 10,
  },

  photoZoomHint: {
    position: "absolute",
    bottom: 8,
    right: 18,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    padding: 4,
  },

  completionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },

  completionCardDone: {
    borderColor: "rgba(16,185,129,0.35)",
    backgroundColor: "rgba(16,185,129,0.04)",
  },

  completionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  completionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },

  completionIconWrapDone: {
    backgroundColor: "rgba(16,185,129,0.12)",
  },

  completionTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    marginBottom: 3,
  },

  completionSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 17,
  },

  completionScroll: { marginHorizontal: -4 },

  completionThumbWrap: {
    position: "relative",
    marginHorizontal: 4,
  },

  completionThumb: {
    width: 110,
    height: 90,
    borderRadius: 12,
  },

  thumbRemove: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 12,
  },

  thumbSaved: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 12,
    padding: 1,
  },

  completionActions: {
    flexDirection: "row",
    gap: 10,
  },

  completionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },

  completionBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.primary,
  },

  saveProofBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 12,
  },

  saveProofBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  infoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  infoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },

  infoLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },

  infoValue: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
    textTransform: "capitalize",
  },

  descCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  descTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },

  descText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 22,
  },

  shareCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  shareCardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },

  shareCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },

  shareCardTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    marginBottom: 3,
  },

  shareCardText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 19,
  },

  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
  },

  shareBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  reportCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  reportTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },

  reportTitleSecondary: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  reportHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    lineHeight: 18,
  },

  reportInput: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
  },

  reportTextarea: {
    minHeight: 120,
  },

  reportTextareaSmall: {
    minHeight: 90,
  },

  reportDisplayCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  reportDisplayTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },

  reportDisplayTitleSecondary: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  reportDisplayText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 21,
  },

  ratingCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  ratingTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  starsRow: {
    paddingVertical: 8,
  },

  ratingFeedback: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.textSecondary,
  },

  ratingHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    textAlign: "center",
  },

  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.success,
    borderRadius: 12,
  },

  doneBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  mandatoryHint: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: COLORS.danger,
    textAlign: "center",
  },

  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.background,
    gap: 12,
  },

  notFoundText: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary,
  },

  backBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
  },

  backBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  checklistCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  checklistCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },

  checklistCardIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(14,186,170,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },

  checklistCardTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  checklistCardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    marginTop: 1,
  },

  checklistCardGroup: {
    marginTop: 8,
  },

  checklistCardGroupLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  checklistCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  checklistCardAreaLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
    flex: 1,
  },

  checklistCardAreaDone: {
    color: COLORS.textMuted,
    textDecorationLine: "line-through",
  },

  checklistLegacyWrap: {
    gap: 4,
  },

  checklistCardHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    textAlign: "center",
    marginTop: 10,
  },
});