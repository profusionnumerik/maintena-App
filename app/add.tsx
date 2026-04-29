import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { useInterventions } from "@/context/InterventionsContext";
import { uploadPhotoPending } from "@/lib/storage";
import PhotoViewer from "@/components/PhotoViewer";
import {
  ALL_CATEGORIES,
  Category,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  CleaningArea,
  EntryType,
  generateCleaningAreas,
  buildDefaultChecklist,
  RecurrenceType,
  Status,
  STATUS_LABELS,
} from "@/shared/types";
import { auth } from "@/lib/firebase";

const STATUS_COLORS: Record<Status, string> = {
  planifie: COLORS.warning,
  en_cours: COLORS.primary,
  termine: COLORS.success,
};

const RADIUS_DEFAULT = 300;

const WEEK_DAYS = [
  { label: "Lu", value: 1 },
  { label: "Ma", value: 2 },
  { label: "Me", value: 3 },
  { label: "Je", value: 4 },
  { label: "Ve", value: 5 },
  { label: "Sa", value: 6 },
  { label: "Di", value: 0 },
];

type ProviderMode = "existing" | "new";

type NewProviderForm = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
};

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseDDMMYYYY(str: string): Date | null {
  const parts = str.split("/");
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (!day || !month || !year || year < 2000) return null;

  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime())) return null;
  if (d.getDate() !== day || d.getMonth() !== month - 1) return null;

  return d;
}

function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

function isTodayOrFuture(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date >= today;
}

function generateRecurringDates(
  startDate: Date,
  type: RecurrenceType,
  days: number[],
  occurrences: number
): Date[] {
  const result: Date[] = [];

  if (type === "monthly") {
    for (let i = 0; i < occurrences; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      result.push(d);
    }
  } else if (type === "weekly" && days.length > 0) {
    const current = new Date(startDate);
    current.setHours(12, 0, 0, 0);

    const limit = new Date(startDate);
    limit.setFullYear(limit.getFullYear() + 2);

    while (result.length < occurrences && current < limit) {
      if (days.includes(current.getDay())) {
        result.push(new Date(current));
      }
      current.setDate(current.getDate() + 1);
    }
  }

  return result;
}

function onlyPhoneDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 10);
}

