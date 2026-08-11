import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
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
import { useInterventions } from "@/context/InterventionsContext";
import { useCoPro } from "@/context/CoProContext";
import { uploadPhoto } from "@/lib/storage";
import { CleaningArea, generateCleaningAreas } from "@/shared/types";
import { wa, wConfirm } from "@/shared/dialogs";
import { getApiUrl, apiRequest } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Entretien, ENTRETIEN_EQUIPEMENT_LABELS, ENTRETIEN_PERIODICITE_DAYS } from "@/shared/types";

function calcNextDateForCarnet(lastVisit: string, periodicite: string): string {
  const days = (ENTRETIEN_PERIODICITE_DAYS as Record<string, number>)[periodicite] ?? 365;
  const d = new Date(lastVisit);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

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
  categoryInviteCode?: string;
  guestWebUrl?: string;
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
    (params.guestWebUrl ? `Accès direct : ${params.guestWebUrl}\n\n` : "") +
    (params.categoryInviteCode ? `Code prestation : ${params.categoryInviteCode}\n` : "") +
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
  const { user } = useAuth();

  const isAdmin = currentRole === "admin";
  const isPrestataire = currentRole === "prestataire";
  const isProprietaire = currentRole === "propriétaire";
  const canDelete = isAdmin;

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom + 16;

  const intervention = getIntervention(id ?? "");

  const [isSaving, setIsSaving] = useState(false);
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState(intervention?.amount !== undefined ? String(intervention.amount) : "");
  const [amountEditing, setAmountEditing] = useState(false);
  const [amountSaving, setAmountSaving] = useState(false);
  const [isUploadingCompletion, setIsUploadingCompletion] = useState(false);
  const [localCompletionPhotos, setLocalCompletionPhotos] = useState<string[]>([]);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [localChecklist, setLocalChecklist] = useState<Record<string, boolean>>(
    intervention?.cleaningChecklist ?? {}
  );
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [isSharingGuestInvite, setIsSharingGuestInvite] = useState(false);
  const [isRespondingProvider, setIsRespondingProvider] = useState(false);

  // Carnet d'entretien — enregistrement après validation admin
  const [carnetModalVisible, setCarnetModalVisible] = useState(false);
  const [carnetEntretiens, setCarnetEntretiens] = useState<Entretien[]>([]);
  const [carnetSelectedId, setCarnetSelectedId] = useState<string | null>(null);
  const [carnetLoading, setCarnetLoading] = useState(false);
  const [carnetSaving, setCarnetSaving] = useState(false);
  const [carnetDone, setCarnetDone] = useState(!!(intervention as any)?.linkedEntretienId);

  const [report, setReport] = useState(intervention?.interventionReport ?? "");
  const [remaining, setRemaining] = useState(
    intervention?.interventionRemaining ?? ""
  );

  const openViewer = (urls: string[], idx: number) => {
    setViewerPhotos(urls);
    setViewerIndex(idx);
  };

  // ─── Carnet d'entretien ────────────────────────────────────────────────────

  const openCarnetModal = async () => {
    if (!currentCopro || !intervention) return;
    setCarnetLoading(true);
    try {
      const snap = await getDocs(collection(db, "copros", currentCopro.id, "entretiens"));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Entretien));
      // Filtre par catégorie correspondante (ex: "ascenseur", "vmc"…)
      const filtered = all.filter((e) => e.equipement === (intervention as any).category);
      const list = filtered.length > 0 ? filtered : all;
      setCarnetEntretiens(list);
      // Sélection automatique si un seul équipement correspond
      setCarnetSelectedId(list.length === 1 ? list[0].id : null);
      setCarnetModalVisible(true);
    } catch {
      wa("Erreur", "Impossible de charger le carnet d'entretien.");
    } finally {
      setCarnetLoading(false);
    }
  };

  const handleSaveToCarnet = async () => {
    if (!currentCopro || !carnetSelectedId || !user || !intervention) return;
    setCarnetSaving(true);
    try {
      const entretienRef = doc(db, "copros", currentCopro.id, "entretiens", carnetSelectedId);
      const entretienSnap = await getDoc(entretienRef);
      if (!entretienSnap.exists()) throw new Error("Équipement introuvable dans le carnet.");
      const data = entretienSnap.data();

      const visitDate =
        ((intervention as any).date as string | undefined)?.split("T")[0] ??
        new Date().toISOString().split("T")[0];

      const visitId = `visit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newVisit = {
        id: visitId,
        date: visitDate,
        technicianName:
          (intervention as any).assignedToName ||
          (intervention as any).technician ||
          undefined,
        notes: (intervention as any).interventionReport || undefined,
        addedBy: user.uid,
        addedByName: user.displayName || user.email || "—",
        createdAt: new Date().toISOString(),
      };

      const updatedVisits = [...(data.visits ?? []), newVisit];
      const nextVisitDate = calcNextDateForCarnet(visitDate, data.periodicite);

      await updateDoc(entretienRef, {
        visits: updatedVisits,
        lastVisitDate: visitDate,
        nextVisitDate,
        updatedAt: new Date().toISOString(),
      });

      // Marque l'intervention comme liée (anti-doublon)
      await updateIntervention(intervention.id, {
        linkedEntretienId: carnetSelectedId,
      } as any);

      setCarnetDone(true);
      setCarnetModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      wa("Erreur", e.message || "Impossible d'enregistrer dans le carnet.");
    } finally {
      setCarnetSaving(false);
    }
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
    // Seul le prestataire peut cocher/décocher (attestation de travail), et uniquement avant validation
    if (!intervention || !isPrestataire || intervention.status !== "planifie") return;

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
      wa("Erreur", "Impossible de mettre à jour la checklist.");
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
  const currentProviderMode = (intervention as any).providerMode;
  const providerStatus: "pending" | "accepted" | "refused" | undefined =
    (intervention as any).providerStatus;
  const isExternalProvider = currentProviderMode === "new";

  const isGuestUrgentIntervention =
    isAdmin && isExternalProvider && !!invitedProvider?.email;

  const canRespondAsProvider =
    isPrestataire &&
    isExternalProvider &&
    intervention.status === "planifie" &&
    providerStatus !== "accepted" &&
    providerStatus !== "refused";

  const uploadAndSavePhotos = async (): Promise<{ urls: string[]; failed: number }> => {
    if (localCompletionPhotos.length === 0) return { urls: [], failed: 0 };

    if (!currentCopro?.id) {
      throw new Error("Copropriété introuvable.");
    }

    setIsUploadingCompletion(true);

    try {
      const urls: string[] = [];
      let failed = 0;

      for (const uri of localCompletionPhotos) {
        try {
          const url = await uploadPhoto(currentCopro.id, intervention.id, uri);
          urls.push(url);
        } catch (e) {
          console.error("Photo upload error:", e);
          failed++;
        }
      }

      return { urls, failed };
    } finally {
      setIsUploadingCompletion(false);
    }
  };

  const handleSavePhotosOnly = async () => {
    if (localCompletionPhotos.length === 0) return;

    if (!currentCopro?.id) {
      wa("Copropriété manquante", "Impossible d'envoyer les photos sans copropriété active.");
      return;
    }

    try {
      setIsUploadingCompletion(true);

      const uploaded: string[] = [];
      let failed = 0;

      for (const uri of localCompletionPhotos) {
        try {
          const url = await uploadPhoto(currentCopro.id, intervention.id, uri);
          uploaded.push(url);
        } catch (e) {
          console.error("Photo upload error:", e);
          failed++;
        }
      }

      if (uploaded.length > 0) {
        const existing = intervention.completionPhotos ?? [];
        await updateIntervention(intervention.id, {
          completionPhotos: [...existing, ...uploaded],
        } as any);
        setLocalCompletionPhotos([]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      if (failed > 0) {
        wa("Photos partielles", `${failed} photo${failed > 1 ? "s" : ""} n'ont pas pu être envoyée${failed > 1 ? "s" : ""}. Réessayez.`);
      }
    } catch (e: any) {
      console.error("SAVE COMPLETION PHOTOS ERROR:", e);
      wa("Erreur", e?.message || "Impossible d'enregistrer les photos. Vérifiez votre connexion.");
    } finally {
      setIsUploadingCompletion(false);
    }
  };

  // Haversine distance in metres between two GPS points
  const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6_371_000;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  // Capture GPS and validate proximity to copro, then open camera
  const takeCompletionPhoto = async () => {
    if (remainingSlots <= 0) return;

    if (Platform.OS === "web") {
      // Web: fall back to gallery (no camera API)
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        wa("Permission refusée", "L'accès aux photos est nécessaire.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"] as any,
        allowsMultipleSelection: false,
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setLocalCompletionPhotos((prev) => [...prev, result.assets[0].uri].slice(0, maxCompletionPhotos));
      }
      return;
    }

    // Step 1 — GPS check
    setLocationWarning(null);
    try {
      const locPerm = await Location.requestForegroundPermissionsAsync();
      if (locPerm.granted && currentCopro?.latitude && currentCopro?.longitude) {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const dist = haversineDistance(
          pos.coords.latitude, pos.coords.longitude,
          currentCopro.latitude, currentCopro.longitude,
        );
        const threshold = currentCopro.locationRadius ?? 500;
        if (dist > threshold) {
          const distStr = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
          setLocationWarning(`Photo prise à ${distStr} du bien (seuil : ${threshold} m) — vérification requise`);
        }
      }
    } catch { /* GPS non disponible — on continue quand même */ }

    // Step 2 — Camera
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (!camPerm.granted) {
      wa("Permission refusée", "L'accès à la caméra est nécessaire pour les photos de preuve sur site.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"] as any,
      allowsEditing: false,
      quality: 0.85,
      exif: false,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setLocalCompletionPhotos((prev) => [...prev, result.assets[0].uri].slice(0, maxCompletionPhotos));
    }
  };

  const handleMarkRealise = async () => {
    if (!report.trim()) {
      wa("Rapport requis", "Veuillez remplir le rapport d’intervention avant de valider.");
      return;
    }

    try {
      const { urls: uploaded, failed } = await uploadAndSavePhotos();
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

      // Push → notifie l’admin qu’un rapport est à valider
      apiRequest("POST", "/api/notify-intervention-report", {
        coProId: currentCopro?.id,
        coProName: currentCopro?.name,
        title: intervention.title,
        providerName: user?.displayName ?? "Le prestataire",
      }).catch(() => {});

      setLocalCompletionPhotos([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (failed > 0) {
        wa("Rapport envoyé", `Le rapport a été enregistré mais ${failed} photo${failed > 1 ? "s" : ""} n’ont pas pu être envoyée${failed > 1 ? "s" : ""}. Vous pouvez les ajouter depuis la fiche.`);
      }

      router.back();
    } catch {
      wa("Erreur", "Impossible de mettre à jour l’intervention. Vérifiez votre connexion.");
    }
  };

  const handleValidate = async () => {
    if (!intervention.interventionReport && !report.trim()) {
      wa("Rapport manquant", "Le prestataire doit remplir le rapport d’intervention avant validation.");
      return;
    }

    try {
      const { urls: uploaded, failed } = await uploadAndSavePhotos();
      const existing = intervention.completionPhotos ?? [];

      const updates: Record<string, any> = {
        status: "termine",
        ...(uploaded.length > 0
          ? { completionPhotos: [...existing, ...uploaded] }
          : {}),
      };

      await updateIntervention(intervention.id, updates as any);

      // Push → notifie tous les membres que l’intervention est terminée
      apiRequest("POST", "/api/notify-intervention-done", {
        coProId: currentCopro?.id,
        coProName: currentCopro?.name,
        title: intervention.title,
        category: intervention.category,
      }).catch(() => {});

      setLocalCompletionPhotos([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (failed > 0) {
        wa("Intervention validée", `Validée, mais ${failed} photo${failed > 1 ? "s" : ""} n’ont pas pu être envoyée${failed > 1 ? "s" : ""}. Vous pouvez les ajouter depuis la fiche.`);
      }

      router.back();
    } catch {
      wa("Erreur", "Impossible de valider l’intervention. Vérifiez votre connexion.");
    }
  };

  const handleProviderRespond = async (status: "accepted" | "refused") => {
    setIsRespondingProvider(true);
    try {
      await updateIntervention(intervention.id, {
        providerStatus: status,
        providerStatusAt: new Date().toISOString(),
      } as any);

      // Push → notifie l'admin de la réponse du prestataire
      apiRequest("POST", "/api/notify-provider-response", {
        coProId: currentCopro?.id,
        coProName: currentCopro?.name,
        title: intervention.title,
        providerName: user?.displayName ?? "Le prestataire",
        status,
      }).catch(() => {});

      const msg =
        status === "accepted"
          ? "Vous avez accepté cette intervention. L'admin en est informé."
          : "Vous avez refusé cette intervention. L'admin pourra la réattribuer.";
      wa(status === "accepted" ? "Intervention acceptée" : "Intervention refusée", msg);
    } catch {
      wa("Erreur", "Impossible d'enregistrer votre réponse.");
    } finally {
      setIsRespondingProvider(false);
    }
  };

  const handleSaveAmount = async () => {
    const v = parseFloat(amountInput.replace(",", "."));
    if (isNaN(v) || v <= 0) {
      wa("Montant invalide", "Entrez un nombre positif.");
      return;
    }
    setAmountSaving(true);
    try {
      await updateIntervention(intervention.id, {
        amount: v,
        amountSetAt: new Date().toISOString(),
      } as any);
      setAmountEditing(false);
    } catch { /* ignore */ }
    finally { setAmountSaving(false); }
  };

  const handleDelete = () => {
    if (intervention.amount !== undefined) {
      wa("Suppression impossible", "Cette intervention a un montant enregistré (trace financière). La suppression est bloquée.");
      return;
    }
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
        wa("Erreur", msg);
      }
    };

    if (hasGroup) {
      if (Platform.OS === "web") {
        if (!window.confirm("Supprimer cette intervention ?")) return;
        const deleteAll = window.confirm(
          "Supprimer toute la série récurrente ?\n\nOK → toute la série\nAnnuler → uniquement celle-ci"
        );
        doDelete(deleteAll);
      } else {
        Alert.alert(
          "Supprimer",
          "Cette intervention fait partie d'une série récurrente. Que souhaitez-vous supprimer ?",
          [
            { text: "Annuler", style: "cancel" },
            { text: "Celle-ci uniquement", onPress: () => doDelete(false) },
            { text: "Toute la série", style: "destructive", onPress: () => doDelete(true) },
          ]
        );
      }
    } else {
      wConfirm("Supprimer", "Voulez-vous supprimer cette intervention ?", () => doDelete(false), "Supprimer");
    }
  };

  const handleResendGuestEmail = async () => {
    if (!currentCopro?.id) {
      wa("Erreur", "Aucune copropriété active.");
      return;
    }
    if (!invitedProvider?.email) {
      wa("Erreur", "Aucun prestataire invité associé à cette intervention.");
      return;
    }
    try {
      setIsSharingGuestInvite(true);
      const apiBase = getApiUrl();
      const res = await fetch(`${apiBase}/api/guest-access/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coProId: currentCopro.id, interventionId: intervention.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur serveur");
      wa("Mail envoyé", `L’invitation a été renvoyée à ${invitedProvider.email}.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      wa("Erreur", e.message || "Le mail n’a pas pu être envoyé.");
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
            {isAdmin && intervention.status !== "termine" && (
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
                style={({ pressed }) => [styles.completionBtn, { flex: 1 }, pressed && { opacity: 0.8 }]}
                onPress={takeCompletionPhoto}
              >
                <Ionicons name="camera-outline" size={18} color={COLORS.primary} />
                <Text style={styles.completionBtnText}>Prendre une photo sur site</Text>
              </Pressable>
            </View>
          )}
          {locationWarning && (
            <View style={styles.locationWarning}>
              <Ionicons name="location-outline" size={14} color="#D97706" />
              <Text style={styles.locationWarningText}>{locationWarning}</Text>
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
                <Ionicons name="person-outline" size={18} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.shareCardTitle}>Prestataire externe</Text>
                <Text style={styles.shareCardText}>
                  {invitedProvider?.firstName} {invitedProvider?.lastName}
                  {invitedProvider?.email ? ` · ${invitedProvider.email}` : ""}
                </Text>
              </View>
            </View>

            {/* Badge refus uniquement — si refusé, alerte claire */}
            {providerStatus === "refused" && (
              <View style={[styles.providerStatusBadge, styles.providerStatusRefused]}>
                <Ionicons name="close-circle" size={16} color={COLORS.danger} />
                <Text style={[styles.providerStatusText, { color: COLORS.danger }]}>
                  Mission refusée par le prestataire
                </Text>
              </View>
            )}

            {/* Réattribuer si refusé */}
            {providerStatus === "refused" && (
              <Pressable
                onPress={() => router.push(`/add?editId=${intervention.id}&reassign=1` as any)}
                style={({ pressed }) => [styles.reassignBtn, pressed && { opacity: 0.85 }]}
              >
                <Ionicons name="swap-horizontal-outline" size={18} color="#fff" />
                <Text style={styles.reassignBtnText}>Réattribuer à un autre prestataire</Text>
              </Pressable>
            )}

            {/* Renvoyer le mail d’invitation */}
            <Pressable
              onPress={handleResendGuestEmail}
              disabled={isSharingGuestInvite}
              style={({ pressed }) => [
                styles.shareBtnSecondary,
                pressed && { opacity: 0.85 },
                isSharingGuestInvite && { opacity: 0.65 },
              ]}
            >
              {isSharingGuestInvite ? (
                <ActivityIndicator color={COLORS.primary} size="small" />
              ) : (
                <>
                  <Ionicons name="mail-outline" size={16} color={COLORS.primary} />
                  <Text style={styles.shareBtnSecondaryText}>Renvoyer le mail</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Boutons accepter / refuser pour le prestataire */}
        {canRespondAsProvider && (
          <View style={styles.respondCard}>
            <View style={styles.respondCardHeader}>
              <Ionicons name="help-circle-outline" size={20} color={COLORS.primary} />
              <Text style={styles.respondCardTitle}>Confirmer votre intervention</Text>
            </View>
            <Text style={styles.respondCardText}>
              Pouvez-vous intervenir pour cette mission ? Votre réponse sera transmise à l'admin.
            </Text>
            <View style={styles.respondBtns}>
              <Pressable
                onPress={() => handleProviderRespond("refused")}
                disabled={isRespondingProvider}
                style={({ pressed }) => [styles.refuseBtn, pressed && { opacity: 0.85 }, isRespondingProvider && { opacity: 0.6 }]}
              >
                <Ionicons name="close-outline" size={18} color={COLORS.danger} />
                <Text style={styles.refuseBtnText}>Refuser</Text>
              </Pressable>
              <Pressable
                onPress={() => handleProviderRespond("accepted")}
                disabled={isRespondingProvider}
                style={({ pressed }) => [styles.acceptBtn, pressed && { opacity: 0.85 }, isRespondingProvider && { opacity: 0.6 }]}
              >
                {isRespondingProvider
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="checkmark-outline" size={18} color="#fff" />
                      <Text style={styles.acceptBtnText}>Accepter</Text>
                    </>
                }
              </Pressable>
            </View>
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
                      {Object.values(localChecklist).filter(Boolean).length} / {cleaningAreas.length} zones effectuées
                      {isPrestataire && intervention.status === "planifie" ? " · Cochez ce que vous avez fait" : ""}
                    </Text>
                  )}
                </View>

                {savingChecklist && (
                  <ActivityIndicator size="small" color={COLORS.teal} />
                )}
              </View>

              {isPrestataire && intervention.status === "planifie" && groupedCleaningAreas.length > 0 && (
                <Text style={[styles.checklistCardHint, { marginBottom: 12, color: COLORS.teal }]}>
                  Cochez chaque zone que vous avez nettoyée — enregistrement automatique
                </Text>
              )}

              {groupedCleaningAreas.length > 0 ? (
                groupedCleaningAreas.map(([group, areas]) => (
                  <View key={group} style={styles.checklistCardGroup}>
                    <Text style={styles.checklistCardGroupLabel}>{group}</Text>
                    {areas.map((area) => {
                      const checked = localChecklist[area.id] === true;
                      const canEdit = isPrestataire && intervention.status === "planifie";

                      return (
                        <Pressable
                          key={area.id}
                          style={[styles.checklistCardRow, !checked && { opacity: 0.6 }]}
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
                            <Ionicons name="checkmark" size={14} color={COLORS.teal} style={{ marginLeft: "auto" }} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              ) : (
                <View style={styles.checklistLegacyWrap}>
                  {Object.entries(localChecklist).map(([key, done]) => (
                    <View key={key} style={[styles.checklistCardRow, !done && { opacity: 0.55 }]}>
                      <Ionicons
                        name={done ? "checkbox" : "square-outline"}
                        size={18}
                        color={done ? COLORS.teal : COLORS.textMuted}
                      />
                      <Text style={[styles.checklistCardAreaLabel, !done && styles.checklistCardAreaDone]}>
                        {key}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {!isPrestataire && groupedCleaningAreas.length > 0 && (
                <Text style={styles.checklistCardHint}>
                  {intervention.status === "planifie"
                    ? "En attente du prestataire"
                    : "Zones cochées par le prestataire"}
                </Text>
              )}
            </View>
          )}

        <View style={styles.ratingCard}>
          {intervention.status === "termine" ? (
            <>
              <View style={styles.doneStatusRow}>
                <Ionicons name="checkmark-circle" size={22} color={COLORS.success} />
                <Text style={styles.doneStatusText}>Intervention terminée</Text>
              </View>
              {intervention.completionComment ? (
                <Text style={styles.completionCommentDisplay}>{intervention.completionComment}</Text>
              ) : null}
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
                Vous avez transmis votre rapport. L'admin va vérifier et valider
                le travail.
              </Text>
            </>
          ) : null}
        </View>

        {/* Carnet d'entretien — admin uniquement, après validation */}
        {isAdmin && intervention.status === "termine" && (
          <View style={styles.carnetCard}>
            {carnetDone ? (
              <View style={styles.carnetDoneRow}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                <Text style={styles.carnetDoneText}>Enregistré dans le carnet d'entretien</Text>
              </View>
            ) : (
              <>
                <View style={styles.carnetCardHeader}>
                  <Ionicons name="clipboard-outline" size={16} color="#16A34A" />
                  <Text style={styles.carnetCardTitle}>Carnet d'entretien</Text>
                </View>
                <Text style={styles.carnetCardHint}>
                  Enregistrez ce passage dans le carnet pour mettre à jour la date du prochain entretien.
                </Text>
                <Pressable
                  style={styles.carnetBtn}
                  onPress={openCarnetModal}
                  disabled={carnetLoading}
                >
                  {carnetLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="add-circle-outline" size={16} color="#fff" />
                      <Text style={styles.carnetBtnText}>Enregistrer dans le carnet</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </View>
        )}

        {/* Modal carnet d'entretien */}
        <Modal
          visible={carnetModalVisible}
          animationType="slide"
          presentationStyle="formSheet"
          onRequestClose={() => setCarnetModalVisible(false)}
        >
          <View style={styles.carnetModalRoot}>
            <View style={styles.carnetModalHeader}>
              <Pressable
                onPress={() => setCarnetModalVisible(false)}
                style={styles.carnetModalClose}
              >
                <Ionicons name="close" size={20} color={COLORS.text} />
              </Pressable>
              <Text style={styles.carnetModalTitle}>Carnet d'entretien</Text>
              <Pressable
                style={[styles.carnetModalSave, (!carnetSelectedId || carnetSaving) && { opacity: 0.4 }]}
                onPress={handleSaveToCarnet}
                disabled={!carnetSelectedId || carnetSaving}
              >
                {carnetSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.carnetModalSaveText}>Valider</Text>
                )}
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.carnetModalBody}>
              <Text style={styles.carnetModalHint}>
                Sélectionnez l'équipement correspondant à cette intervention :
              </Text>

              {carnetEntretiens.length === 0 ? (
                <View style={styles.carnetEmpty}>
                  <Ionicons name="clipboard-outline" size={36} color={COLORS.border} />
                  <Text style={styles.carnetEmptyText}>
                    Aucun équipement dans le carnet.{"\n"}
                    Ajoutez-en un depuis Menu → Carnet d'entretien.
                  </Text>
                </View>
              ) : (
                carnetEntretiens.map((e) => {
                  const selected = carnetSelectedId === e.id;
                  const lastVisit = e.lastVisitDate
                    ? new Date(e.lastVisitDate).toLocaleDateString("fr-FR")
                    : "Jamais";
                  return (
                    <Pressable
                      key={e.id}
                      style={[styles.carnetItem, selected && styles.carnetItemActive]}
                      onPress={() => setCarnetSelectedId(e.id)}
                    >
                      <Ionicons
                        name={selected ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={selected ? COLORS.primary : COLORS.border}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.carnetItemLabel, selected && { color: COLORS.primary }]}>
                          {e.label}
                        </Text>
                        <Text style={styles.carnetItemSub}>
                          {ENTRETIEN_EQUIPEMENT_LABELS[e.equipement]} · Dernier : {lastVisit}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}

              {/* Aperçu de la visite qui sera créée */}
              {carnetSelectedId && (
                <View style={styles.carnetVisitPreview}>
                  <Text style={styles.carnetVisitPreviewTitle}>Visite qui sera créée</Text>
                  <Text style={styles.carnetVisitPreviewRow}>
                    📅 {((intervention as any).date as string | undefined)?.split("T")[0] ?? "Aujourd'hui"}
                  </Text>
                  {(intervention as any).assignedToName ? (
                    <Text style={styles.carnetVisitPreviewRow}>
                      👷 {(intervention as any).assignedToName}
                    </Text>
                  ) : null}
                  {(intervention as any).interventionReport ? (
                    <Text style={styles.carnetVisitPreviewRow} numberOfLines={2}>
                      📝 {(intervention as any).interventionReport}
                    </Text>
                  ) : null}
                </View>
              )}
            </ScrollView>
          </View>
        </Modal>

        {/* Montant de l'intervention — visible admin et conseil uniquement */}
        {(isAdmin || currentRole === "conseil") && intervention.status === "termine" && (
          <View style={styles.amountCard}>
            <View style={styles.amountCardHeader}>
              <Ionicons name="wallet-outline" size={18} color="#0891B2" />
              <Text style={styles.amountCardTitle}>Montant de l'intervention</Text>
              {isAdmin && !amountEditing && (
                <Pressable style={styles.amountEditBtn} onPress={() => setAmountEditing(true)}>
                  <Ionicons name="create-outline" size={16} color="#0891B2" />
                  <Text style={styles.amountEditText}>{intervention.amount !== undefined ? "Modifier" : "Saisir"}</Text>
                </Pressable>
              )}
            </View>

            {amountEditing ? (
              <View style={styles.amountInputRow}>
                <TextInput
                  style={styles.amountInput}
                  value={amountInput}
                  onChangeText={setAmountInput}
                  placeholder="0,00"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="decimal-pad"
                  autoFocus
                />
                <Text style={styles.amountEuro}>€</Text>
                <Pressable style={styles.amountSaveBtn} onPress={handleSaveAmount} disabled={amountSaving}>
                  {amountSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.amountSaveBtnText}>Enregistrer</Text>}
                </Pressable>
                <Pressable onPress={() => { setAmountEditing(false); setAmountInput(intervention.amount !== undefined ? String(intervention.amount) : ""); }}>
                  <Text style={styles.amountCancel}>Annuler</Text>
                </Pressable>
              </View>
            ) : intervention.amount !== undefined ? (
              <Text style={styles.amountValue}>
                {intervention.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
              </Text>
            ) : (
              <Text style={styles.amountPlaceholder}>
                {isAdmin ? "Aucun montant saisi — appuyez sur Saisir" : "Montant non encore renseigné par l'admin"}
              </Text>
            )}

            {intervention.amount !== undefined && (
              <Text style={styles.amountLockNote}>
                🔒 Une fois le montant enregistré, l'intervention ne peut plus être supprimée.
              </Text>
            )}
          </View>
        )}
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

  shareBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  shareBtnSecondaryText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.primary,
  },

  providerStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  providerStatusPending: { backgroundColor: "rgba(245,158,11,0.1)" },
  providerStatusAccepted: { backgroundColor: "rgba(16,185,129,0.1)" },
  providerStatusRefused: { backgroundColor: "rgba(239,68,68,0.1)" },
  providerStatusText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },

  reassignBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.danger,
    borderRadius: 12,
    paddingVertical: 11,
    marginBottom: 4,
  },
  reassignBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  respondCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  respondCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  respondCardTitle: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },
  respondCardText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  respondBtns: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  refuseBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    borderRadius: 12,
    paddingVertical: 11,
  },
  refuseBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.danger,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: COLORS.success,
    borderRadius: 12,
    paddingVertical: 11,
  },
  acceptBtnText: {
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

  ratingHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    textAlign: "center",
  },

  doneStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  doneStatusText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.success,
  },
  completionCommentDisplay: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    textAlign: "center",
    fontStyle: "italic",
  },

  locationWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FFFBEB",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FDE68A",
    padding: 10,
    marginTop: 8,
  },
  locationWarningText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#B45309",
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
  amountCard: {
    backgroundColor: "#F0F9FF", borderWidth: 1, borderColor: "#BAE6FD",
    borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 16,
  },
  amountCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  amountCardTitle: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#0C4A6E" },
  amountEditBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "#BAE6FD", borderRadius: 8 },
  amountEditText: { fontSize: 13, color: "#0891B2", fontFamily: "Inter_500Medium" },
  amountValue: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#0891B2" },
  amountPlaceholder: { fontSize: 13, color: "#7BA8BE", fontFamily: "Inter_400Regular", fontStyle: "italic" },
  amountInputRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  amountInput: {
    width: 120, borderWidth: 1, borderColor: "#7DD3FC", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 18,
    fontFamily: "Inter_600SemiBold", color: COLORS.text, textAlign: "right",
  },
  amountEuro: { fontSize: 18, color: "#0891B2", fontFamily: "Inter_600SemiBold" },
  amountSaveBtn: { backgroundColor: "#0891B2", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  amountSaveBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  amountCancel: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  amountLockNote: { fontSize: 11, color: "#7BA8BE", fontFamily: "Inter_400Regular", marginTop: 8 },

  // ─── Carnet d'entretien ─────────────────────────────────────────────────────
  carnetCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    gap: 10,
  },
  carnetCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  carnetCardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#15803D" },
  carnetCardHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  carnetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 12,
    paddingVertical: 11,
  },
  carnetBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  carnetDoneRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  carnetDoneText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#16A34A" },

  // Carnet modal
  carnetModalRoot: { flex: 1, backgroundColor: COLORS.background },
  carnetModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  carnetModalClose: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  carnetModalTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  carnetModalSave: {
    backgroundColor: "#16A34A", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 8,
    minWidth: 70, alignItems: "center",
  },
  carnetModalSaveText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  carnetModalBody: { padding: 16, gap: 10, paddingBottom: 48 },
  carnetModalHint: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginBottom: 4 },
  carnetEmpty: { alignItems: "center", paddingVertical: 32, gap: 10 },
  carnetEmptyText: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center", lineHeight: 20,
  },
  carnetItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: COLORS.surface, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border, padding: 14,
  },
  carnetItemActive: { borderColor: COLORS.primary, backgroundColor: "#EFF6FF" },
  carnetItemLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  carnetItemSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 2 },
  carnetVisitPreview: {
    backgroundColor: "#F0FDF4", borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: "#BBF7D0", marginTop: 4, gap: 4,
  },
  carnetVisitPreviewTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#15803D", marginBottom: 4 },
  carnetVisitPreviewRow: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.text, lineHeight: 18 },
});