import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Linking, Modal, Platform, Pressable,
  ScrollView, Share, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
  const { user, isSuperAdmin, logout, deleteAccount } = useAuth();
  const { currentCopro, currentRole, members, copros, switchCoPro, refreshCoPros, userSubscription, generateCategoryCode, removeMember } = useCoPro();
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedOwnerCode, setCopiedOwnerCode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingLocation, setSettingLocation] = useState(false);
  const [savingCategories, setSavingCategories] = useState(false);
  const [generatingCatCode, setGeneratingCatCode] = useState<Category | null>(null);
  const [copiedCatCode, setCopiedCatCode] = useState<Category | null>(null);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteRole, setInviteRole] = useState<"collaborateur" | "propriétaire" | "prestataire">("collaborateur");
  const [inviteCategory, setInviteCategory] = useState<Category>("nettoyage");
  const [inviteGenerating, setInviteGenerating] = useState(false);

  const disabledCategories: Category[] = currentCopro?.disabledCategories ?? [];

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

  useEffect(() => {
    setBuildingConfig(normalizeBuildingConfig(currentCopro?.buildingConfig));
  }, [currentCopro?.id]);

  const buildInviteMessage = (code: string): string => {
    const webBase =
      Platform.OS === "web"
        ? window.location.origin
        : "https://maintena.app";
  
    const webAccessLink = `${webBase}/acces-prestataire?code=${encodeURIComponent(code)}`;
  
    const appLine =
      "Téléchargez Maintena :\n" +
      "App Store : https://apps.apple.com/app/maintena\n" +
      "Google Play : https://play.google.com/store/apps/details?id=com.maintena";
  
    if (inviteRole === "propriétaire") {
      return (
        `Vous êtes invité(e) à rejoindre la copropriété "${currentCopro?.name}" sur Maintena.\n\n` +
        `${appLine}\n\n` +
        `Accès web : ${webAccessLink}\n\n` +
        `Rôle : Propriétaire\n` +
        `Code d'invitation : ${code}`
      );
    }
  
    if (inviteRole === "collaborateur") {
      return (
        `Vous êtes invité(e) à rejoindre la copropriété "${currentCopro?.name}" sur Maintena.\n\n` +
        `${appLine}\n\n` +
        `Accès web : ${webAccessLink}\n\n` +
        `Rôle : Collaborateur\n` +
        `Code d'invitation : ${code}`
      );
    }
  
    return (
      `Vous êtes invité(e) à intervenir dans la copropriété "${currentCopro?.name}" sur Maintena.\n\n` +
      `${appLine}\n\n` +
      `Accès rapide sans installer l'application :\n${webAccessLink}\n\n` +
      `Rôle : Prestataire - ${CATEGORY_LABELS[inviteCategory]}\n` +
      `Code d'accès : ${code}\n\n` +
      `Entrez ce code pour créer votre accès et déclarer votre intervention.`
    );
  };

  const getInviteCode = (): string | null => {
    if (!currentCopro) return null;
    if (inviteRole === "propriétaire") return currentCopro.ownerInviteCode ?? null;
    if (inviteRole === "collaborateur") return currentCopro.inviteCode;
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
        } else if (inviteRole === "propriétaire") {
          Alert.alert("Code manquant", "Veuillez d'abord générer le code propriétaire dans la section Codes.");
          return;
        }
      }
      if (!code) return;
      const message = buildInviteMessage(code);
      if (via === "share") {
        await Share.share({ message });
      } else if (via === "sms") {
        const sep = Platform.OS === "ios" ? "&" : "?";
        await Linking.openURL(`sms:${sep}body=${encodeURIComponent(message)}`);
      } else if (via === "email") {
        const subject = encodeURIComponent(`Invitation Maintena — ${currentCopro.name}`);
        const body = encodeURIComponent(message);
        await Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
      }
    } catch (e: any) {
      Alert.alert("Erreur", e.message ?? "Impossible d'envoyer l'invitation.");
    } finally {
      setInviteGenerating(false);
    }
  };

  const handleRemoveMember = (uid: string, name: string) => {
    Alert.alert(
      "Retirer ce collaborateur",
      `Voulez-vous retirer ${name} de cette copropriété ?`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer", style: "destructive",
          onPress: async () => {
            try {
              await removeMember(uid);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } catch (e: any) {
              Alert.alert("Erreur", e.message ?? "Impossible de retirer ce collaborateur.");
            }
          },
        },
      ]
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
      Alert.alert("Erreur", e.message);
    } finally {
      setSavingBuildingConfig(false);
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
      Alert.alert("Erreur", e.message);
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
    await Share.share({
      message: `Rejoins notre copropriété "${currentCopro.name}" sur Maintena en tant que collaborateur.\nCode d'invitation : ${currentCopro.inviteCode}`,
    });
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
    await Share.share({
      message: `Accédez aux informations de votre copropriété "${currentCopro.name}" sur Maintena.\nCode propriétaire : ${currentCopro.ownerInviteCode}`,
    });
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
      Alert.alert("Erreur", e.message);
    }
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
      Alert.alert("Erreur", e.message);
    } finally {
      setGeneratingCatCode(null);
    }
  };

  const handleShareCategoryCode = async (cat: Category) => {
    if (!currentCopro) return;
    const code = currentCopro.categoryInviteCodes?.[cat];
    if (!code) return;
    await Share.share({
      message: `Code d'accès Maintena — ${CATEGORY_LABELS[cat]}\n\nCode d'accès : ${currentCopro.inviteCode}\nCode prestation : ${code}\n\nCopropriété : ${currentCopro.name}`,
    });
  };

  const handleSetLocation = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Non disponible", "Définissez la position depuis l'application mobile.");
      return;
    }
    setSettingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission refusée", "L'accès à la localisation est nécessaire.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await updateDoc(doc(db, "copros", currentCopro!.id), {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        locationRadius: 300,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Position enregistrée",
        `Bâtiment localisé.\nRayon d'autorisation : 300m\n\nLes prestataires devront être à moins de 300m pour saisir une intervention.`
      );
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setSettingLocation(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      "Déconnexion",
      "Souhaitez-vous vous déconnecter ?",
      [
        { text: "Annuler", style: "cancel" },
        { text: "Déconnexion", style: "destructive", onPress: logout },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Supprimer mon compte",
      "Cette action est irréversible. Toutes vos données seront définitivement effacées. Vos copropriétés et leurs historiques d'interventions resteront accessibles si d'autres membres y sont inscrits.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer", style: "destructive",
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (e: any) {
              Alert.alert("Erreur", e.message ?? "Impossible de supprimer le compte.");
            }
          },
        },
      ]
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
        <Text style={styles.pageTitle}>{isAdmin ? "Gestion" : currentRole === "propriétaire" ? "Mon accès" : "Mon compte"}</Text>
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
              {isAdmin ? "Syndic / Admin" : currentRole === "propriétaire" ? "Propriétaire" : "Collaborateur"}
            </Text>
          </View>
        </View>
      </View>

      {currentCopro && (
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

      {isAdmin && userSubscription?.expiresAt && (
        <View style={[styles.section, { paddingVertical: 0 }]}>
          <View style={styles.subscriptionBadge}>
            <Ionicons name="shield-checkmark" size={14} color={COLORS.success} />
            <Text style={styles.subscriptionText}>
              Abonnement actif jusqu'au{" "}
              {new Date(userSubscription.expiresAt).toLocaleDateString("fr-FR", {
                day: "numeric", month: "long", year: "numeric",
              })}
            </Text>
          </View>
        </View>
      )}

      {isAdmin && currentCopro && (
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

      {isAdmin && currentCopro && (
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
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Configuration nettoyage</Text>
              {savingBuildingConfig && <ActivityIndicator size="small" color={COLORS.teal} />}
            </View>
            <Text style={styles.sectionDesc}>
              Définissez la structure du bâtiment pour générer automatiquement la liste de zones à nettoyer.
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
              { key: "hasElevator", label: "Ascenseur" },
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
                <View style={[
                  styles.memberRoleBadge,
                  m.role === "admin" && styles.memberRoleAdmin,
                  m.role === "propriétaire" && styles.memberRoleOwner,
                ]}>
                  <Text style={[
                    styles.memberRoleText,
                    m.role === "admin" && styles.memberRoleTextAdmin,
                    m.role === "propriétaire" && styles.memberRoleTextOwner,
                  ]}>
                    {m.role === "admin" ? "Admin" : m.role === "propriétaire" ? "Propriétaire" : "Collaborateur"}
                  </Text>
                </View>
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

      {copros.length > 1 && (
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

      {isAdmin && (
        <View style={styles.section}>
          <Pressable
            style={styles.statsNavBtn}
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


      <View style={styles.accountSection}>
        <Pressable style={styles.logoutRow} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.danger} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
        {isAdmin && (
          <Pressable style={styles.deleteAccountRow} onPress={handleDeleteAccount}>
            <Ionicons name="trash-outline" size={16} color={COLORS.textMuted} />
            <Text style={styles.deleteAccountText}>Supprimer mon compte</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>

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
            {(["propriétaire", "collaborateur", "prestataire"] as const).map((r) => {
              const active = inviteRole === r;
              const label = r === "propriétaire" ? "Propriétaire" : r === "collaborateur" ? "Collaborateur" : "Prestataire";
              const icon = r === "propriétaire" ? "home-outline" : r === "collaborateur" ? "people-outline" : "construct-outline";
              const color = r === "propriétaire" ? COLORS.teal : r === "collaborateur" ? COLORS.primary : "#7C3AED";
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
  sectionTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: COLORS.text },
  sectionDesc: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 },
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
  accountSection: { gap: 8 },
  logoutRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#FEF2F2", borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: "#FECACA",
  },
  logoutText: { fontSize: 14, fontFamily: "Inter_500Medium", color: COLORS.danger },
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


  
});
