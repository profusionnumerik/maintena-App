import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc } from "firebase/firestore";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { db } from "@/lib/firebase";
import { ALL_CATEGORIES, Category, CATEGORY_ICONS, CATEGORY_LABELS } from "@/shared/types";

const CAT_COLORS: Record<string, { bg: string; icon: string; num: string }> = {
  nettoyage:          { bg: "#EFF6FF", icon: "#2563EB", num: "#BFDBFE" },
  ascenseur:          { bg: "#F0FDF4", icon: "#10B981", num: "#A7F3D0" },
  portail:            { bg: "#FEF3C7", icon: "#D97706", num: "#FDE68A" },
  parking:            { bg: "#F5F3FF", icon: "#7C3AED", num: "#DDD6FE" },
  vmc:                { bg: "#ECFEFF", icon: "#0891B2", num: "#A5F3FC" },
  plomberie:          { bg: "#EFF6FF", icon: "#3B82F6", num: "#BFDBFE" },
  electricite:        { bg: "#FFFBEB", icon: "#F59E0B", num: "#FDE68A" },
  espaces_verts:      { bg: "#ECFDF5", icon: "#059669", num: "#A7F3D0" },
  chaufferie:         { bg: "#FFF7ED", icon: "#EA580C", num: "#FED7AA" },
  video_surveillance: { bg: "#F9FAFB", icon: "#374151", num: "#E5E7EB" },
  facade:             { bg: "#FDF4FF", icon: "#9333EA", num: "#E9D5FF" },
  toiture:            { bg: "#FFF1F2", icon: "#E11D48", num: "#FECDD3" },
  local_poubelle:     { bg: "#F9FAFB", icon: "#6B7280", num: "#E5E7EB" },
  piscine:            { bg: "#ECFEFF", icon: "#06B6D4", num: "#A5F3FC" },
  interphone:         { bg: "#F0FDF4", icon: "#16A34A", num: "#BBF7D0" },
  desinfection:       { bg: "#FFF7ED", icon: "#C2410C", num: "#FED7AA" },
  divers:             { bg: "#F8FAFC", icon: "#64748B", num: "#E2E8F0" },
};

