import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Dimensions, Linking, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { Path, Svg, SvgXml } from "react-native-svg";
import { wa, wConfirm } from "@/shared/dialogs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { getApiUrl } from "@/lib/query-client";
import { crossShare } from "@/lib/share";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import {
  ALL_CATEGORIES, BuildingConfig, BuildingDef, Category, CATEGORY_LABELS, CATEGORY_ICONS,
  DEFAULT_BUILDING_CONFIG, generateCleaningAreas, OPTIONAL_CATEGORIES,
} from "@/shared/types";

function InviteCodePreview({ code, isPrestataireRole }: { code: string | null; isPrestataireRole: boolean }) {
  return (
    <View style={styles.inviteCodePreview}>
      <View style={styles.inviteCodePreviewHeader}>
        <Ionicons name="key-outline" size={14} color={COLORS.primary} />
        <Text style={styles.inviteCodePreviewLabel}>Code d'invitation</Text>
      </View>
      {code
        ? <Text style={styles.inviteCodeValue}>{code}</Text>
        : <Text style={styles.inviteCodePlaceholder}>
            {isPrestataireRole ? "Sera généré automatiquement" : "Non disponible — générez le code d'abord"}
          </Text>
      }
    </View>
  );
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isSuperAdmin, logout, deleteAccount, resetUserType } = useAuth();
  const { currentCopro, currentRole, members, copros, switchCoPro, deleteCoPro, refreshCoPros, userSubscription, generateCategoryCode, removeMember, changeMemberRole } = useCoPro();
  const [adminTab, setAdminTab] = useState<"copro" | "membres" | "config" | "compte">("copro");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedOwnerCode, setCopiedOwnerCode] = useState(false);
  const [copiedConseilCode, setCopiedConseilCode] = useState(false);
  const [generatingOwnerCode, setGeneratingOwnerCode] = useState(false);
  const [generatingConseilCode, setGeneratingConseilCode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingLocation, setSettingLocation] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [generatingCatCode, setGeneratingCatCode] = useState<Category | null>(null);
  const [copiedCatCode, setCopiedCatCode] = useState<Category | null>(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteRole, setInviteRole] = useState<"collaborateur" | "propriétaire" | "prestataire" | "conseil">("collaborateur");
  const [inviteCategory, setInviteCategory] = useState<Category>("nettoyage");
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  // ── Signature modèle ──
  const [signatureModelUrl, setSignatureModelUrl] = useState<string | null>(null);
  const [signatureModelSvg, setSignatureModelSvg] = useState<string | null>(null);
  const [signPadVisible, setSignPadVisible] = useState(false);
  const [sigStrokes, setSigStrokes] = useState<Array<Array<{ x: number; y: number }>>>([]);
  const [sigLiveStroke, setSigLiveStroke] = useState<Array<{ x: number; y: number }>>([]);
  const sigCurrentStroke = useRef<Array<{ x: number; y: number }>>([]);
  const sigStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const [savingSig, setSavingSig] = useState(false);

  const SIG_W = Math.min(Dimensions.get("window").width - 80, 320);
  const SIG_H = 140;

  const sigPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        sigCurrentStroke.current = [{ x, y }];
        setSigLiveStroke([{ x, y }]);
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        sigCurrentStroke.current = [...sigCurrentStroke.current, { x, y }];
        setSigLiveStroke([...sigCurrentStroke.current]);
      },
      onPanResponderRelease: () => {
        if (sigCurrentStroke.current.length > 0) {
          sigStrokesRef.current = [...sigStrokesRef.current, sigCurrentStroke.current];
          setSigStrokes([...sigStrokesRef.current]);
        }
        setSigLiveStroke([]);
        sigCurrentStroke.current = [];
      },
      onPanResponderTerminate: () => {
        if (sigCurrentStroke.current.length > 0) {
          sigStrokesRef.current = [...sigStrokesRef.current, sigCurrentStroke.current];
          setSigStrokes([...sigStrokesRef.current]);
        }
        setSigLiveStroke([]);
        sigCurrentStroke.current = [];
      },
    })
  ).current;

  function sigPointsToPath(pts: Array<{ x: number; y: number }>): string {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} l0.1,0.1`;
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` +
      pts.slice(1).map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  }

  async function handleSaveSignatureModel() {
    // Lire depuis le ref pour éviter la closure périmée (race condition React)
    const strokes = sigStrokesRef.current;
    if (!user?.uid || strokes.length === 0) return;
    setSavingSig(true);
    try {
      const pathsXml = strokes
        .map((pts) => `<path d="${sigPointsToPath(pts)}" stroke="#1E293B" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
        .join("");
      const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIG_W}" height="${SIG_H}" viewBox="0 0 ${SIG_W} ${SIG_H}">${pathsXml}</svg>`;
      // Stocker le SVG texte dans Firestore (affichage immédiat sans réseau)
      // + garder l'upload Storage pour le serveur (génération PDF)
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const sRef = storageRef(storage, `signatures/${user.uid}/model.svg`);
      await uploadBytes(sRef, blob, { contentType: "image/svg+xml" });
      const url = await getDownloadURL(sRef);
      await updateDoc(doc(db, "users", user.uid), {
        signatureModelUrl: url,
        signatureModelSvg: svgStr,
      });
      setSignatureModelUrl(url);
      setSignatureModelSvg(svgStr);
      setSignPadVisible(false);
      setSigStrokes([]); sigStrokesRef.current = [];
      setSigLiveStroke([]);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      wa("Erreur", e.message ?? "Impossible d'enregistrer la signature.");
    } finally {
      setSavingSig(false);
    }
  }

  useEffect(() => {
    if (!user?.uid) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      const url = snap.data()?.signatureModelUrl ?? null;
      const svg = snap.data()?.signatureModelSvg ?? null;
      setSignatureModelUrl(url);
      setSignatureModelSvg(svg);
    }).catch(() => {});
  }, [user?.uid]);

  const disabledCategories: Category[] = currentCopro?.disabledCategories ?? [];

  const handleBillingPortal = async () => {
    if (!user) return;
    setOpeningPortal(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(new URL("/api/billing-portal", getApiUrl()).toString(), {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.url) {
        Linking.openURL(data.url);
      } else {
        wa("Erreur", data.error ?? "Impossible d'ouvrir le portail.");
      }
    } catch {
      wa("Erreur", "Impossible de joindre le serveur.");
    } finally {
      setOpeningPortal(false);
    }
  };

  const normalizeBuildingConfig = (cfg: BuildingConfig | undefined): BuildingConfig => {
    const base = cfg ?? DEFAULT_BUILDING_CONFIG;
    if (base.buildings && base.buildings.length > 0) return base;
    const legacyCount = (base as any).buildingCount ?? 1;
    const legacyFloors = (base as any).floorsPerBuilding ?? 3;
    return {
      ...base,
      buildings: Array.from({ length: legacyCount }, (_, i) => ({
        name: legacyCount > 1 ? `Bâtiment ${String.fromCharCode(65 + i)}` : "Bâtiment A",
        floors: legacyFloors,
      })),
    };
  };

  const [buildingConfig, setBuildingConfig] = useState<BuildingConfig>(
    normalizeBuildingConfig(currentCopro?.buildingConfig)
  );
  const [savingBuildingConfig, setSavingBuildingConfig] = useState(false);
  const [newCustomArea, setNewCustomArea] = useState("");

  // ── Informations légales du syndic ──
  const [syndicCompanyName, setSyndicCompanyName] = useState(currentCopro?.syndicCompanyName ?? "");
  const [syndicSiret, setSyndicSiret]             = useState(currentCopro?.syndicSiret ?? "");
  const [syndicPhone, setSyndicPhone]             = useState(currentCopro?.syndicPhone ?? "");
  const [syndicLegalForm, setSyndicLegalForm]     = useState(currentCopro?.syndicLegalForm ?? "");
  const [savingLegal, setSavingLegal]             = useState(false);

  useEffect(() => {
    setBuildingConfig(normalizeBuildingConfig(currentCopro?.buildingConfig));
  }, [currentCopro?.id]);

  useEffect(() => {
    setSyndicCompanyName(currentCopro?.syndicCompanyName ?? "");
    setSyndicSiret(currentCopro?.syndicSiret ?? "");
    setSyndicPhone(currentCopro?.syndicPhone ?? "");
    setSyndicLegalForm(currentCopro?.syndicLegalForm ?? "");
  }, [currentCopro?.id]);

  const buildInviteMessage = (code: string): string => {
    // Lien de la landing page avec le code pré-rempli
    const inviteLink = `https://maintena-pro.fr/rejoindre/${code}`;

    if (inviteRole === "propriétaire") {
      return (
        `🏢 Invitation Maintena — ${currentCopro?.name}\n\n` +
        `Vous êtes invité(e) à suivre l'entretien et les actualités de votre résidence.\n\n` +
        `👉 Cliquez sur le lien pour rejoindre :\n${inviteLink}\n\n` +
        `Code d'invitation : ${code}`
      );
    }

    if (inviteRole === "collaborateur") {
      return (
        `🏢 Invitation Maintena — ${currentCopro?.name}\n\n` +
        `Vous êtes invité(e) à gérer cette résidence en tant que collaborateur.\n\n` +
        `👉 Cliquez sur le lien pour rejoindre :\n${inviteLink}\n\n` +
        `Code d'invitation : ${code}`
      );
    }

    if (inviteRole === "conseil") {
      return (
        `🏢 Invitation Maintena — ${currentCopro?.name}\n\n` +
        `Vous êtes invité(e) à rejoindre le conseil syndical et accéder au contrôle des comptes.\n\n` +
        `👉 Cliquez sur le lien pour rejoindre :\n${inviteLink}\n\n` +
        `Code d'invitation : ${code}`
      );
    }

    // Prestataire
    return (
      `🔧 Invitation Maintena — ${currentCopro?.name}\n\n` +
      `Votre client syndic vous invite à rejoindre Maintena pour suivre et déclarer vos interventions.\n\n` +
      `👉 Cliquez sur le lien pour rejoindre :\n${inviteLink}\n\n` +
      `Votre code prestataire : ${code}\n\n` +
      `Gratuit · Android + web · 30 secondes pour déclarer un passage`
    );
  };

  const getInviteCode = (): string | null => {
    if (!currentCopro) return null;
    if (inviteRole === "propriétaire") return currentCopro.ownerInviteCode ?? null;
    if (inviteRole === "collaborateur") return currentCopro.inviteCode;
    if (inviteRole === "conseil") return currentCopro.conseilInviteCode ?? null;
    return currentCopro.categoryInviteCodes?.[inviteCategory] ?? null;
  };

  const handleSendInvite = async (via: "share" | "sms" | "email") => {
    if (!currentCopro) return;
    setInviteGenerating(true);
    try {
      let code = getInviteCode();
      if (!code) {
        if (inviteRole === "prestataire") {
          code = await generateCategoryCode(inviteCategory);
        } else if (inviteRole === "conseil") {
          code = await handleGenerateConseilCode();
        } else if (inviteRole === "propriétaire") {
          wa("Code manquant", "Veuillez d'abord générer le code propriétaire dans la section Codes.");
          return;
        }
      }
      if (!code) return;
      const message = buildInviteMessage(code);
      if (via === "share") {
        await crossShare(message);
      } else if (via === "sms") {
        if (Platform.OS === "web") {
          await crossShare(message);
        } else {
          const sep = Platform.OS === "ios" ? "&" : "?";
          await Linking.openURL(`sms:${sep}body=${encodeURIComponent(message)}`);
        }
      } else if (via === "email") {
        const subject = encodeURIComponent(`Invitation Maintena — ${currentCopro.name}`);
        const body = encodeURIComponent(message);
        await Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
      }
    } catch (e: any) {
      wa("Erreur", e.message ?? "Impossible d'envoyer l'invitation.");
    } finally {
      setInviteGenerating(false);
    }
  };

  const handleChangeRole = (uid: string, currentMemberRole: string, name: string) => {
    // Propriétaire ↔ Conseil syndical — seuls ces deux rôles sont interchangeables
    if (currentMemberRole === "propriétaire") {
      wConfirm(
        `Promouvoir ${name}`,
        "Voulez-vous lui donner accès au Contrôle des comptes (Conseil syndical) ?",
        async () => {
          try {
            await changeMemberRole(uid, "conseil");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e: any) {
            wa("Erreur", e.message ?? "Impossible de modifier le rôle.");
          }
        },
        "Conseil syndical",
        false,
      );
    } else if (currentMemberRole === "conseil") {
      wConfirm(
        `Modifier le rôle de ${name}`,
        "Retirer l'accès au Contrôle des comptes ?",
        async () => {
          try {
            await changeMemberRole(uid, "propriétaire");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch (e: any) {
            wa("Erreur", e.message ?? "Impossible de modifier le rôle.");
          }
        },
        "Redevenir Propriétaire",
        false,
      );
    }
  };

  const handleRemoveMember = (uid: string, name: string) => {
    wConfirm(
      "Retirer ce collaborateur",
      `Voulez-vous retirer ${name} de cette copropriété ?`,
      async () => {
        try {
          await removeMember(uid);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } catch (e: any) {
          wa("Erreur", e.message ?? "Impossible de retirer ce collaborateur.");
        }
      },
      "Retirer",
    );
  };

  const handleSaveBuildingConfig = async () => {
    if (!currentCopro) return;
    setSavingBuildingConfig(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateDoc(doc(db, "copros", currentCopro.id), { buildingConfig });
      await refreshCoPros();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      wa("Erreur", e.message);
    } finally {
      setSavingBuildingConfig(false);
    }
  };

  const handleSaveLegalInfo = async () => {
    if (!currentCopro) return;
    setSavingLegal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await updateDoc(doc(db, "copros", currentCopro.id), {
        syndicCompanyName: syndicCompanyName.trim(),
        syndicSiret: syndicSiret.trim(),
        syndicPhone: syndicPhone.trim(),
        syndicLegalForm: syndicLegalForm.trim(),
      });
      await refreshCoPros();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      wa("Erreur", e.message);
    } finally {
      setSavingLegal(false);
    }
  };

  const updateBuildingConfigField = <K extends keyof BuildingConfig>(key: K, value: BuildingConfig[K]) => {
    setBuildingConfig((prev) => ({ ...prev, [key]: value }));
  };

  const addCustomArea = () => {
    const trimmed = newCustomArea.trim();
    if (!trimmed) return;
    setBuildingConfig((prev) => ({ ...prev, customAreas: [...prev.customAreas, trimmed] }));
    setNewCustomArea("");
  };

  const removeCustomArea = (idx: number) => {
    setBuildingConfig((prev) => ({
      ...prev,
      customAreas: prev.customAreas.filter((_, i) => i !== idx),
    }));
  };

  const addBuilding = () => {
    setBuildingConfig((prev) => {
      const existing = prev.buildings ?? [];
      const nextLetter = String.fromCharCode(65 + existing.length);
      const newBuilding: BuildingDef = { name: `Bâtiment ${nextLetter}`, floors: 3 };
      return { ...prev, buildings: [...existing, newBuilding] };
    });
  };

  const removeBuilding = (idx: number) => {
    setBuildingConfig((prev) => {
      const existing = prev.buildings ?? [];
      if (existing.length <= 1) return prev;
      return { ...prev, buildings: existing.filter((_, i) => i !== idx) };
    });
  };

  const updateBuildingName = (idx: number, name: string) => {
    setBuildingConfig((prev) => {
      const buildings = [...(prev.buildings ?? [])];
      buildings[idx] = { ...buildings[idx], name };
      return { ...prev, buildings };
    });
  };

  const updateBuildingFloors = (idx: number, floors: number) => {
    setBuildingConfig((prev) => {
      const buildings = [...(prev.buildings ?? [])];
      buildings[idx] = { ...buildings[idx], floors: Math.max(1, Math.min(30, floors)) };
      return { ...prev, buildings };
    });
  };

  const handleToggleCategory = async (cat: Category) => {
    if (!currentCopro) return;
    Haptics.selectionAsync();
    const isDisabled = disabledCategories.includes(cat);
    const newDisabled = isDisabled
      ? disabledCategories.filter((c) => c !== cat)
      : [...disabledCategories, cat];
    setSavingCategories(true);
    try {
      await updateDoc(doc(db, "copros", currentCopro.id), { disabledCategories: newDisabled });
      await refreshCoPros();
    } catch (e: any) {
      wa("Erreur", e.message);
    } finally {
      setSavingCategories(false);
    }
  };

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;
  const isAdmin = currentRole === "admin";
  const hasMultipleCopros = isAdmin && copros.length > 1;

  const handleCopyCode = async () => {
    if (!currentCopro) return;
    await Clipboard.setStringAsync(currentCopro.inviteCode);
    setCopiedCode(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleShareCode = async () => {
    if (!currentCopro) return;
    const link = `https://maintena-pro.fr/rejoindre/${currentCopro.inviteCode}`;
    await crossShare(`🏢 Invitation Maintena — ${currentCopro.name}\n\nRejoins la résidence en tant que collaborateur.\n\n👉 ${link}`);
  };

  const handleCopyOwnerCode = async () => {
    if (!currentCopro?.ownerInviteCode) return;
    await Clipboard.setStringAsync(currentCopro.ownerInviteCode);
    setCopiedOwnerCode(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopiedOwnerCode(false), 2000);
  };

  const handleShareOwnerCode = async () => {
    if (!currentCopro?.ownerInviteCode) return;
    const link = `https://maintena-pro.fr/rejoindre/${currentCopro.ownerInviteCode}`;
    await crossShare(`🏠 Votre résidence est sur Maintena\n\n${currentCopro.name} — Suivez l'entretien et les actualités de votre immeuble.\n\n👉 ${link}`);
  };

  const handleGenerateOwnerCode = async () => {
    if (!currentCopro) return;
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const newCode = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await setDoc(doc(db, "inviteCodes", newCode), {
        coProId: currentCopro.id,
        coProName: currentCopro.name,
        role: "propriétaire",
        createdAt: new Date().toISOString(),
      });
      await updateDoc(doc(db, "copros", currentCopro.id), { ownerInviteCode: newCode });
      await refreshCoPros();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      wa("Erreur", e.message);
    }
  };

  const handleGenerateConseilCode = async (): Promise<string | null> => {
    if (!currentCopro) return null;
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const newCode = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await setDoc(doc(db, "inviteCodes", newCode), {
        coProId: currentCopro.id,
        coProName: currentCopro.name,
        role: "conseil",
        createdAt: new Date().toISOString(),
      });
      await updateDoc(doc(db, "copros", currentCopro.id), { conseilInviteCode: newCode });
      await refreshCoPros();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return newCode;
    } catch (e: any) {
      wa("Erreur", e.message);
      return null;
    }
  };

  const handleCopyConseilCode = async () => {
    const code = currentCopro?.conseilInviteCode;
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopiedConseilCode(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopiedConseilCode(false), 2000);
  };

  const handleShareConseilCode = async () => {
    if (!currentCopro?.conseilInviteCode || !currentCopro) return;
    const link = `https://maintena-pro.fr/rejoindre/${currentCopro.conseilInviteCode}`;
    await crossShare(`🏛️ Invitation Conseil syndical — ${currentCopro.name}\n\nAccédez au contrôle des comptes et à la gestion de la résidence.\n\n👉 ${link}`);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshCoPros();
    setRefreshing(false);
  };

  const handleGenerateCategoryCode = async (cat: Category) => {
    if (!currentCopro) return;
    setGeneratingCatCode(cat);
    try {
      const code = await generateCategoryCode(cat);
      await Clipboard.setStringAsync(code);
      setCopiedCatCode(cat);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopiedCatCode(null), 3000);
    } catch (e: any) {
      wa("Erreur", e.message);
    } finally {
      setGeneratingCatCode(null);
    }
  };

  const handleShareCategoryCode = async (cat: Category) => {
    if (!currentCopro) return;
    const code = currentCopro.categoryInviteCodes?.[cat];
    if (!code) return;
    const link = `https://maintena-pro.fr/rejoindre/${code}`;
    await crossShare(`🔧 Invitation Maintena — ${CATEGORY_LABELS[cat]}\n\n${currentCopro.name} · Votre syndic vous invite à rejoindre Maintena pour déclarer vos interventions.\n\n👉 ${link}`);
  };

  const handleSetLocation = async () => {
    if (Platform.OS === "web") {
      wa("Non disponible", "Définissez la position depuis l'application mobile.");
      return;
    }
    setSettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        wa("Permission refusée", "L'accès à la localisation est nécessaire.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await updateDoc(doc(db, "copros", currentCopro!.id), {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        locationRadius: 300,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      wa(
        "Position enregistrée",
        `Bâtiment localisé.\nRayon d'autorisation : 300m\n\nLes prestataires devront être à moins de 300m pour saisir une intervention.`
      );
    } catch (e: any) {
      wa("Erreur", e.message);
    } finally {
      setSettingLocation(false);
    }
  };

  const handleLogout = () => {
    wConfirm("Déconnexion", "Souhaitez-vous vous déconnecter ?", logout, "Déconnexion");
  };

  const handleDeleteAccount = () => {
    wConfirm(
      "Supprimer mon compte",
      "Cette action est irréversible. Toutes vos données seront définitivement effacées. Vos copropriétés et leurs historiques d'interventions resteront accessibles si d'autres membres y sont inscrits.",
      async () => {
        try {
          await deleteAccount();
        } catch (e: any) {
          wa("Erreur", e.message ?? "Impossible de supprimer le compte.");
        }
      },
      "Supprimer",
    );
  };

  if (isSuperAdmin) {
    return (
      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.content, { paddingTop: top + 16, paddingBottom: bottom + 24 }]}
      >
        <Text style={styles.pageTitle}>Super Admin</Text>
        <Pressable
          style={styles.superAdminBtn}
          onPress={() => router.push("/(superadmin)")}
        >
          <Ionicons name="shield-checkmark" size={20} color="#fff" />
          <Text style={styles.superAdminBtnText}>Panneau d'administration</Text>
          <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.6)" />
        </Pressable>
        <Pressable style={styles.logoutRow} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingTop: top + 16, paddingBottom: bottom + 24 }]}
    >
      <View style={styles.pageTitleRow}>
        <Text style={styles.pageTitle}>{isAdmin ? "Gestion" : currentRole === "propriétaire" ? "Mon accès" : currentRole === "conseil" ? "Mon espace conseil" : currentRole === "prestataire" ? "Mon espace" : "Mon compte"}</Text>
        {hasMultipleCopros && currentCopro && (
          <Pressable
            style={styles.coProSwitcherBtn}
            onPress={() => router.navigate("/(app)")}
          >
            <Ionicons name="business-outline" size={12} color={COLORS.primary} />
            <Text style={styles.coProSwitcherText} numberOfLines={1}>{currentCopro.name}</Text>
            <Ionicons name="swap-horizontal" size={12} color={COLORS.primary} />
          </Pressable>
        )}
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.displayName ?? user?.email ?? "?")[0].toUpperCase()}
          </Text>
        </View>
        <View>
          <Text style={styles.userName}>{user?.displayName ?? "—"}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>
              {isAdmin ? "Admin" : currentRole === "propriétaire" ? "Propriétaire" : currentRole === "conseil" ? "Conseil syndical" : currentRole === "prestataire" ? "Prestataire" : "Collaborateur"}
            </Text>
          </View>
        </View>
      </View>

      {isAdmin && currentCopro && (
        <View style={styles.adminTabBar}>
          {([
            { key: "copro",    label: "Copropriété", icon: "business-outline" },
            { key: "membres",  label: "Membres",     icon: "people-outline" },
            { key: "config",   label: "Config.",     icon: "settings-outline" },
            { key: "compte",   label: "Compte",      icon: "person-outline" },
          ] as const).map(({ key, label, icon }) => (
            <Pressable
              key={key}
              style={[styles.adminTabBtn, adminTab === key && styles.adminTabBtnActive]}
              onPress={() => setAdminTab(key)}
            >
              <Ionicons name={icon} size={16} color={adminTab === key ? COLORS.primary : COLORS.textMuted} />
              <Text style={[styles.adminTabLabel, adminTab === key && styles.adminTabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {currentRole === "conseil" && currentCopro && (
        <View style={styles.adminTabBar}>
          {([
            { key: "copro",  label: "Copropriété", icon: "business-outline" },
            { key: "compte", label: "Finances",    icon: "stats-chart-outline" },
          ] as const).map(({ key, label, icon }) => (
            <Pressable
              key={key}
              style={[styles.adminTabBtn, adminTab === key && styles.adminTabBtnActive]}
              onPress={() => setAdminTab(key)}
            >
              <Ionicons name={icon} size={16} color={adminTab === key ? COLORS.primary : COLORS.textMuted} />
              <Text style={[styles.adminTabLabel, adminTab === key && styles.adminTabLabelActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {currentCopro && adminTab === "copro" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Copropriété</Text>
          <View style={styles.coProInfo}>
            <View style={styles.coProRow}>
              <Ionicons name="business-outline" size={16} color={COLORS.textMuted} />
              <Text style={styles.coProName}>{currentCopro.name}</Text>
              <View style={[
                styles.statusBadge,
                { backgroundColor: currentCopro.status === "active" ? "#D1FAE5" : "#FFFBEB" }
              ]}>
                <Text style={[
                  styles.statusBadgeText,
                  { color: currentCopro.status === "active" ? "#065F46" : "#92400E" }
                ]}>
                  {currentCopro.status === "active" ? "Active" : "En attente"}
                </Text>
              </View>
            </View>
            {currentCopro.address && (
              <View style={styles.coProRow}>
                <Ionicons name="location-outline" size={16} color={COLORS.textMuted} />
                <Text style={styles.coProAddr}>{currentCopro.address}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {(currentRole === "propriétaire" || currentRole === "conseil" || currentRole === "collaborateur") && currentCopro && adminTab === "copro" && (
        <View style={[styles.section, { paddingTop: 0 }]}>
          {/* Carnet d'entretien — visible à tous les membres */}
          <Pressable
            style={styles.statsNavBtn}
            onPress={() => router.push("/(app)/entretien" as any)}
          >
            <View style={[styles.statsNavIcon, { backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="clipboard-outline" size={18} color="#16A34A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Carnet d'entretien</Text>
              <Text style={styles.statsNavSub}>Ascenseur, VMC, portail… · Historique des passages</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
          {/* Demandes de devis — propriétaires et conseil */}
          {(currentRole === "propriétaire" || currentRole === "conseil") && (
            <Pressable
              style={[styles.statsNavBtn, { marginTop: 1 }]}
              onPress={() => router.push("/(app)/demandes-devis" as any)}
            >
              <View style={[styles.statsNavIcon, { backgroundColor: "#FEF3C7" }]}>
                <Ionicons name="document-text-outline" size={18} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statsNavLabel}>Demander un devis</Text>
                <Text style={styles.statsNavSub}>Ouvrir un ticket · Suivi de vos demandes</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      {isAdmin && currentCopro && adminTab === "copro" && (
        <View style={[styles.section, { paddingTop: 0 }]}>
          <Pressable
            style={({ pressed }) => [styles.deleteCoProBtn, pressed && { opacity: 0.8 }]}
            onPress={() =>
              wConfirm(
                "Supprimer la copropriété",
                `Voulez-vous vraiment supprimer "${currentCopro.name}" ? Toutes les données (membres, interventions, annonces) seront définitivement effacées.`,
                async () => {
                  try {
                    await deleteCoPro(currentCopro.id);
                  } catch (e: any) {
                    wa("Erreur", e.message ?? "Impossible de supprimer.");
                  }
                },
                "Supprimer",
                false
              )
            }
          >
            <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
            <Text style={styles.deleteCoProText}>Supprimer cette copropriété</Text>
          </Pressable>
        </View>
      )}

      {isAdmin && (userSubscription?.expiresAt || userSubscription?.trialEndsAt) && (
        <View style={[styles.section, { paddingVertical: 0 }]}>
          {userSubscription?.status === "trialing" && userSubscription.trialEndsAt ? (
            <View style={[styles.subscriptionBadge, styles.subscriptionBadgeTrial]}>
              <Ionicons name="gift-outline" size={14} color="#7C3AED" />
              <Text style={[styles.subscriptionText, { color: "#4C1D95" }]}>
                Essai gratuit · expire le{" "}
                {new Date(userSubscription.trialEndsAt).toLocaleDateString("fr-FR", {
                  day: "numeric", month: "long", year: "numeric",
                })}
              </Text>
            </View>
          ) : userSubscription?.expiresAt ? (
            <View style={styles.subscriptionBadge}>
              <Ionicons name="shield-checkmark" size={14} color={COLORS.success} />
              <Text style={styles.subscriptionText}>
                Abonnement actif jusqu'au{" "}
                {new Date(userSubscription.expiresAt).toLocaleDateString("fr-FR", {
                  day: "numeric", month: "long", year: "numeric",
                })}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {isAdmin && userSubscription?.status === "active" && adminTab === "copro" && (
        <Pressable
          style={({ pressed }) => [styles.portalBtn, pressed && { opacity: 0.82 }]}
          onPress={handleBillingPortal}
          disabled={openingPortal}
        >
          {openingPortal
            ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <Ionicons name="card-outline" size={16} color={COLORS.primary} />
          }
          <Text style={styles.portalBtnText}>Gérer mon abonnement</Text>
          <Ionicons name="open-outline" size={14} color={COLORS.textMuted} />
        </Pressable>
      )}

      {isAdmin && currentCopro && adminTab === "membres" && (
  <>
    <Pressable
      style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.85 }]}
      onPress={() => {
        setInviteRole("collaborateur");
        setInviteModalVisible(true);
      }}
    >
      <View style={styles.inviteBtnIcon}>
        <Ionicons name="person-add" size={20} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.inviteBtnTitle}>Inviter un membre</Text>
        <Text style={styles.inviteBtnSub}>
          Envoyer un code par SMS ou e-mail
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color="rgba(255,255,255,0.6)"
      />
    </Pressable>

  </>
)}

      {isAdmin && currentCopro && adminTab === "membres" && (
        <>

          {/* ── Codes d'accès propriétaires & conseil syndical ── */}
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <View style={styles.codeRoleLabel}>
                <Ionicons name="key-outline" size={14} color={COLORS.primary} />
                <Text style={styles.codeRoleLabelText}>Codes d'accès résidents</Text>
              </View>
            </View>
            <Text style={styles.sectionDesc}>
              Partagez ces codes aux propriétaires et aux membres du conseil syndical pour qu'ils rejoignent la résidence.
            </Text>

            {/* Code propriétaires */}
            <View style={styles.catCodeRow}>
              <View style={styles.catCodeLeft}>
                <View style={[styles.catCodeIcon, { backgroundColor: "#CCFBF1" }]}>
                  <Ionicons name="home-outline" size={15} color={COLORS.teal} />
                </View>
                <View>
                  <Text style={styles.catCodeLabel}>Propriétaires</Text>
                  {currentCopro.ownerInviteCode
                    ? <Text style={styles.catCodeValue}>{currentCopro.ownerInviteCode}</Text>
                    : <Text style={styles.catCodeNone}>Aucun code généré</Text>
                  }
                </View>
              </View>
              <View style={styles.catCodeActions}>
                {currentCopro.ownerInviteCode ? (
                  <>
                    <Pressable
                      style={[styles.catCodeBtn, copiedOwnerCode && { backgroundColor: COLORS.success }]}
                      onPress={handleCopyOwnerCode}
                    >
                      <Ionicons name={copiedOwnerCode ? "checkmark" : "copy-outline"} size={14} color={copiedOwnerCode ? "#fff" : COLORS.primary} />
                    </Pressable>
                    <Pressable style={[styles.catCodeBtn, { backgroundColor: COLORS.primary }]} onPress={handleShareOwnerCode}>
                      <Ionicons name="share-outline" size={14} color="#fff" />
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={[styles.catCodeBtnGenerate, generatingOwnerCode && { opacity: 0.6 }]}
                    onPress={async () => {
                      if (generatingOwnerCode) return;
                      setGeneratingOwnerCode(true);
                      await handleGenerateOwnerCode();
                      setGeneratingOwnerCode(false);
                    }}
                    disabled={generatingOwnerCode}
                  >
                    {generatingOwnerCode
                      ? <ActivityIndicator size="small" color={COLORS.teal} />
                      : <Ionicons name="add-circle-outline" size={14} color={COLORS.teal} />}
                    <Text style={[styles.catCodeBtnGenerateText, { color: COLORS.teal }]}>Générer</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Code conseil syndical */}
            <View style={styles.catCodeRow}>
              <View style={styles.catCodeLeft}>
                <View style={[styles.catCodeIcon, { backgroundColor: "#DBEAFE" }]}>
                  <Ionicons name="shield-checkmark-outline" size={15} color="#0891B2" />
                </View>
                <View>
                  <Text style={styles.catCodeLabel}>Conseil syndical</Text>
                  {currentCopro.conseilInviteCode
                    ? <Text style={styles.catCodeValue}>{currentCopro.conseilInviteCode}</Text>
                    : <Text style={styles.catCodeNone}>Aucun code généré</Text>
                  }
                </View>
              </View>
              <View style={styles.catCodeActions}>
                {currentCopro.conseilInviteCode ? (
                  <>
                    <Pressable
                      style={[styles.catCodeBtn, copiedConseilCode && { backgroundColor: COLORS.success }]}
                      onPress={handleCopyConseilCode}
                    >
                      <Ionicons name={copiedConseilCode ? "checkmark" : "copy-outline"} size={14} color={copiedConseilCode ? "#fff" : COLORS.primary} />
                    </Pressable>
                    <Pressable style={[styles.catCodeBtn, { backgroundColor: "#0891B2" }]} onPress={handleShareConseilCode}>
                      <Ionicons name="share-outline" size={14} color="#fff" />
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={[styles.catCodeBtnGenerate, generatingConseilCode && { opacity: 0.6 }]}
                    onPress={async () => {
                      if (generatingConseilCode) return;
                      setGeneratingConseilCode(true);
                      await handleGenerateConseilCode();
                      setGeneratingConseilCode(false);
                    }}
                    disabled={generatingConseilCode}
                  >
                    {generatingConseilCode
                      ? <ActivityIndicator size="small" color="#0891B2" />
                      : <Ionicons name="add-circle-outline" size={14} color="#0891B2" />}
                    <Text style={[styles.catCodeBtnGenerateText, { color: "#0891B2" }]}>Générer</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

        </>
      )}

      {isAdmin && currentCopro && adminTab === "config" && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Position du bâtiment</Text>
            <Text style={styles.sectionDesc}>
              Définissez la localisation GPS pour obliger les prestataires à être sur place (rayon 300m).
            </Text>
            {currentCopro.latitude ? (
              <View style={styles.locStatus}>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                <Text style={styles.locStatusText}>
                  Position définie — rayon {currentCopro.locationRadius ?? 300}m
                </Text>
              </View>
            ) : (
              <View style={styles.locStatus}>
                <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
                <Text style={[styles.locStatusText, { color: COLORS.warning }]}>
                  Aucune position définie — vérification désactivée
                </Text>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [styles.locBtn, pressed && { opacity: 0.8 }, settingLocation && { opacity: 0.6 }]}
              onPress={handleSetLocation}
              disabled={settingLocation}
            >
              {settingLocation
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Ionicons name="locate-outline" size={16} color={COLORS.primary} />
              }
              <Text style={styles.locBtnText}>
                {currentCopro.latitude ? "Mettre à jour la position" : "Définir avec ma position actuelle"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vérification présence sur site</Text>
            <Text style={styles.sectionDesc}>
              Si activé, les prestataires doivent être à moins de {currentCopro.locationRadius ?? 300}m de la résidence pour soumettre un rapport d'intervention. Nécessite une position GPS définie.
            </Text>
            <View style={[styles.sectionRow, { marginTop: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>
                  {currentCopro.requireOnsiteCheck ? "Vérification activée ✓" : "Vérification désactivée"}
                </Text>
                {!currentCopro.latitude && currentCopro.requireOnsiteCheck && (
                  <Text style={{ fontSize: 12, color: COLORS.warning, marginTop: 2 }}>
                    ⚠ Définissez d'abord une position GPS
                  </Text>
                )}
              </View>
              <Switch
                value={!!currentCopro.requireOnsiteCheck}
                onValueChange={async (val) => {
                  await updateDoc(doc(db, "copros", currentCopro.id), { requireOnsiteCheck: val });
                }}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Configuration nettoyage</Text>
              {savingBuildingConfig && <ActivityIndicator size="small" color={COLORS.teal} />}
            </View>
            <Text style={styles.sectionDesc}>
              Définissez la structure du bâtiment pour générer automatiquement la liste des parties à nettoyer (hall, escaliers, paliers, cabine ascenseur, portes palières…). Chaque zone peut être cochée lors d'une intervention de nettoyage.
            </Text>

            <Text style={styles.buildingSubtitle}>Bâtiments</Text>

            {(buildingConfig.buildings ?? []).map((building, idx) => (
              <View key={idx} style={styles.buildingCard}>
                <View style={styles.buildingCardHeader}>
                  <TextInput
                    style={styles.buildingNameInput}
                    value={building.name}
                    onChangeText={(v) => updateBuildingName(idx, v)}
                    placeholder="Nom du bâtiment"
                    placeholderTextColor={COLORS.textMuted}
                    maxLength={30}
                  />
                  {(buildingConfig.buildings ?? []).length > 1 && (
                    <Pressable onPress={() => removeBuilding(idx)} style={styles.buildingRemoveBtn}>
                      <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                    </Pressable>
                  )}
                </View>
                <View style={[styles.buildingRow, { paddingHorizontal: 12, flex: 1 }]}>
                  <Text style={[styles.buildingRowLabel, { flex: 1 }]}>Nombre d'étages</Text>
                  <View style={styles.stepperWrap}>
                    <Pressable
                      style={styles.stepperBtn}
                      onPress={() => updateBuildingFloors(idx, building.floors - 1)}
                    >
                      <Ionicons name="remove" size={16} color={COLORS.primary} />
                    </Pressable>
                    <Text style={styles.stepperValue}>{building.floors}</Text>
                    <Pressable
                      style={styles.stepperBtn}
                      onPress={() => updateBuildingFloors(idx, building.floors + 1)}
                    >
                      <Ionicons name="add" size={16} color={COLORS.primary} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}

            <Pressable
              style={styles.addBuildingBtn}
              onPress={addBuilding}
              disabled={(buildingConfig.buildings ?? []).length >= 10}
            >
              <Ionicons name="add-circle-outline" size={16} color={COLORS.teal} />
              <Text style={styles.addBuildingBtnText}>Ajouter un bâtiment</Text>
            </Pressable>

            {([
              { key: "hasElevator", label: "Ascenseur (ajouter au nettoyage)" },
              { key: "hasCellar", label: "Cave / Sous-sol" },
              { key: "hasParking", label: "Parking voitures" },
              { key: "hasBikeParking", label: "Parking vélos" },
              { key: "hasTrashRoom", label: "Local poubelles" },
              { key: "hasExteriorAccess", label: "Accès extérieur" },
            ] as { key: keyof BuildingConfig; label: string }[]).map(({ key, label }) => (
              <Pressable
                key={key}
                style={styles.buildingToggleRow}
                onPress={() => updateBuildingConfigField(key, !buildingConfig[key])}
              >
                <Text style={styles.buildingRowLabel}>{label}</Text>
                <View style={[styles.toggle, !!buildingConfig[key] && styles.toggleActive]}>
                  <View style={[styles.toggleThumb, !!buildingConfig[key] && styles.toggleThumbActive]} />
                </View>
              </Pressable>
            ))}

            <View style={styles.customAreasSection}>
              <Text style={styles.buildingSubtitle}>Zones personnalisées</Text>
              {buildingConfig.customAreas.map((area, idx) => (
                <View key={idx} style={styles.customAreaRow}>
                  <Text style={styles.customAreaText}>{area}</Text>
                  <Pressable onPress={() => removeCustomArea(idx)} style={styles.customAreaRemove}>
                    <Ionicons name="close-circle" size={18} color={COLORS.danger} />
                  </Pressable>
                </View>
              ))}
              <View style={styles.customAreaInput}>
                <TextInput
                  style={styles.customAreaTextInput}
                  value={newCustomArea}
                  onChangeText={setNewCustomArea}
                  placeholder="Ex: Terrasse, Local technique..."
                  placeholderTextColor={COLORS.textMuted}
                  onSubmitEditing={addCustomArea}
                  returnKeyType="done"
                  maxLength={50}
                />
                <Pressable
                  style={[styles.customAreaAddBtn, !newCustomArea.trim() && { opacity: 0.4 }]}
                  onPress={addCustomArea}
                  disabled={!newCustomArea.trim()}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                </Pressable>
              </View>
            </View>

            <View style={styles.buildingPreview}>
              <Ionicons name="list-outline" size={13} color={COLORS.textMuted} />
              <Text style={styles.buildingPreviewText}>
                {generateCleaningAreas(buildingConfig).length} zones générées
              </Text>
            </View>

            <Pressable
              style={[styles.buildingSaveBtn, savingBuildingConfig && { opacity: 0.6 }]}
              onPress={handleSaveBuildingConfig}
              disabled={savingBuildingConfig}
            >
              {savingBuildingConfig
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="save-outline" size={16} color="#fff" />
              }
              <Text style={styles.buildingSaveBtnText}>Enregistrer la configuration</Text>
            </Pressable>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Catégories d'interventions</Text>
              {savingCategories && <ActivityIndicator size="small" color={COLORS.primary} />}
            </View>
            <Text style={styles.sectionDesc}>
              Activez uniquement les catégories adaptées à votre copropriété.
            </Text>
            {OPTIONAL_CATEGORIES.map((cat) => {
              const disabled = disabledCategories.includes(cat);
              const iconName = CATEGORY_ICONS[cat] as keyof typeof Ionicons.glyphMap;
              return (
                <Pressable
                  key={cat}
                  onPress={() => !savingCategories && handleToggleCategory(cat)}
                  style={styles.categoryToggleRow}
                >
                  <View style={[styles.categoryIcon, !disabled && { backgroundColor: "#EFF6FF" }]}>
                    <Ionicons name={iconName} size={16} color={!disabled ? COLORS.primary : COLORS.textMuted} />
                  </View>
                  <Text style={[styles.categoryToggleLabel, disabled && { color: COLORS.textMuted }]}>
                    {CATEGORY_LABELS[cat]}
                  </Text>
                  <View style={[styles.toggle, !disabled && styles.toggleActive]}>
                    <View style={[styles.toggleThumb, !disabled && styles.toggleThumbActive]} />
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <View style={styles.codeRoleLabel}>
                <Ionicons name="key-outline" size={14} color="#7C3AED" />
                <Text style={[styles.codeRoleLabelText, { color: "#7C3AED" }]}>Codes par prestation</Text>
              </View>
            </View>
            <Text style={styles.sectionDesc}>
              Générez un code par type de prestation. Le prestataire ne verra que les interventions de sa catégorie.
            </Text>
            {ALL_CATEGORIES.filter((c) => !disabledCategories.includes(c)).map((cat) => {
              const iconName = CATEGORY_ICONS[cat] as keyof typeof Ionicons.glyphMap;
              const catCode = currentCopro.categoryInviteCodes?.[cat];
              const isGenerating = generatingCatCode === cat;
              const isCopied = copiedCatCode === cat;
              return (
                <View key={cat} style={styles.catCodeRow}>
                  <View style={styles.catCodeLeft}>
                    <View style={styles.catCodeIcon}>
                      <Ionicons name={iconName} size={15} color={COLORS.primary} />
                    </View>
                    <View>
                      <Text style={styles.catCodeLabel}>{CATEGORY_LABELS[cat]}</Text>
                      {catCode ? (
                        <Text style={styles.catCodeValue}>{catCode}</Text>
                      ) : (
                        <Text style={styles.catCodeNone}>Aucun code généré</Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.catCodeActions}>
                    {catCode ? (
                      <>
                        <Pressable
                          style={[styles.catCodeBtn, isCopied && { backgroundColor: COLORS.success }]}
                          onPress={async () => {
                            await Clipboard.setStringAsync(catCode);
                            setCopiedCatCode(cat);
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            setTimeout(() => setCopiedCatCode(null), 2000);
                          }}
                        >
                          <Ionicons name={isCopied ? "checkmark" : "copy-outline"} size={14} color={isCopied ? "#fff" : COLORS.primary} />
                        </Pressable>
                        <Pressable style={[styles.catCodeBtn, { backgroundColor: COLORS.primary }]} onPress={() => handleShareCategoryCode(cat)}>
                          <Ionicons name="share-outline" size={14} color="#fff" />
                        </Pressable>
                      </>
                    ) : (
                      <Pressable
                        style={[styles.catCodeBtnGenerate, isGenerating && { opacity: 0.6 }]}
                        onPress={() => !isGenerating && handleGenerateCategoryCode(cat)}
                        disabled={isGenerating}
                      >
                        {isGenerating
                          ? <ActivityIndicator size="small" color="#7C3AED" />
                          : <Ionicons name="add-circle-outline" size={14} color="#7C3AED" />}
                        <Text style={styles.catCodeBtnGenerateText}>Générer</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Informations légales du syndic</Text>
            <Text style={styles.sectionDesc}>
              Ces informations apparaissent dans le pied de page des bons de commande générés. Chaque résidence a ses propres informations.
            </Text>
            <TextInput
              style={styles.legalInput}
              placeholder="Nom de la société syndic"
              placeholderTextColor={COLORS.textMuted}
              value={syndicCompanyName}
              onChangeText={setSyndicCompanyName}
            />
            <TextInput
              style={styles.legalInput}
              placeholder="SIRET (ex : 123 456 789 00012)"
              placeholderTextColor={COLORS.textMuted}
              value={syndicSiret}
              onChangeText={setSyndicSiret}
              keyboardType="numeric"
            />
            <TextInput
              style={styles.legalInput}
              placeholder="Téléphone"
              placeholderTextColor={COLORS.textMuted}
              value={syndicPhone}
              onChangeText={setSyndicPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.legalInput}
              placeholder="Forme juridique (SARL, SAS, bénévole…)"
              placeholderTextColor={COLORS.textMuted}
              value={syndicLegalForm}
              onChangeText={setSyndicLegalForm}
            />
            <Pressable
              style={[styles.locBtn, savingLegal && { opacity: 0.6 }]}
              onPress={handleSaveLegalInfo}
              disabled={savingLegal}
            >
              {savingLegal
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Ionicons name="save-outline" size={16} color={COLORS.primary} />
              }
              <Text style={styles.locBtnText}>Enregistrer</Text>
            </Pressable>
          </View>

        </>
      )}

      {isAdmin && currentCopro && adminTab === "membres" && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Membres ({members.length})</Text>
              <Pressable onPress={handleRefresh}>
                {refreshing
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Ionicons name="refresh-outline" size={18} color={COLORS.primary} />
                }
              </Pressable>
            </View>
            {members.map((m) => (
              <View key={m.uid} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberAvatarText}>
                    {(m.displayName || m.email || "?")[0].toUpperCase()}
                  </Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{m.displayName || m.email}</Text>
                  <Text style={styles.memberEmail}>{m.email}</Text>
                </View>
                <Pressable
                  style={[
                    styles.memberRoleBadge,
                    m.role === "admin" && styles.memberRoleAdmin,
                    m.role === "propriétaire" && styles.memberRoleOwner,
                    m.role === "conseil" && { backgroundColor: "#E0F2FE" },
                    m.role === "prestataire" && { backgroundColor: "#F3E8FF" },
                    (m.role === "propriétaire" || m.role === "conseil") && { borderWidth: 1, borderColor: m.role === "conseil" ? "#0891B2" : "#0D9488" },
                  ]}
                  onPress={() => (m.role === "propriétaire" || m.role === "conseil") ? handleChangeRole(m.uid, m.role, m.displayName || m.email || m.uid) : undefined}
                >
                  <Text style={[
                    styles.memberRoleText,
                    m.role === "admin" && styles.memberRoleTextAdmin,
                    m.role === "propriétaire" && styles.memberRoleTextOwner,
                    m.role === "conseil" && { color: "#0891B2" },
                    m.role === "prestataire" && { color: "#7C3AED" },
                  ]}>
                    {m.role === "admin" ? "Admin" : m.role === "propriétaire" ? "Propriétaire ✎" : m.role === "conseil" ? "Conseil ✎" : m.role === "prestataire" ? "Prestataire" : "Collaborateur"}
                  </Text>
                </Pressable>
                {m.role === "prestataire" && (
                  <Pressable
                    style={styles.memberDeleteBtn}
                    onPress={() => handleRemoveMember(m.uid, m.displayName || m.email || m.uid)}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </>
      )}

      {copros.length > 1 && adminTab === "copro" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mes copropriétés</Text>
          {copros.map((c) => (
            <Pressable
              key={c.id}
              style={[styles.coProPickerItem, c.id === currentCopro?.id && styles.coProPickerActive]}
              onPress={() => switchCoPro(c.id)}
            >
              <Text style={styles.coProPickerName}>{c.name}</Text>
              {c.id === currentCopro?.id && <Ionicons name="checkmark-circle" size={18} color={COLORS.primary} />}
            </Pressable>
          ))}
        </View>
      )}

      {isAdmin && adminTab === "compte" && (
        <View style={styles.section}>
          <Pressable
            style={styles.statsNavBtn}
            onPress={() => router.push("/(app)/conseil-finances" as any)}
          >
            <View style={styles.statsNavIcon}>
              <Ionicons name="wallet-outline" size={18} color="#0891B2" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Contrôle des comptes</Text>
              <Text style={styles.statsNavSub}>Dépenses, budget prévisionnel, synthèse</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.statsNavBtn, { marginTop: 1 }]}
            onPress={() => router.push("/(app)/demandes-devis" as any)}
          >
            <View style={[styles.statsNavIcon, { backgroundColor: "#FEF3C7" }]}>
              <Ionicons name="document-text-outline" size={18} color="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Demandes de devis</Text>
              <Text style={styles.statsNavSub}>Tickets · Appels d'offres · Comparatif de prix</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.statsNavBtn, { marginTop: 1 }]}
            onPress={() => router.push("/(app)/entretien" as any)}
          >
            <View style={[styles.statsNavIcon, { backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="clipboard-outline" size={18} color="#16A34A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Carnet d'entretien</Text>
              <Text style={styles.statsNavSub}>Ascenseur, VMC, chaufferie… · Historique des visites</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
        </View>
      )}

      {currentRole === "conseil" && adminTab === "compte" && (
        <View style={styles.section}>
          <View style={styles.conseilInfoCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Ionicons name="shield-checkmark-outline" size={20} color="#0891B2" />
              <Text style={styles.conseilInfoTitle}>Conseil syndical</Text>
            </View>
            <Text style={styles.conseilInfoText}>
              En tant que membre du conseil syndical, vous contrôlez les comptes de la copropriété.
              Le syndic ne peut pas modifier les données financières sans votre validation.
            </Text>
            <Text style={[styles.conseilInfoText, { marginTop: 6 }]}>
              Un trésorier est élu parmi les membres du conseil pour saisir les dépenses et le budget prévisionnel.
            </Text>
          </View>
          <Pressable
            style={[styles.statsNavBtn, { marginTop: 0 }]}
            onPress={() => router.push("/(app)/conseil-finances" as any)}
          >
            <View style={[styles.statsNavIcon, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="stats-chart-outline" size={18} color="#0891B2" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Contrôle des comptes</Text>
              <Text style={styles.statsNavSub}>Dépenses réelles · Budget AG · Comparatif · Vote trésorier</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.statsNavBtn, { marginTop: 1 }]}
            onPress={() => router.push("/(app)/entretien" as any)}
          >
            <View style={[styles.statsNavIcon, { backgroundColor: "#F0FDF4" }]}>
              <Ionicons name="clipboard-outline" size={18} color="#16A34A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Carnet d'entretien</Text>
              <Text style={styles.statsNavSub}>Ascenseur, VMC, chaufferie… · Historique des visites</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
        </View>
      )}

      {isAdmin && adminTab === "compte" && (
        <View style={styles.section}>
          <Pressable
            style={styles.statsNavBtn}
            onPress={() => router.push("/(app)/annuaire-prestataires" as any)}
          >
            <View style={styles.statsNavIcon}>
              <Ionicons name="people-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Annuaire prestataires</Text>
              <Text style={styles.statsNavSub}>Gérer vos contacts prestataires</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
          <Pressable
            style={[styles.statsNavBtn, { marginTop: 1 }]}
            onPress={() => router.push("/(app)/stats")}
          >
            <View style={styles.statsNavIcon}>
              <Ionicons name="bar-chart-outline" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statsNavLabel}>Statistiques & rapport</Text>
              <Text style={styles.statsNavSub}>Export PDF annuel et tableau de bord</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
          </Pressable>
        </View>
      )}

      {isAdmin && adminTab === "compte" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ma signature</Text>
          <View style={styles.sigModelCard}>
            {signatureModelSvg ? (
              <View style={[styles.sigModelPreview, { width: SIG_W, height: SIG_H }]}>
                <SvgXml xml={signatureModelSvg} width={SIG_W} height={SIG_H} />
              </View>
            ) : (
              <View style={styles.sigModelEmpty}>
                <Ionicons name="create-outline" size={28} color={COLORS.textMuted} />
                <Text style={styles.sigModelEmptyText}>Aucune signature enregistrée</Text>
              </View>
            )}
            <Pressable
              style={styles.sigModelBtn}
              onPress={() => {
                setSigStrokes([]); sigStrokesRef.current = [];
                setSigLiveStroke([]);
                sigCurrentStroke.current = [];
                setSignPadVisible(true);
              }}
            >
              <Ionicons name="create-outline" size={15} color={COLORS.primary} />
              <Text style={styles.sigModelBtnText}>
                {signatureModelUrl ? "Modifier ma signature" : "Créer ma signature"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {adminTab === "compte" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Aide & informations</Text>

            <Pressable
              style={styles.infoRow}
              onPress={() => router.push("/(legal)/contact")}
            >
              <View style={styles.infoLeft}>
                <Ionicons name="mail-outline" size={18} color={COLORS.primary} />
                <Text style={styles.infoText}>Contact</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>

            <Pressable
              style={styles.infoRow}
              onPress={() => router.push("/(legal)/confidentialite")}
            >
              <View style={styles.infoLeft}>
                <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.primary} />
                <Text style={styles.infoText}>Confidentialité</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>

            <Pressable 

            style={styles.infoRow} 
            onPress={() => router.push("/(legal)/cgu")}
             >

           <View style={styles.infoLeft}>
                <Ionicons name="document-text-outline" size={18} color={COLORS.primary} />
                <Text style={styles.infoText}>Conditions d’utilisation</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </Pressable>
          </View>
      )}

      {adminTab === "compte" && (
      <View style={styles.accountSection}>
        {/* Changer de profil */}
        <Pressable
          style={styles.logoutRow}
          onPress={() => wConfirm(
            "Changer de profil",
            "Vous allez retourner à l'écran de sélection de profil. Vos données restent intactes.",
            async () => { try { await resetUserType(); } catch {} },
            "Changer",
          )}
        >
          <Ionicons name="swap-horizontal-outline" size={18} color={COLORS.textSecondary} />
          <Text style={[styles.logoutText, { color: COLORS.textSecondary }]}>Changer de profil</Text>
        </Pressable>

        <Pressable style={styles.logoutRow} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
        <Pressable style={styles.deleteAccountRow} onPress={handleDeleteAccount}>
          <Ionicons name="trash-outline" size={16} color={COLORS.textMuted} />
          <Text style={styles.deleteAccountText}>Supprimer mon compte</Text>
        </Pressable>
      </View>
      )}
    </ScrollView>

    {/* ── Modal signature modèle ── */}
    <Modal visible={signPadVisible} animationType="slide" presentationStyle="fullScreen">
      <View style={[styles.modal, { paddingTop: insets.top + 16 }]}>
        <View style={styles.modalTopBar}>
          <Pressable onPress={() => { setSignPadVisible(false); setSigStrokes([]); sigStrokesRef.current = []; setSigLiveStroke([]); }}>
            <Text style={styles.modalCancelText}>Annuler</Text>
          </Pressable>
          <Text style={styles.modalTitleText}>Ma signature</Text>
          <Pressable onPress={handleSaveSignatureModel} disabled={savingSig || sigStrokes.length === 0}>
            {savingSig
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <Text style={[styles.modalSaveText, sigStrokes.length === 0 && { opacity: 0.4 }]}>Enregistrer</Text>
            }
          </Pressable>
        </View>
        <View style={styles.sigPadBody}>
          <Text style={styles.sigPadHint}>Dessinez votre signature dans le cadre ci-dessous</Text>
          <View style={[styles.sigPadCanvas, { width: SIG_W, height: SIG_H }]} pointerEvents="box-only" {...sigPanResponder.panHandlers}>
            <Svg width={SIG_W} height={SIG_H}>
              {sigStrokes.map((pts, i) => (
                <Path key={i} d={sigPointsToPath(pts)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {sigLiveStroke.length > 1 && (
                <Path d={sigPointsToPath(sigLiveStroke)} stroke="#1E293B" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </Svg>
          </View>
          <Pressable
            style={styles.sigClearBtn}
            onPress={() => { setSigStrokes([]); sigStrokesRef.current = []; setSigLiveStroke([]); sigCurrentStroke.current = []; }}
          >
            <Ionicons name="trash-outline" size={15} color={COLORS.textMuted} />
            <Text style={styles.sigClearBtnText}>Effacer</Text>
          </Pressable>
          <Text style={styles.sigLegalText}>
            Cette signature sera enregistrée dans votre profil et appliquée automatiquement lors de la validation des bons de commande.
          </Text>
        </View>
      </View>
    </Modal>

    <Modal
      visible={inviteModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setInviteModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Inviter un membre</Text>
            <Pressable onPress={() => setInviteModalVisible(false)} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={22} color={COLORS.text} />
            </Pressable>
          </View>

          <Text style={styles.modalSectionLabel}>Rôle</Text>
          <View style={styles.rolePickerRow}>
            {(["propriétaire", "collaborateur", "conseil", "prestataire"] as const).map((r) => {
              const active = inviteRole === r;
              const label = r === "propriétaire" ? "Propriétaire" : r === "collaborateur" ? "Collaborateur" : r === "conseil" ? "Conseil syndical" : "Prestataire";
              const icon = r === "propriétaire" ? "home-outline" : r === "collaborateur" ? "people-outline" : r === "conseil" ? "shield-checkmark-outline" : "construct-outline";
              const color = r === "propriétaire" ? COLORS.teal : r === "collaborateur" ? COLORS.primary : r === "conseil" ? "#0891B2" : "#7C3AED";
              return (
                <Pressable
                  key={r}
                  onPress={() => { Haptics.selectionAsync(); setInviteRole(r); }}
                  style={[styles.rolePickerCard, active && { borderColor: color, backgroundColor: `${color}12` }]}
                >
                  <Ionicons name={icon as any} size={20} color={active ? color : COLORS.textMuted} />
                  <Text style={[styles.rolePickerLabel, active && { color }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {inviteRole === "prestataire" && (
            <>
              <Text style={styles.modalSectionLabel}>Catégorie de prestation</Text>
              <View style={styles.catPickerGrid}>
                {ALL_CATEGORIES.map((cat) => {
                  const active = inviteCategory === cat;
                  const iconName = CATEGORY_ICONS[cat] as keyof typeof Ionicons.glyphMap;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => { Haptics.selectionAsync(); setInviteCategory(cat); }}
                      style={[styles.catPickerChip, active && styles.catPickerChipActive]}
                    >
                      <Ionicons name={iconName} size={14} color={active ? "#fff" : COLORS.textMuted} />
                      <Text style={[styles.catPickerChipText, active && { color: "#fff" }]}>
                        {CATEGORY_LABELS[cat]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <InviteCodePreview
            code={getInviteCode()}
            isPrestataireRole={inviteRole === "prestataire"}
          />

          {inviteGenerating ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 16 }} />
          ) : (
            <View style={styles.inviteActions}>
              <Pressable
                style={[styles.inviteActionBtn, styles.inviteActionShare]}
                onPress={() => handleSendInvite("share")}
              >
                <Ionicons name="share-social-outline" size={18} color="#fff" />
                <Text style={styles.inviteActionText}>Partager</Text>
              </Pressable>
              <Pressable
                style={[styles.inviteActionBtn, styles.inviteActionSms]}
                onPress={() => handleSendInvite("sms")}
              >
                <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                <Text style={styles.inviteActionText}>SMS</Text>
              </Pressable>
              <Pressable
                style={[styles.inviteActionBtn, styles.inviteActionEmail]}
                onPress={() => handleSendInvite("email")}
              >
                <Ionicons name="mail-outline" size={18} color="#fff" />
                <Text style={styles.inviteActionText}>E-mail</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  content: { paddingHorizontal: 20, gap: 16 },
  adminTabBar: {
    flexDirection: "row", backgroundColor: COLORS.surface,
    borderRadius: 14, padding: 4, marginBottom: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  adminTabBtn: {
    flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center",
    paddingVertical: 8, borderRadius: 10, gap: 3,
  },
  adminTabBtnActive: { backgroundColor: COLORS.background },
  adminTabLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  adminTabLabelActive: { color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  pageTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text },
  coProSwitcherBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#EFF6FF", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: "#BFDBFE", maxWidth: 160,
  },
  coProSwitcherText: { fontSize: 11, fontFamily: "Inter_500Medium", color: COLORS.primary, flex: 1 },
  profileCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: COLORS.surface, borderRadius: 18,
    padding: 16, borderWidth: 1, borderColor: COLORS.border,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  userName: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  userEmail: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  roleBadge: {
    backgroundColor: "#EFF6FF", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 2, marginTop: 4, alignSelf: "flex-start",
  },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  section: {
    backgroundColor: COLORS.surface, borderRadius: 18,
    padding: 16, borderWidth: 1, borderColor: COLORS.border, gap: 12,
  },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 },
  toggleLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  coProInfo: { gap: 8 },
  coProRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  coProName: { fontSize: 15, fontFamily: "Inter_500Medium", color: COLORS.text, flex: 1 },
  coProAddr: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted, flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  subscriptionBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#ECFDF5", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: "#A7F3D0",
  },
  subscriptionText: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#065F46", flex: 1 },
  subscriptionBadgeTrial: {
    backgroundColor: "rgba(124,58,237,0.08)", borderColor: "rgba(124,58,237,0.25)",
  },
  portalBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  portalBtnText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.primary },
  codeRoleLabel: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    backgroundColor: "rgba(37,99,235,0.08)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  codeRoleLabelText: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.primary,
  },
  codeBox: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 14,
    padding: 16, alignItems: "center",
    borderWidth: 1.5, borderColor: COLORS.border, borderStyle: "dashed",
  },
  codeValue: { fontSize: 32, fontFamily: "Inter_700Bold", color: COLORS.primary, letterSpacing: 6 },
  codeActions: { flexDirection: "row", gap: 10 },
  codeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: "#EFF6FF", borderRadius: 12, height: 42,
  },
  codeBtnSuccess: { backgroundColor: COLORS.success },
  codeBtnPrimary: { backgroundColor: COLORS.primary },
  codeBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  memberRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  memberAvatar: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center",
  },
  memberAvatarText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: COLORS.textSecondary },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  memberEmail: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  memberRoleBadge: {
    backgroundColor: "#F1F5F9", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  memberRoleAdmin: { backgroundColor: "#EFF6FF" },
  memberRoleOwner: { backgroundColor: "rgba(14,186,170,0.1)" },
  memberRoleText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },
  memberRoleTextAdmin: { color: COLORS.primary },
  memberRoleTextOwner: { color: COLORS.teal },
  memberDeleteBtn: {
    width: 32, height: 32, borderRadius: 8, marginLeft: 6,
    backgroundColor: "rgba(239,68,68,0.08)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(239,68,68,0.18)",
  },
  unreadBadge: {
    backgroundColor: "#F59E0B", borderRadius: 10,
    minWidth: 20, height: 20, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  emailToggleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  emailToggleLabel: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textSecondary },
  signalRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  signalRowUnread: { backgroundColor: "rgba(245,158,11,0.04)", marginHorizontal: -16, paddingHorizontal: 16 },
  signalIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: "rgba(245,158,11,0.1)", alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  signalIconWrapAck: { backgroundColor: "rgba(16,185,129,0.1)" },
  signalFrom: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  signalAppt: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  signalDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  signalMsg: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.text, lineHeight: 18 },
  signalMsgRead: { color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  signalPhoto: { width: "100%", height: 120, borderRadius: 10, marginTop: 4 },
  signalPhotoZoom: {
    position: "absolute", bottom: 6, right: 6,
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 10, padding: 4,
  },
  ackBadge: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    backgroundColor: "#D1FAE5", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  ackBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.success },
  ackBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  ackBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#F59E0B", marginTop: 6,
  },
  coProPickerItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  coProPickerActive: {},
  coProPickerName: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  superAdminBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: COLORS.dark, borderRadius: 16, padding: 16,
  },
  superAdminBtnText: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  statsNavBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: COLORS.background, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  statsNavIcon: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "rgba(37,99,235,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  statsNavLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  statsNavSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  conseilInfoCard: {
    backgroundColor: "#EFF6FF", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#BFDBFE", marginBottom: 12,
  },
  conseilInfoTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#1E40AF" },
  conseilInfoText: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#1D4ED8", lineHeight: 18 },
  accountSection: { gap: 8 },
  logoutRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FEF2F2", borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: "#FECACA",
  },
  logoutText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.danger },
  deleteCoProBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 12, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)",
    backgroundColor: "rgba(239,68,68,0.06)",
  },
  deleteCoProText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.danger },
  deleteAccountRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
  },
  deleteAccountText: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  locStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  locStatusText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.success, flex: 1 },
  locBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#EFF6FF", borderRadius: 12, height: 44,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  locBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.primary },
  categoryToggleRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  categoryIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: COLORS.surfaceAlt, alignItems: "center", justifyContent: "center",
  },
  categoryToggleLabel: {
    flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text,
  },
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: COLORS.border, justifyContent: "center", paddingHorizontal: 3,
  },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff",
    elevation: 2,
    shadowColor: "#000", shadowOpacity: 0.15, shadowOffset: { width: 0, height: 1 }, shadowRadius: 2,
  },
  toggleThumbActive: { transform: [{ translateX: 18 }] },
  catCodeRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border, gap: 10,
  },
  catCodeLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  catCodeIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center",
  },
  catCodeLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  catCodeValue: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#7C3AED", letterSpacing: 1 },
  catCodeNone: { fontSize: 11, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  catCodeActions: { flexDirection: "row", gap: 6 },
  catCodeBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  catCodeBtnGenerate: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(124,58,237,0.08)", borderRadius: 8,
    paddingHorizontal: 10, height: 32,
    borderWidth: 1, borderColor: "rgba(124,58,237,0.2)",
  },
  catCodeBtnGenerateText: { fontSize: 12, fontFamily: "Inter_500Medium", color: "#7C3AED" },

  inviteBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    marginHorizontal: 20, borderRadius: 18, padding: 16,
    backgroundColor: COLORS.primary,
  },
  inviteBtnIcon: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center", justifyContent: "center",
  },
  inviteBtnTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

  
  inviteBtnSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.75)",
    marginTop: 2,
  },

  invitePrestataireBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 20,
    marginTop: -4,
    borderRadius: 18,
    padding: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  invitePrestataireIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  invitePrestataireTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  invitePrestataireSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
  },
  modalHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, alignSelf: "center", marginBottom: 16,
  },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: COLORS.text },
  modalCloseBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center",
  },
  modalSectionLabel: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted, letterSpacing: 0.5,
    textTransform: "uppercase", marginBottom: 10,
  },
  rolePickerRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  rolePickerCard: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, gap: 6,
  },
  rolePickerLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted },

  catPickerGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  catPickerChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
  },
  catPickerChipActive: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  catPickerChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.textMuted },

  inviteCodePreview: {
    backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 20, gap: 8,
  },
  inviteCodePreviewHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  inviteCodePreviewLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: COLORS.primary },
  inviteCodeValue: {
    fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text,
    letterSpacing: 3, textAlign: "center", paddingVertical: 4,
  },
  inviteCodePlaceholder: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center", paddingVertical: 6,
  },

  inviteActions: { flexDirection: "row", gap: 10 },
  inviteActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14,
  },
  inviteActionText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  inviteActionShare: { backgroundColor: COLORS.primary },
  inviteActionSms: { backgroundColor: COLORS.teal },
  inviteActionEmail: { backgroundColor: "#7C3AED" },

  buildingRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  buildingToggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  buildingRowLabel: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.text },
  buildingSubtitle: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: COLORS.textMuted,
    textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8, marginTop: 4,
  },
  stepperWrap: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.surfaceAlt, borderRadius: 10, padding: 4,
  },
  stepperBtn: {
    width: 30, height: 30, borderRadius: 8, backgroundColor: COLORS.surface,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  stepperValue: {
    fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text,
    minWidth: 32, textAlign: "center",
  },
  customAreasSection: { marginTop: 12 },
  customAreaRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  customAreaText: { fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text, flex: 1 },
  customAreaRemove: { padding: 4 },
  customAreaInput: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8,
  },
  customAreaTextInput: {
    flex: 1, height: 40, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10, paddingHorizontal: 12,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    backgroundColor: COLORS.surface,
  },
  customAreaAddBtn: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.teal,
    alignItems: "center", justifyContent: "center",
  },
  buildingPreview: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, paddingHorizontal: 8,
  },
  buildingPreviewText: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted },
  buildingSaveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, marginTop: 14, backgroundColor: COLORS.teal,
    borderRadius: 12, paddingVertical: 13,
  },
  buildingSaveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },

  buildingCard: {
    backgroundColor: COLORS.surfaceAlt, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10, overflow: "hidden",
  },
  buildingCardHeader: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingTop: 10, paddingBottom: 6, gap: 8,
  },
  buildingNameInput: {
    flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: COLORS.surface,
  },
  buildingRemoveBtn: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: "#FEE2E2",
    alignItems: "center", justifyContent: "center",
  },
  addBuildingBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center",
    paddingVertical: 10, borderWidth: 1, borderColor: COLORS.teal,
    borderRadius: 10, marginBottom: 14, borderStyle: "dashed",
  },
  addBuildingBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.teal },

  
// Style Aides et confidentialité

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  
  infoLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  
  infoText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
  },

  // Signature modèle
  sigModelCard: {
    backgroundColor: "#fff", borderRadius: 14, borderWidth: 1,
    borderColor: COLORS.border, overflow: "hidden",
  },
  sigModelPreview: {
    backgroundColor: "#FAFAFA", borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  sigModelEmpty: {
    alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 32, backgroundColor: "#FAFAFA",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  sigModelEmptyText: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  sigModelBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  sigModelBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.primary },

  // Pad modal
  modal: { flex: 1, backgroundColor: "#fff" },
  modalTopBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  modalCancelText: { fontSize: 15, color: COLORS.textMuted, fontFamily: "Inter_400Regular" },
  modalTitleText: { fontSize: 16, fontFamily: "Inter_700Bold", color: COLORS.text },
  modalSaveText: { fontSize: 15, color: COLORS.primary, fontFamily: "Inter_600SemiBold" },
  sigPadBody: { padding: 20, alignItems: "center" },
  sigPadHint: { fontSize: 13, color: COLORS.textMuted, fontFamily: "Inter_400Regular", marginBottom: 14, alignSelf: "flex-start" },
  sigPadCanvas: {
    borderWidth: 2, borderColor: COLORS.border, borderRadius: 12,
    backgroundColor: "#FAFAFA", overflow: "hidden",
  },
  sigClearBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 12, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: COLORS.surface, alignSelf: "flex-end",
  },
  sigClearBtnText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.textMuted },
  sigLegalText: {
    fontSize: 11, color: COLORS.textMuted, fontFamily: "Inter_400Regular",
    textAlign: "center", lineHeight: 16, marginTop: 20,
  },
  legalInput: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: "Inter_400Regular", color: COLORS.text,
    backgroundColor: COLORS.surface, marginBottom: 10,
  },
});