function formatFrenchPhone(value: string): string {
  const digits = onlyPhoneDigits(value);
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

function isValidFrenchPhone(value: string): boolean {
  return onlyPhoneDigits(value).length === 10;
}

function emailIsValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function fullProviderName(data: NewProviderForm): string {
  return [data.firstName, data.lastName].filter(Boolean).join(" ").trim();
}

function getMemberLabel(member: any): string {
  const fullName = [member?.firstName, member?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (fullName) return fullName;
  if (member?.displayName) return member.displayName;
  if (member?.email) return member.email;
  return "Prestataire";
}

function getAppDownloadUrl(): string {
  return process.env.EXPO_PUBLIC_APP_DOWNLOAD_URL?.trim() || "";
}

function getCategoryInviteCode(
  copro: any,
  category: Category | null | undefined
): string {
  if (!copro || !category) return "";
  const categoryCodes = copro.categoryInviteCodes ?? {};
  const value = categoryCodes[category];
  return typeof value === "string" ? value.trim() : "";
}

function getApiBaseUrl(): string {
  return process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || "";
}

async function createGuestAccess(params: {
  coProId: string;
  interventionId: string;
  invitedProvider: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    company?: string;
  };
  category: string;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Utilisateur non connecté.");
  }

  const idToken = await currentUser.getIdToken();
  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    throw new Error("EXPO_PUBLIC_API_BASE_URL manquant.");
  }

  const response = await fetch(`${apiBaseUrl}/api/guest-access/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || "Impossible de créer l’accès invité.");
  }

  return payload as {
    token: string;
    guestWebUrl: string;
    completeAccountUrl: string;
    appLink: string;
  };
}

function buildGuestShareMessage(params: {
  providerName: string;
  coproName: string;
  title: string;
  description: string;
  dateLabel: string;
  categoryLabel: string;
  categoryInviteCode: string;
  guestWebUrl: string;
  completeAccountUrl: string;
  appLink?: string;
}) {
  return (
    `Bonjour ${params.providerName},\n\n` +
    `Une intervention vous a été attribuée pour ${params.coproName}.\n\n` +
    `Intervention : ${params.title}\n` +
    `Catégorie : ${params.categoryLabel}\n` +
    `Date : ${params.dateLabel}\n` +
    `Description : ${params.description}\n\n` +
    `Code prestation : ${params.categoryInviteCode}\n\n` +
    `Accès direct web : ${params.guestWebUrl}\n\n` +
    `Finaliser votre compte Maintena : ${params.completeAccountUrl}\n` +
    (params.appLink ? `Application : ${params.appLink}\n` : "")
  );
}

export default function AddInterventionScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { addIntervention, updateIntervention, getIntervention } =
    useInterventions();
  const { currentCopro, currentRole, categoryFilter, members } = useCoPro();
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const isEditMode = !!editId;

  const isAdmin = currentRole === "admin";

  const disabledCats: Category[] = currentCopro?.disabledCategories ?? [];
  const availableCategories = ALL_CATEGORIES.filter(
    (c) => !disabledCats.includes(c)
  );

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category | null>(
    categoryFilter ?? null
  );
  const isCategoryLocked = currentRole === "prestataire" && !!categoryFilter;

  const [status, setStatus] = useState<Status>(isAdmin ? "planifie" : "termine");
  const [dateStr, setDateStr] = useState(todayDDMMYYYY());
  const [dateError, setDateError] = useState("");

  const [technicianPhone, setTechnicianPhone] = useState("");
  const [assignedToUid, setAssignedToUid] = useState<string>("");
  const [assignedToName, setAssignedToName] = useState<string>("");
  const [phoneError, setPhoneError] = useState("");

  const [providerMode, setProviderMode] = useState<ProviderMode>("existing");
  const [newProvider, setNewProvider] = useState<NewProviderForm>({
    firstName: "",
    lastName: "",
    company: "",
    email: "",
    phone: "",
  });
  const [newProviderErrors, setNewProviderErrors] = useState<
    Partial<Record<keyof NewProviderForm, string>>
  >({});

  const [localPhotos, setLocalPhotos] = useState<string[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIdx, setViewerIdx] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cleaningChecklist, setCleaningChecklist] = useState<
    Record<string, boolean>
  >({});

  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("weekly");
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceOccurrences, setRecurrenceOccurrences] = useState(12);

  const [locationStatus, setLocationStatus] = useState<
    "idle" | "checking" | "ok" | "far" | "denied" | "no-coords"
  >("idle");
  const [locationDistance, setLocationDistance] = useState<number | null>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;
  const creatorName = user?.displayName || user?.email || "Inconnu";

  useEffect(() => {
    if (isEditMode && editId) {
      const existing = getIntervention(editId);

      if (existing) {
        setTitle(existing.title);
        setDescription(existing.description);
        setCategory(existing.category);
        setStatus(existing.status);

        const d = new Date(existing.date);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        setDateStr(`${dd}/${mm}/${yyyy}`);

        if (existing.technicianPhone) {
          setTechnicianPhone(formatFrenchPhone(existing.technicianPhone));
        }

        if (existing.photos && existing.photos.length > 0) {
          setExistingPhotos(existing.photos);
        }

        if ((existing as any).assignedToUid) {
          setAssignedToUid((existing as any).assignedToUid);
        }

        if ((existing as any).assignedToName) {
          setAssignedToName((existing as any).assignedToName);
        }

        if ((existing as any).providerMode) {
          setProviderMode((existing as any).providerMode);
        }

        if ((existing as any).invitedProvider) {
          const invited = (existing as any).invitedProvider;
          setNewProvider({
            firstName: invited.firstName ?? "",
            lastName: invited.lastName ?? "",
            company: invited.company ?? "",
            email: invited.email ?? "",
            phone: formatFrenchPhone(invited.phone ?? ""),
          });
        }
      }
    }
  }, [editId, getIntervention, isEditMode]);

  useEffect(() => {
    if (isAdmin || isEditMode) {
      setLocationStatus("ok");
    } else if (currentCopro?.latitude && currentCopro?.longitude) {
      checkLocation();
    } else if (currentCopro && !currentCopro.latitude) {
      setLocationStatus("no-coords");
    } else {
      setLocationStatus("ok");
    }
  }, [currentCopro, isAdmin, isEditMode]);

  useEffect(() => {
    if (category === "nettoyage" && currentCopro?.buildingConfig) {
      setCleaningChecklist(buildDefaultChecklist(currentCopro.buildingConfig));
    } else {
      setCleaningChecklist({});
    }
  }, [category, currentCopro?.id, currentCopro?.buildingConfig]);

  useEffect(() => {
    if (!user) return;

    if (currentRole === "prestataire") {
      setAssignedToUid(user.uid);
      setAssignedToName(user.displayName || user.email || "Prestataire");
    }
  }, [currentRole, user]);

  const cleaningAreas = useMemo<CleaningArea[]>(() => {
    if (category !== "nettoyage" || !currentCopro?.buildingConfig) return [];
    return generateCleaningAreas(currentCopro.buildingConfig);
  }, [category, currentCopro?.buildingConfig]);

  const groupedCleaningAreas = useMemo<[string, CleaningArea[]][]>(() => {
    const groups: Record<string, CleaningArea[]> = {};

    cleaningAreas.forEach((area) => {
      if (!groups[area.group]) groups[area.group] = [];
      groups[area.group].push(area);
    });

    return Object.entries(groups);
  }, [cleaningAreas]);

  const availablePrestataires = useMemo(() => {
    if (!category) return [];

    return members
      .filter(
        (m: any) => m.role === "prestataire" && m.categoryFilter === category
      )
      .sort((a: any, b: any) =>
        getMemberLabel(a).localeCompare(getMemberLabel(b), "fr")
      );
  }, [members, category]);

  useEffect(() => {
    if (!category) {
      if (currentRole === "admin") {
        setAssignedToUid("");
        setAssignedToName("");
      }
      return;
    }

    if (currentRole !== "admin") return;
    if (providerMode === "new") return;

    const stillValid = availablePrestataires.some(
      (p: any) => p.uid === assignedToUid
    );

    if (!stillValid) {
      setAssignedToUid("");
      setAssignedToName("");
    }
  }, [
    category,
    currentRole,
    availablePrestataires,
    assignedToUid,
    providerMode,
  ]);

  const resetNewProviderErrors = () => {
    setNewProviderErrors({});
  };

  const validateNewProvider = (): boolean => {
    const errors: Partial<Record<keyof NewProviderForm, string>> = {};

    if (!newProvider.firstName.trim()) {
      errors.firstName = "Prénom requis";
    }

    if (!newProvider.lastName.trim()) {
      errors.lastName = "Nom requis";
    }

    if (!newProvider.email.trim()) {
      errors.email = "Email requis";
    } else if (!emailIsValid(newProvider.email)) {
      errors.email = "Email invalide";
    }

    if (!newProvider.phone.trim()) {
      errors.phone = "Téléphone requis";
    } else if (!isValidFrenchPhone(newProvider.phone)) {
      errors.phone = "Le numéro doit contenir exactement 10 chiffres";
    }

    setNewProviderErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleNewProviderChange = (
    field: keyof NewProviderForm,
    value: string
  ) => {
    setNewProvider((prev) => ({
      ...prev,
      [field]: field === "phone" ? formatFrenchPhone(value) : value,
    }));

    setNewProviderErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const checkLocation = async () => {
    if (Platform.OS === "web") {
      setLocationStatus("ok");
      return;
    }

    if (!currentCopro?.latitude || !currentCopro?.longitude) {
      setLocationStatus("no-coords");
      return;
    }

    setLocationStatus("checking");

    try {
      const { status: permStatus } =
        await Location.requestForegroundPermissionsAsync();

      if (permStatus !== "granted") {
        setLocationStatus("denied");
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const dist = haversineMeters(
        pos.coords.latitude,
        pos.coords.longitude,
        currentCopro.latitude,
        currentCopro.longitude
      );

      const radius = currentCopro.locationRadius ?? RADIUS_DEFAULT;
      setLocationDistance(Math.round(dist));
      setLocationStatus(dist <= radius ? "ok" : "far");
    } catch {
      setLocationStatus("ok");
    }
  };

  const getMaxNewPhotos = () =>
    Math.max(0, 3 - (isEditMode ? existingPhotos.length : 0));

  const pickPhoto = async () => {
    const remaining = getMaxNewPhotos() - localPhotos.length;
    if (remaining <= 0) return;

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission refusée", "L'accès aux photos est nécessaire.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsMultipleSelection: Platform.OS !== "web",
      selectionLimit: Platform.OS !== "web" ? remaining : 1,
      allowsEditing: false,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const validUris = result.assets
        .map((a) => a?.uri)
        .filter((uri): uri is string => typeof uri === "string" && uri.length > 0);

      setLocalPhotos((prev) =>
        [...prev, ...validUris].slice(0, getMaxNewPhotos())
      );
    }
  };

  const takePhoto = async () => {
    if (getMaxNewPhotos() - localPhotos.length <= 0) return;

    if (Platform.OS === "web") {
      await pickPhoto();
      return;
    }

    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission refusée", "L'accès à la caméra est nécessaire.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const uri = result.assets[0].uri;

        if (typeof uri === "string" && uri.length > 0) {
          setLocalPhotos((prev) =>
            [...prev, uri].slice(0, getMaxNewPhotos())
          );
        }
      }
    } catch {
      Alert.alert(
        "Caméra indisponible",
        "La caméra n'est pas disponible sur ce simulateur. Utilisez la galerie ou testez sur un vrai téléphone."
      );
    }
  };

  const validateDate = (str: string, allowPast = false): Date | null => {
    const d = parseDDMMYYYY(str);

    if (!d) {
      setDateError("Date invalide. Format : JJ/MM/AAAA");
      return null;
    }

    if (!allowPast && !isTodayOrFuture(d)) {
      setDateError("La date ne peut pas être antérieure à aujourd'hui");
      return null;
    }

    setDateError("");
    return d;
  };

  const handleDateChange = (text: string) => {
    const formatted = formatDateInput(text);
    setDateStr(formatted);

    if (formatted.length === 10) validateDate(formatted);
    else setDateError("");
  };

  const handlePhoneChange = (text: string) => {
    const formatted = formatFrenchPhone(text);
    setTechnicianPhone(formatted);

    if (formatted.length > 0 && !isValidFrenchPhone(formatted)) {
      setPhoneError("Le numéro doit contenir 10 chiffres");
    } else {
      setPhoneError("");
    }
  };

  const toggleDay = (day: number) => {
    Haptics.selectionAsync();
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSubmit = async () => {
    if (!currentCopro?.id) {
      Alert.alert(
        "Copropriété manquante",
        "Aucune copropriété active n'est sélectionnée."
      );
      return;
    }

    if (!title.trim()) {
      Alert.alert("Champ requis", "Veuillez saisir un titre.");
      return;
    }

    if (!category) {
      Alert.alert("Catégorie requise", "Veuillez sélectionner une catégorie.");
      return;
    }

    if (!description.trim()) {
      Alert.alert("Champ requis", "Veuillez saisir une description.");
      return;
    }

    if (isAdmin) {
      if (providerMode === "existing" && !assignedToUid) {
        Alert.alert(
          "Prestataire requis",
          "Veuillez sélectionner un prestataire existant ou choisir “Nouveau prestataire urgent”."
        );
        return;
      }

      if (providerMode === "new" && !validateNewProvider()) {
        Alert.alert(
          "Prestataire incomplet",
          "Veuillez remplir correctement les informations du nouveau prestataire."
        );
        return;
      }
    }

    const parsedDate = validateDate(dateStr, isEditMode);
    if (!parsedDate) {
      Alert.alert("Date invalide", dateError || "Vérifiez la date saisie.");
      return;
    }

    if (providerMode === "existing") {
      if (technicianPhone.trim() && !isValidFrenchPhone(technicianPhone)) {
        Alert.alert(
          "Numéro invalide",
          "Le numéro doit contenir exactement 10 chiffres."
        );
        return;
      }
    }

    if (
      recurrenceEnabled &&
      recurrenceType === "weekly" &&
      recurrenceDays.length === 0
    ) {
      Alert.alert(
        "Jours requis",
        "Sélectionnez au moins un jour de la semaine pour la récurrence."
      );
      return;
    }

    if (!isAdmin && locationStatus === "far") {
      const radius = currentCopro.locationRadius ?? RADIUS_DEFAULT;
      Alert.alert(
        "Trop loin du bâtiment",
        `Vous êtes à ${locationDistance}m de la copropriété. Vous devez être à moins de ${radius}m pour déclarer une intervention.\n\nApprochez-vous du bâtiment et réessayez.`,
        [
          { text: "Annuler", style: "cancel" },
          { text: "Revérifier ma position", onPress: checkLocation },
        ]
      );
      return;
    }

    if (!isAdmin && locationStatus === "denied") {
      Alert.alert(
        "Localisation requise",
        "Activez la localisation dans les réglages.",
        [{ text: "OK" }]
      );
      return;
    }

    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const invitedProviderName =
      providerMode === "new" ? fullProviderName(newProvider) : "";

    const finalAssignedToUid =
      isAdmin && providerMode === "existing"
        ? assignedToUid
        : !isAdmin
        ? user?.uid ?? undefined
        : undefined;

    const finalAssignedToName =
      isAdmin && providerMode === "existing"
        ? assignedToName
        : isAdmin && providerMode === "new"
        ? invitedProviderName
        : user?.displayName || user?.email || "Prestataire";

    const categoryInviteCode =
      isAdmin && providerMode === "new"
        ? getCategoryInviteCode(currentCopro, category)
        : "";

    const invitedProviderPayload =
      isAdmin && providerMode === "new"
        ? {
            firstName: newProvider.firstName.trim(),
            lastName: newProvider.lastName.trim(),
            company: newProvider.company?.trim() || "",
            email: newProvider.email.trim().toLowerCase(),
            phone: onlyPhoneDigits(newProvider.phone),
            invitedAt: new Date().toISOString(),
            invitedBy: user?.uid || "",
            invitedByName: creatorName,
            status: "pending",
            inviteCode: categoryInviteCode || "",
          }
        : undefined;

    if (isEditMode && editId) {
      parsedDate.setHours(12, 0, 0, 0);

      try {
        let newPhotoUrls: string[] = [];

        if (localPhotos.length > 0) {
          try {
            for (const uri of localPhotos) {
              if (!uri || typeof uri !== "string") continue;
              const url = await uploadPhotoPending(currentCopro.id, uri);
              newPhotoUrls.push(url);
            }
          } catch (e) {
            console.warn("Photo upload failed:", e);
            Alert.alert(
              "Photos non envoyées",
              "Les nouvelles photos n'ont pas pu être ajoutées."
            );
          }
        }

        await updateIntervention(
          editId,
          {
            title: title.trim(),
            description: description.trim(),
            category,
            status,
            date: parsedDate.toISOString(),
            technicianPhone:
              providerMode === "new"
                ? onlyPhoneDigits(newProvider.phone)
                : onlyPhoneDigits(technicianPhone) || undefined,
            assignedToUid: finalAssignedToUid,
            assignedToName: finalAssignedToName,
            providerMode: isAdmin ? providerMode : "existing",
            invitedProvider: invitedProviderPayload,
            ...(newPhotoUrls.length > 0
              ? { photos: [...existingPhotos, ...newPhotoUrls] }
              : {}),
          } as any
        );

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      } catch {
        Alert.alert("Erreur", "Impossible de modifier l'intervention.");
      } finally {
        setIsSubmitting(false);
      }

      return;
    }

    const entryType: EntryType = isAdmin ? "programmation" : "intervention";
    parsedDate.setHours(12, 0, 0, 0);

    try {
      if (recurrenceEnabled) {
        const dates = generateRecurringDates(
          parsedDate,
          recurrenceType,
          recurrenceDays,
          recurrenceOccurrences
        );

        const groupId =
          Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

        let firstCreatedInterventionId: string | null = null;

        for (let i = 0; i < dates.length; i++) {
          const createdId = await addIntervention({
            title: title.trim(),
            description: description.trim(),
            category,
            status: "planifie",
            date: dates[i].toISOString(),
            photos: [],
            entryType,
            technicianPhone:
              providerMode === "new"
                ? onlyPhoneDigits(newProvider.phone)
                : onlyPhoneDigits(technicianPhone) || undefined,
            assignedToUid: finalAssignedToUid,
            assignedToName: finalAssignedToName,
            providerMode: isAdmin ? providerMode : "existing",
            invitedProvider: invitedProviderPayload,
            recurrenceGroupId: groupId,
            recurrenceIndex: i + 1,
            recurrenceTotal: dates.length,
            locationVerified: isAdmin ? undefined : locationStatus === "ok",
            locationDistance: isAdmin
              ? undefined
              : locationDistance ?? undefined,
            cleaningChecklist:
              category === "nettoyage" &&
              Object.keys(cleaningChecklist).length > 0
                ? cleaningChecklist
                : undefined,
          } as any);

          if (!firstCreatedInterventionId) {
            firstCreatedInterventionId = createdId;
          }
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        if (
          isAdmin &&
          providerMode === "new" &&
          invitedProviderPayload &&
          firstCreatedInterventionId
        ) {
          if (!categoryInviteCode) {
            Alert.alert(
              "Planification créée",
              `${dates.length} intervention${dates.length > 1 ? "s" : ""} programmée${
                dates.length > 1 ? "s" : ""
              } avec succès.\n\nAucun code prestation n'est défini pour la catégorie ${
                category ? CATEGORY_LABELS[category] : ""
              }.`
            );
            router.replace(`/intervention/${firstCreatedInterventionId}` as any);
          } else {
            try {
              const access = await createGuestAccess({
                coProId: currentCopro.id,
                interventionId: firstCreatedInterventionId,
                invitedProvider: {
                  firstName: newProvider.firstName.trim(),
                  lastName: newProvider.lastName.trim(),
                  email: newProvider.email.trim().toLowerCase(),
                  phone: onlyPhoneDigits(newProvider.phone),
                  company: newProvider.company?.trim() || "",
                },
                category: category || "",
              });

              const message = buildGuestShareMessage({
                providerName: fullProviderName(newProvider) || "Prestataire",
                coproName: currentCopro?.name || "Copropriété",
                title: title.trim(),
                description: description.trim(),
                dateLabel: new Date(dates[0]).toLocaleDateString("fr-FR"),
                categoryLabel: category ? CATEGORY_LABELS[category] : "Prestation",
                categoryInviteCode,
                guestWebUrl: access.guestWebUrl,
                completeAccountUrl: access.completeAccountUrl,
                appLink: access.appLink || getAppDownloadUrl(),
              });

              await Share.share({
                title: "Partager l’intervention",
                message,
              });
            } catch (e) {
              console.error("Guest access create/share failed:", e);
            }

            router.replace(`/intervention/${firstCreatedInterventionId}` as any);
          }
        } else {
          Alert.alert(
            "Planification créée",
            `${dates.length} intervention${dates.length > 1 ? "s" : ""} programmée${
              dates.length > 1 ? "s" : ""
            } avec succès.`,
            [{ text: "OK", onPress: () => router.back() }]
          );
        }
      } else {
        let photoUrls: string[] = [];

        if (localPhotos.length > 0) {
          try {
            for (const uri of localPhotos) {
              if (!uri || typeof uri !== "string") continue;
              const url = await uploadPhotoPending(currentCopro.id, uri);
              photoUrls.push(url);
            }
          } catch (uploadErr) {
            console.warn("Photo upload failed:", uploadErr);
            Alert.alert(
              "Photos non envoyées",
              "L'intervention sera enregistrée sans les photos. Vous pourrez les ajouter depuis le détail."
            );
            photoUrls = [];
          }
        }

        const createdInterventionId = await addIntervention({
          title: title.trim(),
          description: description.trim(),
          category,
          status,
          date: parsedDate.toISOString(),
          photos: photoUrls,
          entryType,
          technicianPhone:
            providerMode === "new"
              ? onlyPhoneDigits(newProvider.phone)
              : onlyPhoneDigits(technicianPhone) || undefined,
          assignedToUid: finalAssignedToUid,
          assignedToName: finalAssignedToName,
          providerMode: isAdmin ? providerMode : "existing",
          invitedProvider: invitedProviderPayload,
          locationVerified: isAdmin ? undefined : locationStatus === "ok",
          locationDistance: isAdmin
            ? undefined
            : locationDistance ?? undefined,
          cleaningChecklist:
            category === "nettoyage" &&
            Object.keys(cleaningChecklist).length > 0
              ? cleaningChecklist
              : undefined,
        } as any);

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        if (isAdmin && providerMode === "new" && invitedProviderPayload) {
          if (!categoryInviteCode) {
            Alert.alert(
              "Intervention créée",
              `L’intervention a bien été créée.\n\nAucun code prestation n'est défini pour la catégorie ${
                category ? CATEGORY_LABELS[category] : ""
              }.`,
              [
                {
                  text: "Ouvrir la fiche",
                  onPress: () =>
                    router.replace(`/intervention/${createdInterventionId}` as any),
                },
              ]
            );
          } else {
            try {
              const access = await createGuestAccess({
                coProId: currentCopro.id,
                interventionId: createdInterventionId,
                invitedProvider: {
                  firstName: newProvider.firstName.trim(),
                  lastName: newProvider.lastName.trim(),
                  email: newProvider.email.trim().toLowerCase(),
                  phone: onlyPhoneDigits(newProvider.phone),
                  company: newProvider.company?.trim() || "",
                },
                category: category || "",
              });

              await updateIntervention(
                createdInterventionId,
                {
                  guestAccessToken: access.token,
                  guestWebUrl: access.guestWebUrl,
                  guestCompleteAccountUrl: access.completeAccountUrl,
                } as any
              );

              const message = buildGuestShareMessage({
                providerName: fullProviderName(newProvider) || "Prestataire",
                coproName: currentCopro?.name || "Copropriété",
                title: title.trim(),
                description: description.trim(),
                dateLabel: parsedDate.toLocaleDateString("fr-FR"),
                categoryLabel: category ? CATEGORY_LABELS[category] : "Prestation",
                categoryInviteCode,
                guestWebUrl: access.guestWebUrl,
                completeAccountUrl: access.completeAccountUrl,
                appLink: access.appLink || getAppDownloadUrl(),
              });

              Alert.alert("Intervention créée", "L’intervention a bien été créée.", [
                {
                  text: "Partager maintenant",
                  onPress: async () => {
                    try {
                      await Share.share({
                        title: "Partager l’intervention",
                        message,
                      });
                    } catch {}
                    router.replace(`/intervention/${createdInterventionId}` as any);
                  },
                },
                {
                  text: "Ouvrir la fiche",
                  onPress: () =>
                    router.replace(`/intervention/${createdInterventionId}` as any),
                },
              ]);
            } catch (e) {
              console.error("Guest access create/share failed:", e);
              router.replace(`/intervention/${createdInterventionId}` as any);
            }
          }
        } else {
          router.back();
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Erreur", "Impossible d'enregistrer.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    isAdmin ||
    locationStatus === "ok" ||
    locationStatus === "no-coords" ||
    Platform.OS === "web";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="close" size={22} color={COLORS.text} />
        </Pressable>

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isEditMode ? "Modifier" : isAdmin ? "Programmer" : "Déclarer"}
          </Text>

          {!isEditMode && (
            <View
              style={[
                styles.modeBadge,
                isAdmin ? styles.modeBadgeAdmin : styles.modeBadgeField,
              ]}
            >
              <Ionicons
                name={isAdmin ? "calendar-outline" : "location-outline"}
                size={11}
                color={isAdmin ? COLORS.primary : COLORS.teal}
              />
              <Text
                style={[
                  styles.modeBadgeText,
                  isAdmin
                    ? { color: COLORS.primary }
                    : { color: COLORS.teal },
                ]}
              >
                {isAdmin ? "À distance" : "Sur site"}
              </Text>
            </View>
          )}
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={isSubmitting || !canSubmit || locationStatus === "checking"}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.8 },
            (!canSubmit || isSubmitting || locationStatus === "checking") && {
              opacity: 0.45,
            },
          ]}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>
              {isEditMode
                ? "Sauvegarder"
                : recurrenceEnabled
                ? "Planifier"
                : "Enregistrer"}
            </Text>
          )}
        </Pressable>
      </View>

      {!isAdmin && Platform.OS !== "web" && (
        <LocationBanner
          status={locationStatus}
          distance={locationDistance}
          radius={currentCopro?.locationRadius ?? RADIUS_DEFAULT}
          onRetry={checkLocation}
        />
      )}

      {isAdmin && (
        <View style={styles.adminBanner}>
          <Ionicons name="wifi-outline" size={14} color={COLORS.primary} />
          <Text style={styles.adminBannerText}>
            Programmation à distance — aucune vérification de présence requise
          </Text>
        </View>
      )}

      <View style={styles.creatorBar}>
        <View style={styles.creatorAvatar}>
          <Text style={styles.creatorAvatarText}>
            {creatorName[0].toUpperCase()}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.creatorLabel}>
            {isAdmin ? "Programmé par" : "Déclaré par"}
          </Text>
          <Text style={styles.creatorName}>{creatorName}</Text>
        </View>

        {!isAdmin && locationStatus === "ok" && locationDistance !== null && (
          <View style={styles.locPill}>
            <Ionicons name="location" size={11} color={COLORS.success} />
            <Text style={styles.locPillText}>{locationDistance}m</Text>
          </View>
        )}

        {isAdmin && (
          <View style={[styles.locPill, { backgroundColor: "#EFF6FF" }]}>
            <Ionicons
              name="shield-checkmark-outline"
              size={11}
              color={COLORS.primary}
            />
            <Text style={[styles.locPillText, { color: COLORS.primary }]}>
              Syndic
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Titre *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={
              isAdmin
                ? "Ex: Vérification annuelle ascenseur"
                : "Ex: Nettoyage hall d'entrée"
            }
            placeholderTextColor={COLORS.textMuted}
            returnKeyType="next"
            maxLength={100}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Description *</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder={
              isAdmin
                ? "Décrivez le travail à réaliser..."
                : "Décrivez ce qui a été fait..."
            }
            placeholderTextColor={COLORS.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={500}
          />
        </View>

        <View style={styles.field}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <Text style={styles.fieldLabel}>Catégorie</Text>
            {isCategoryLocked && (
              <View style={styles.lockedBadge}>
                <Ionicons name="lock-closed" size={10} color="#7C3AED" />
                <Text style={styles.lockedBadgeText}>Restreint</Text>
              </View>
            )}
          </View>

          <View style={styles.chipGrid}>
            {availableCategories.map((cat) => {
              const active = category === cat;
              const iconName =
                CATEGORY_ICONS[cat] as keyof typeof Ionicons.glyphMap;

              return (
                <Pressable
                  key={cat}
                  onPress={() => {
                    if (!isCategoryLocked) {
                      Haptics.selectionAsync();
                      setCategory(cat);
                    }
                  }}
                  style={[
                    styles.chip,
                    active && styles.chipActive,
                    isCategoryLocked && !active && { opacity: 0.35 },
                  ]}
                >
                  <Ionicons
                    name={iconName}
                    size={14}
                    color={active ? "#fff" : COLORS.textMuted}
                  />
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {CATEGORY_LABELS[cat]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {isEditMode && isAdmin && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Statut</Text>
            <View style={styles.statusRow}>
              {(["planifie", "en_cours", "termine"] as Status[]).map((s) => {
                const active = status === s;

                return (
                  <Pressable
                    key={s}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setStatus(s);
                    }}
                    style={[
                      styles.statusChip,
                      active && {
                        backgroundColor: STATUS_COLORS[s],
                        borderColor: STATUS_COLORS[s],
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        active && {
                          color: "#fff",
                          fontFamily: "Inter_600SemiBold",
                        },
                      ]}
                    >
                      {STATUS_LABELS[s]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {!isEditMode && (
          <View
            style={[
              styles.field,
              {
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 4,
              },
            ]}
          >
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: isAdmin
                    ? "rgba(37,99,235,0.12)"
                    : "rgba(16,185,129,0.12)",
                  borderColor: isAdmin ? COLORS.primary : COLORS.success,
                  flex: 0,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isAdmin ? COLORS.primary : COLORS.success,
                    fontFamily: "Inter_600SemiBold",
                  },
                ]}
              >
                {isAdmin ? "Sera planifiée" : "Rapport d'intervention"}
              </Text>
            </View>

            <Text style={styles.fieldHint}>
              {isAdmin
                ? "Le prestataire devra marquer l'intervention comme réalisée"
                : "Intervention déjà réalisée"}
            </Text>
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            {recurrenceEnabled
              ? "Date de début"
              : isAdmin
              ? "Date souhaitée d'intervention"
              : "Date d'intervention"}
          </Text>

          <View
            style={[styles.dateInputWrap, dateError ? styles.dateInputError : null]}
          >
            <Ionicons
              name="calendar-outline"
              size={18}
              color={dateError ? COLORS.danger : COLORS.primary}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.dateInput}
              value={dateStr}
              onChangeText={handleDateChange}
              placeholder="JJ/MM/AAAA"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={10}
            />
          </View>

          {dateError ? (
            <Text style={styles.errorHint}>{dateError}</Text>
          ) : (
            <Text style={styles.fieldHint}>
              {isEditMode
                ? "Format : JJ/MM/AAAA"
                : "Format : JJ/MM/AAAA — date antérieure à aujourd'hui impossible"}
            </Text>
          )}
        </View>

        {isAdmin && !isEditMode && (
          <View style={styles.field}>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Récurrence</Text>
                <Text style={styles.fieldHint}>
                  Planifier des interventions répétées
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setRecurrenceEnabled((v) => !v);
                }}
                style={[styles.toggle, recurrenceEnabled && styles.toggleActive]}
              >
                <View
                  style={[
                    styles.toggleThumb,
                    recurrenceEnabled && styles.toggleThumbActive,
                  ]}
                />
              </Pressable>
            </View>

            {recurrenceEnabled && (
              <View style={styles.recurrenceBox}>
                <View style={styles.recurrenceTypeRow}>
                  {(["weekly", "monthly"] as RecurrenceType[]).map((t) => (
                    <Pressable
                      key={t}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRecurrenceType(t);
                        setRecurrenceDays([]);
                      }}
                      style={[
                        styles.recurrenceTypeBtn,
                        recurrenceType === t && styles.recurrenceTypeBtnActive,
                      ]}
                    >
                      <Ionicons
                        name={t === "weekly" ? "calendar" : "repeat"}
                        size={14}
                        color={recurrenceType === t ? "#fff" : COLORS.textMuted}
                      />
                      <Text
                        style={[
                          styles.recurrenceTypeTxt,
                          recurrenceType === t && { color: "#fff" },
                        ]}
                      >
                        {t === "weekly" ? "Hebdomadaire" : "Mensuelle"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {recurrenceType === "weekly" && (
                  <View style={styles.dayPickerSection}>
                    <Text style={styles.recurrenceSubLabel}>
                      Jours de la semaine *
                    </Text>

                    <View style={styles.dayPicker}>
                      {WEEK_DAYS.map((d) => {
                        const active = recurrenceDays.includes(d.value);

                        return (
                          <Pressable
                            key={d.value}
                            onPress={() => toggleDay(d.value)}
                            style={[styles.dayBtn, active && styles.dayBtnActive]}
                          >
                            <Text
                              style={[
                                styles.dayBtnText,
                                active && styles.dayBtnTextActive,
                              ]}
                            >
                              {d.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                <View style={styles.occurrenceRow}>
                  <Text style={styles.recurrenceSubLabel}>
                    Nombre d'occurrences
                  </Text>

                  <View style={styles.occurrenceCounter}>
                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRecurrenceOccurrences((n) => Math.max(1, n - 1));
                      }}
                      style={styles.occurrenceBtn}
                    >
                      <Ionicons name="remove" size={18} color={COLORS.primary} />
                    </Pressable>

                    <Text style={styles.occurrenceValue}>
                      {recurrenceOccurrences}
                    </Text>

                    <Pressable
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRecurrenceOccurrences((n) => Math.min(52, n + 1));
                      }}
                      style={styles.occurrenceBtn}
                    >
                      <Ionicons name="add" size={18} color={COLORS.primary} />
                    </Pressable>
                  </View>
                </View>

                {recurrenceType === "weekly" && recurrenceDays.length > 0 && (
                  <View style={styles.recurrencePreview}>
                    <Ionicons
                      name="information-circle-outline"
                      size={14}
                      color={COLORS.primary}
                    />
                    <Text style={styles.recurrencePreviewText}>
                      {recurrenceOccurrences} interventions seront créées sur les
                      jours sélectionnés
                    </Text>
                  </View>
                )}

                {recurrenceType === "monthly" && (
                  <View style={styles.recurrencePreview}>
                    <Ionicons
                      name="information-circle-outline"
                      size={14}
                      color={COLORS.primary}
                    />
                    <Text style={styles.recurrencePreviewText}>
                      {recurrenceOccurrences} interventions mensuelles à partir de
                      la date de début
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {isAdmin && category && (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Affectation prestataire</Text>

            <View style={styles.modeSwitchRow}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setProviderMode("existing");
                  resetNewProviderErrors();
                }}
                style={[
                  styles.modeSwitchBtn,
                  providerMode === "existing" && styles.modeSwitchBtnActive,
                ]}
              >
                <Ionicons
                  name="people-outline"
                  size={16}
                  color={providerMode === "existing" ? "#fff" : COLORS.primary}
                />
                <Text
                  style={[
                    styles.modeSwitchText,
                    providerMode === "existing" && styles.modeSwitchTextActive,
                  ]}
                >
                  Prestataire existant
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setProviderMode("new");
                  setAssignedToUid("");
                  setAssignedToName("");
                }}
                style={[
                  styles.modeSwitchBtn,
                  providerMode === "new" && styles.modeSwitchBtnActive,
                ]}
              >
                <Ionicons
                  name="flash-outline"
                  size={16}
                  color={providerMode === "new" ? "#fff" : COLORS.primary}
                />
                <Text
                  style={[
                    styles.modeSwitchText,
                    providerMode === "new" && styles.modeSwitchTextActive,
                  ]}
                >
                  Nouveau prestataire urgent
                </Text>
              </Pressable>
            </View>

            {providerMode === "existing" ? (
              availablePrestataires.length === 0 ? (
                <View style={styles.blockBox}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={18}
                    color={COLORS.danger}
                  />
                  <Text style={styles.blockText}>
                    Aucun prestataire n'est rattaché à la catégorie{" "}
                    {CATEGORY_LABELS[category]}. Passez en mode “Nouveau prestataire urgent”.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.chipGrid}>
                    {availablePrestataires.map((p: any) => {
                      const active = assignedToUid === p.uid;
                      const label = getMemberLabel(p);

                      return (
                        <Pressable
                          key={p.uid}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setAssignedToUid(p.uid);
                            setAssignedToName(label);
                          }}
                          style={[styles.chip, active && styles.chipActive]}
                        >
                          <Ionicons
                            name={
                              active
                                ? "checkmark-circle"
                                : "person-circle-outline"
                            }
                            size={16}
                            color={active ? "#fff" : COLORS.primary}
                          />
                          <Text
                            style={[
                              styles.chipText,
                              active && styles.chipTextActive,
                            ]}
                          >
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Text style={styles.fieldHint}>
                    Le prestataire sélectionné verra directement cette intervention.
                  </Text>
                </>
              )
            ) : (
              <View style={styles.inlineFormCard}>
                <Text style={styles.fieldHint}>
                  Saisissez rapidement les coordonnées du prestataire. Il recevra un
                  accès web direct ainsi qu’un lien pour finaliser son compte.
                </Text>

                <View style={styles.inlineRow}>
                  <View style={{ flex: 1, gap: 6 }}>
                    <TextInput
                      style={styles.input}
                      value={newProvider.firstName}
                      onChangeText={(v) => handleNewProviderChange("firstName", v)}
                      placeholder="Prénom *"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    {!!newProviderErrors.firstName && (
                      <Text style={styles.errorHint}>{newProviderErrors.firstName}</Text>
                    )}
                  </View>

                  <View style={{ flex: 1, gap: 6 }}>
                    <TextInput
                      style={styles.input}
                      value={newProvider.lastName}
                      onChangeText={(v) => handleNewProviderChange("lastName", v)}
                      placeholder="Nom *"
                      placeholderTextColor={COLORS.textMuted}
                    />
                    {!!newProviderErrors.lastName && (
                      <Text style={styles.errorHint}>{newProviderErrors.lastName}</Text>
                    )}
                  </View>
                </View>

                <View style={{ gap: 6 }}>
                  <TextInput
                    style={styles.input}
                    value={newProvider.company}
                    onChangeText={(v) => handleNewProviderChange("company", v)}
                    placeholder="Société (optionnel)"
                    placeholderTextColor={COLORS.textMuted}
                  />
                </View>

                <View style={{ gap: 6 }}>
                  <TextInput
                    style={styles.input}
                    value={newProvider.email}
                    onChangeText={(v) => handleNewProviderChange("email", v)}
                    placeholder="Adresse email *"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {!!newProviderErrors.email && (
                    <Text style={styles.errorHint}>{newProviderErrors.email}</Text>
                  )}
                </View>

                <View style={{ gap: 6 }}>
                  <TextInput
                    style={styles.input}
                    value={newProvider.phone}
                    onChangeText={(v) => handleNewProviderChange("phone", v)}
                    placeholder="06 12 34 56 78"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="phone-pad"
                    maxLength={14}
                  />
                  {!!newProviderErrors.phone ? (
                    <Text style={styles.errorHint}>{newProviderErrors.phone}</Text>
                  ) : (
                    <Text style={styles.fieldHint}>
                      Format automatique : 06 12 34 56 78
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>
            Téléphone intervenant
            <Text style={styles.fieldLabelOpt}> (optionnel)</Text>
          </Text>

          <View
            style={[
              styles.phoneInputWrap,
              phoneError ? styles.dateInputError : null,
            ]}
          >
            <Ionicons
              name="call-outline"
              size={18}
              color={phoneError ? COLORS.danger : COLORS.textMuted}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.dateInput}
              value={technicianPhone}
              onChangeText={handlePhoneChange}
              placeholder="Ex: 06 12 34 56 78"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="phone-pad"
              returnKeyType="done"
              maxLength={14}
            />
          </View>

          {phoneError ? (
            <Text style={styles.errorHint}>{phoneError}</Text>
          ) : (
            <Text style={styles.fieldHint}>
              Format automatique : 06 12 34 56 78
            </Text>
          )}
        </View>

        {!recurrenceEnabled && (
          <View style={styles.field}>
            <PhotoViewer
              photos={viewerPhotos}
              initialIndex={viewerIdx}
              visible={viewerPhotos.length > 0}
              onClose={() => setViewerPhotos([])}
            />

            <Text style={styles.fieldLabel}>
              Photos ({(isEditMode ? existingPhotos.length : 0) + localPhotos.length}
              /5)
            </Text>

            {(existingPhotos.length > 0 || localPhotos.length > 0) && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.photoScroll}
              >
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {isEditMode &&
                    existingPhotos.map((uri, idx) => (
                      <Pressable
                        key={`existing-${idx}`}
                        style={styles.photoThumb}
                        onPress={() => {
                          setViewerPhotos(existingPhotos);
                          setViewerIdx(idx);
                        }}
                      >
                        <Image
                          source={{ uri }}
                          style={styles.photoImg}
                          resizeMode="cover"
                        />
                        <View style={styles.photoZoomHint}>
                          <Ionicons
                            name="expand-outline"
                            size={13}
                            color="#fff"
                          />
                        </View>
                      </Pressable>
                    ))}

                  {localPhotos.map((uri, idx) => (
                    <Pressable
                      key={`local-${idx}`}
                      style={styles.photoThumb}
                      onPress={() => {
                        setViewerPhotos(localPhotos);
                        setViewerIdx(idx);
                      }}
                    >
                      <Image
                        source={{ uri }}
                        style={styles.photoImg}
                        resizeMode="cover"
                      />
                      <View style={styles.photoZoomHint}>
                        <Ionicons name="expand-outline" size={13} color="#fff" />
                      </View>
                      <Pressable
                        style={styles.photoRemove}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setLocalPhotos((p) => p.filter((_, i) => i !== idx));
                        }}
                        hitSlop={6}
                      >
                        <Ionicons name="close-circle" size={22} color="#fff" />
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}

            {(isEditMode ? existingPhotos.length : 0) + localPhotos.length < 3 && (
              <View style={styles.photoActions}>
                <Pressable style={styles.photoBtn} onPress={takePhoto}>
                  <Ionicons
                    name="camera-outline"
                    size={18}
                    color={COLORS.primary}
                  />
                  <Text style={styles.photoBtnText}>Appareil photo</Text>
                </Pressable>

                <Pressable style={styles.photoBtn} onPress={pickPhoto}>
                  <Ionicons
                    name="image-outline"
                    size={18}
                    color={COLORS.primary}
                  />
                  <Text style={styles.photoBtnText}>Galerie</Text>
                </Pressable>
              </View>
            )}

            {isEditMode && localPhotos.length > 0 && (
              <Text style={styles.fieldHint}>
                {localPhotos.length} nouvelle
                {localPhotos.length > 1 ? "s" : ""} photo
                {localPhotos.length > 1 ? "s" : ""} — sera
                {localPhotos.length > 1 ? "ont" : ""} ajoutée
                {localPhotos.length > 1 ? "s" : ""} lors de la sauvegarde
              </Text>
            )}
          </View>
        )}

        {!recurrenceEnabled &&
          !isEditMode &&
          category === "nettoyage" &&
          groupedCleaningAreas.length > 0 && (
            <View style={styles.field}>
              <View style={styles.checklistHeader}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={18}
                  color={COLORS.teal}
                />
                <Text style={styles.fieldLabel}>Zones de nettoyage</Text>

                <View style={styles.checklistCountBadge}>
                  <Text style={styles.checklistCountText}>
                    {Object.values(cleaningChecklist).filter(Boolean).length}/
                    {cleaningAreas.length}
                  </Text>
                </View>
              </View>

              <Text style={styles.fieldHint}>
                Décochez les zones non effectuées lors de cette intervention
              </Text>

              {groupedCleaningAreas.map(([group, areas]) => (
                <View key={group} style={styles.checklistGroup}>
                  <Text style={styles.checklistGroupLabel}>{group}</Text>

                  {areas.map((area) => {
                    const checked = cleaningChecklist[area.id] !== false;

                    return (
                      <Pressable
                        key={area.id}
                        style={[
                          styles.checklistRow,
                          !checked && styles.checklistRowUnchecked,
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setCleaningChecklist((prev) => ({
                            ...prev,
                            [area.id]: !checked,
                          }));
                        }}
                      >
                        <Ionicons
                          name={checked ? "checkbox" : "square-outline"}
                          size={20}
                          color={checked ? COLORS.teal : COLORS.textMuted}
                        />
                        <Text
                          style={[
                            styles.checklistAreaLabel,
                            !checked && styles.checklistAreaUnchecked,
                          ]}
                        >
                          {area.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          )}

        {!canSubmit && !isAdmin && (
          <View style={styles.blockBox}>
            <Ionicons name="lock-closed" size={18} color={COLORS.danger} />
            <Text style={styles.blockText}>
              Vous devez être sur site (à moins de{" "}
              {currentCopro?.locationRadius ?? RADIUS_DEFAULT}m) pour déclarer.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function LocationBanner({
  status,
  distance,
  radius,
  onRetry,
}: {
  status: string;
  distance: number | null;
  radius: number;
  onRetry: () => void;
}) {
  if (status === "checking") {
    return (
      <View style={[styles.locBanner, styles.locBannerInfo]}>
        <ActivityIndicator size="small" color={COLORS.primary} />
        <Text style={[styles.locText, { color: COLORS.primary }]}>
          Vérification de votre position...
        </Text>
      </View>
    );
  }

  if (status === "ok" && distance !== null) {
    return (
      <View style={[styles.locBanner, styles.locBannerOk]}>
        <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
        <Text style={[styles.locText, { color: COLORS.success }]}>
          Présence vérifiée — à {distance}m du bâtiment
        </Text>
      </View>
    );
  }

  if (status === "far") {
    return (
      <Pressable
        style={[styles.locBanner, styles.locBannerError]}
        onPress={onRetry}
      >
        <Ionicons name="location-outline" size={16} color={COLORS.danger} />
        <Text style={[styles.locText, { color: COLORS.danger, flex: 1 }]}>
          Trop loin : {distance}m (max {radius}m) — Appuyez pour revérifier
        </Text>
      </Pressable>
    );
  }

  if (status === "denied") {
    return (
      <View style={[styles.locBanner, styles.locBannerError]}>
        <Ionicons name="location-outline" size={16} color={COLORS.danger} />
        <Text style={[styles.locText, { color: COLORS.danger }]}>
          Localisation refusée — requise pour déclarer
        </Text>
      </View>
    );
  }

  if (status === "no-coords") {
    return (
      <View style={[styles.locBanner, styles.locBannerWarn]}>
        <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
        <Text style={[styles.locText, { color: COLORS.warning }]}>
          Position du bâtiment non définie — contactez votre syndic
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },

  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },

  headerCenter: { alignItems: "center", gap: 4 },

  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  modeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },

  modeBadgeAdmin: { backgroundColor: "#EFF6FF" },
  modeBadgeField: { backgroundColor: "rgba(14,186,170,0.1)" },

  modeBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },

  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 90,
    alignItems: "center",
  },

  saveBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  adminBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#EFF6FF",
  },

  adminBannerText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
    flex: 1,
  },

  locBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },

  locBannerInfo: { backgroundColor: "#EFF6FF" },
  locBannerOk: { backgroundColor: "#ECFDF5" },
  locBannerError: { backgroundColor: "#FEF2F2" },
  locBannerWarn: { backgroundColor: "#FFFBEB" },

  locText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },

  creatorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  creatorAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.darkSurface,
    alignItems: "center",
    justifyContent: "center",
  },

  creatorAvatarText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#fff",
  },

  creatorLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },

  creatorName: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },

  locPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },

  locPillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.success,
  },

  scroll: { flex: 1 },
  content: { padding: 16, gap: 20 },
  field: { gap: 8 },

  fieldLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  fieldLabelOpt: {
    fontFamily: "Inter_400Regular",
    textTransform: "none",
    letterSpacing: 0,
    color: COLORS.textMuted,
  },

  fieldHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },

  errorHint: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: COLORS.danger,
  },

  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
  },

  inputMultiline: {
    minHeight: 100,
    paddingTop: 13,
  },

  lockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(124,58,237,0.08)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },

  lockedBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: "#7C3AED",
  },

  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
  },

  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.textMuted,
  },

  chipTextActive: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },

  statusRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },

  statusChip: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 10,
  },

  dateInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },

  dateInputError: {
    borderColor: COLORS.danger,
  },

  dateInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
    paddingVertical: 9,
  },

  phoneInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },

  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.border,
    justifyContent: "center",
    paddingHorizontal: 3,
  },

  toggleActive: {
    backgroundColor: COLORS.primary,
  },

  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },

  toggleThumbActive: {
    transform: [{ translateX: 20 }],
  },

  recurrenceBox: {
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 14,
    gap: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },

  recurrenceTypeRow: {
    flexDirection: "row",
    gap: 8,
  },

  recurrenceTypeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
  },

  recurrenceTypeBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  recurrenceTypeTxt: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.textMuted,
  },

  dayPickerSection: { gap: 8 },

  recurrenceSubLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  dayPicker: {
    flexDirection: "row",
    gap: 6,
  },

  dayBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  dayBtnActive: {
    backgroundColor: COLORS.teal,
    borderColor: COLORS.teal,
  },

  dayBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted,
  },

  dayBtnTextActive: { color: "#fff" },

  occurrenceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  occurrenceCounter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  occurrenceBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },

  occurrenceValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    minWidth: 36,
    textAlign: "center",
  },

  recurrencePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DBEAFE",
    borderRadius: 8,
    padding: 10,
  },

  recurrencePreviewText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
    flex: 1,
  },

  modeSwitchRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },

  modeSwitchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 10,
  },

  modeSwitchBtnActive: {
    backgroundColor: COLORS.primary,
  },

  modeSwitchText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
  },

  modeSwitchTextActive: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },

  inlineFormCard: {
    gap: 10,
    padding: 12,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },

  inlineRow: {
    flexDirection: "row",
    gap: 10,
  },

  photoScroll: { marginBottom: 4 },

  photoThumb: {
    width: 160,
    height: 110,
    borderRadius: 10,
    position: "relative",
    overflow: "hidden",
  },

  photoZoomHint: {
    position: "absolute",
    bottom: 5,
    right: 5,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    padding: 3,
  },

  photoImg: {
    width: 160,
    height: 110,
    borderRadius: 10,
  },

  photoRemove: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 12,
  },

  photoActions: {
    flexDirection: "row",
    gap: 10,
  },

  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
  },

  photoBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.primary,
  },

  blockBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },

  blockText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.danger,
    flex: 1,
  },

  checklistHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },

  checklistCountBadge: {
    backgroundColor: COLORS.teal,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: "auto" as any,
  },

  checklistCountText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },

  checklistGroup: {
    marginTop: 10,
  },

  checklistGroupLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
    marginLeft: 2,
  },

  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  checklistRowUnchecked: {
    opacity: 0.5,
  },

  checklistAreaLabel: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
    flex: 1,
  },

  checklistAreaUnchecked: {
    color: COLORS.textMuted,
    textDecorationLine: "line-through",
  },
});