export default function JoinCoPro() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { joinCoPro } = useCoPro();
  const codeRef = useRef<TextInput>(null);

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);

  // Category modal (for prestataires who pick a category first)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [catCode, setCatCode] = useState("");
  const [catLoading, setCatLoading] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setError("Code trop court — minimum 4 caractères.");
      return;
    }
    setError(null);
    setLoading(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const copro = await joinCoPro(trimmed);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(copro.status === "active" ? "/(app)" : "/(blocked)");
    } catch (e: any) {
      setError(e.message ?? "Code invalide. Vérifiez et réessayez.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const openCategory = (cat: Category) => {
    setSelectedCategory(cat);
    setCatCode("");
    setCatError(null);
    setModalVisible(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleJoinCategory = async () => {
    const trimmed = catCode.trim();
    if (trimmed.length < 4) {
      setCatError("Code trop court — minimum 4 caractères.");
      return;
    }
    setCatError(null);
    setCatLoading(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const codeSnap = await getDoc(doc(db, "inviteCodes", trimmed.toUpperCase()));
      if (!codeSnap.exists()) throw new Error("Code invalide. Vérifiez le code transmis par votre admin.");
      const codeData = codeSnap.data() as { category?: Category; role?: string };
      if (selectedCategory && codeData.category && codeData.category !== selectedCategory) {
        throw new Error(
          `Ce code correspond à "${CATEGORY_LABELS[codeData.category]}", pas à "${CATEGORY_LABELS[selectedCategory!]}". Vérifiez votre code.`
        );
      }
      const copro = await joinCoPro(trimmed);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      router.replace(copro.status === "active" ? "/(app)" : "/(blocked)");
    } catch (e: any) {
      setCatError(e.message ?? "Code invalide. Vérifiez et réessayez.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setCatLoading(false);
    }
  };

  const selectedColors = selectedCategory
    ? (CAT_COLORS[selectedCategory] ?? CAT_COLORS.divers)
    : CAT_COLORS.divers;
  const selectedIcon = selectedCategory
    ? (CATEGORY_ICONS[selectedCategory] ?? "ellipsis-horizontal-circle")
    : "ellipsis-horizontal-circle";

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* TITLE BLOCK */}
        <View style={styles.titleBlock}>
          <View style={styles.titleIconWrap}>
            <Ionicons name="key" size={28} color={COLORS.primary} />
          </View>
          <Text style={styles.pageTitle}>Rejoindre une copropriété</Text>
          <Text style={styles.pageSubtitle}>
            Entrez le code d'invitation reçu de votre admin
          </Text>
        </View>

        {/* CODE INPUT — prominent, toujours visible */}
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>Code d'invitation</Text>
          <TextInput
            ref={codeRef}
            style={styles.codeInput}
            placeholder="ABC123"
            placeholderTextColor={COLORS.textMuted}
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setError(null); }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="done"
            onSubmitEditing={handleJoin}
            textAlign="center"
            autoFocus
          />
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.joinBtn, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
            onPress={handleJoin}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={styles.joinBtnText}>Rejoindre</Text>
                </>
            }
          </Pressable>
        </View>

        {/* RÔLES INFO */}
        <View style={styles.rolesInfo}>
          <Text style={styles.rolesInfoTitle}>Ce code fonctionne pour :</Text>
          {[
            { icon: "settings-outline", label: "Admin / Collaborateur", color: COLORS.primary },
            { icon: "shield-checkmark-outline", label: "Conseil syndical", color: "#0891B2" },
            { icon: "home-outline", label: "Propriétaire", color: COLORS.teal ?? "#0D9488" },
            { icon: "construct-outline", label: "Prestataire (code catégorie)", color: "#7C3AED" },
          ].map(({ icon, label, color }) => (
            <View key={label} style={styles.rolesInfoRow}>
              <Ionicons name={icon as any} size={15} color={color} />
              <Text style={styles.rolesInfoText}>{label}</Text>
            </View>
          ))}
        </View>

        {/* SECTION PRESTATAIRE — catégories pour trouver le bon code */}
        <Pressable
          style={styles.catToggle}
          onPress={() => { setShowCategories((v) => !v); if (Platform.OS !== "web") Haptics.selectionAsync(); }}
        >
          <Ionicons name="construct-outline" size={16} color={COLORS.primary} />
          <Text style={styles.catToggleText}>Vous êtes prestataire ? Trouvez votre catégorie</Text>
          <Ionicons name={showCategories ? "chevron-up" : "chevron-down"} size={16} color={COLORS.primary} />
        </Pressable>

        {showCategories && (
          <>
            <Text style={styles.catHint}>
              Sélectionnez votre domaine d'intervention pour entrer le code correspondant :
            </Text>
            <View style={styles.catGrid}>
              {ALL_CATEGORIES.map((cat) => {
                const colors = CAT_COLORS[cat] ?? CAT_COLORS.divers;
                const iconName = (CATEGORY_ICONS[cat] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
                return (
                  <Pressable
                    key={cat}
                    style={({ pressed }) => [styles.catCard, pressed && { opacity: 0.82, transform: [{ scale: 0.97 }] }]}
                    onPress={() => openCategory(cat)}
                  >
                    <View style={[styles.catIconWrap, { backgroundColor: colors.bg }]}>
                      <Ionicons name={iconName} size={22} color={colors.icon} />
                    </View>
                    <Text style={styles.catLabel} numberOfLines={2}>{CATEGORY_LABELS[cat]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      {/* CATEGORY CODE MODAL */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalSheet}
        >
          <View style={styles.modalHandle} />
          {selectedCategory && (
            <>
              <View style={[styles.modalIconWrap, { backgroundColor: selectedColors.bg }]}>
                <Ionicons
                  name={selectedIcon as keyof typeof Ionicons.glyphMap}
                  size={32}
                  color={selectedColors.icon}
                />
              </View>
              <Text style={styles.modalTitle}>{CATEGORY_LABELS[selectedCategory]}</Text>
              <Text style={styles.modalSubtitle}>
                Entrez le code de prestation fourni par votre admin
              </Text>
              <TextInput
                style={styles.catCodeInput}
                placeholder="ABC123"
                placeholderTextColor={COLORS.textMuted}
                value={catCode}
                onChangeText={(t) => { setCatCode(t.toUpperCase()); setCatError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
                returnKeyType="done"
                onSubmitEditing={handleJoinCategory}
                autoFocus
                textAlign="center"
              />
              {catError && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
                  <Text style={styles.errorText}>{catError}</Text>
                </View>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.catJoinBtn,
                  { backgroundColor: selectedColors.icon },
                  pressed && { opacity: 0.85 },
                  catLoading && { opacity: 0.7 },
                ]}
                onPress={handleJoinCategory}
                disabled={catLoading}
              >
                {catLoading
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={styles.joinBtnText}>Accéder à {CATEGORY_LABELS[selectedCategory]}</Text>
                    </>
                }
              </Pressable>
              <Text style={styles.modalHint}>
                Seules les interventions de cette catégorie vous seront visibles.
              </Text>
            </>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 12, paddingBottom: 4 },
  back: { width: 36, height: 36, justifyContent: "center" },

  scroll: { paddingHorizontal: 20, paddingTop: 8 },

  titleBlock: { alignItems: "center", marginBottom: 28, gap: 10 },
  titleIconWrap: {
    width: 64, height: 64, borderRadius: 20,
    backgroundColor: COLORS.primary + "15",
    alignItems: "center", justifyContent: "center",
  },
  pageTitle: {
    fontSize: 26, fontFamily: "Inter_700Bold", color: COLORS.text,
    letterSpacing: -0.5, textAlign: "center",
  },
  pageSubtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary ?? COLORS.textMuted,
    textAlign: "center", lineHeight: 20, maxWidth: 280,
  },

  // Code card
  codeCard: {
    backgroundColor: "#fff", borderRadius: 20, padding: 20,
    borderWidth: 1, borderColor: COLORS.border,
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
    gap: 14, marginBottom: 20,
  },
  codeLabel: {
    fontSize: 13, fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.8,
  },
  codeInput: {
    height: 72, backgroundColor: "#F8FAFC", borderRadius: 16,
    borderWidth: 2, borderColor: COLORS.primary,
    fontSize: 30, fontFamily: "Inter_700Bold", color: COLORS.text,
    letterSpacing: 10,
  },
  joinBtn: {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  joinBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },

  // Roles info
  rolesInfo: {
    backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 10, marginBottom: 20,
  },
  rolesInfoTitle: {
    fontSize: 12, fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2,
  },
  rolesInfoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rolesInfoText: { fontSize: 13, fontFamily: "Inter_500Medium", color: COLORS.text },

  // Category toggle
  catToggle: {
    flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center",
    padding: 14, backgroundColor: "#EFF6FF", borderRadius: 14,
    borderWidth: 1, borderColor: "#BFDBFE", marginBottom: 16,
  },
  catToggleText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  catHint: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted,
    textAlign: "center", marginBottom: 12,
  },

  catGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  catCard: {
    width: "47%", backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 14, borderWidth: 1, borderColor: COLORS.border,
    gap: 8, alignItems: "flex-start",
  },
  catIconWrap: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  catLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.text, lineHeight: 17 },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: "#FECACA",
  },
  errorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.danger },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  modalSheet: {
    backgroundColor: COLORS.background, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40, alignItems: "center", gap: 14,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 8,
  },
  modalIconWrap: {
    width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center",
  },
  modalTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: -0.3 },
  modalSubtitle: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary ?? COLORS.textMuted, textAlign: "center", lineHeight: 18,
  },
  catCodeInput: {
    width: "100%", height: 68, backgroundColor: COLORS.surface,
    borderRadius: 18, borderWidth: 2, borderColor: COLORS.primary,
    fontSize: 28, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: 8,
  },
  catJoinBtn: {
    width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 16, height: 54,
  },
  modalHint: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center",
  },
});
