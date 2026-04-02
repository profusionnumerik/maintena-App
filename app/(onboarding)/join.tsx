import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform,
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

const FlatListAny = FlatList as any;

const CAT_COLORS: Record<string, { bg: string; icon: string; num: string }> = {
  nettoyage:        { bg: "#EFF6FF", icon: "#2563EB", num: "#BFDBFE" },
  ascenseur:        { bg: "#F0FDF4", icon: "#10B981", num: "#A7F3D0" },
  portail:          { bg: "#FEF3C7", icon: "#D97706", num: "#FDE68A" },
  parking:          { bg: "#F5F3FF", icon: "#7C3AED", num: "#DDD6FE" },
  vmc:              { bg: "#ECFEFF", icon: "#0891B2", num: "#A5F3FC" },
  plomberie:        { bg: "#EFF6FF", icon: "#3B82F6", num: "#BFDBFE" },
  electricite:      { bg: "#FFFBEB", icon: "#F59E0B", num: "#FDE68A" },
  espaces_verts:    { bg: "#ECFDF5", icon: "#059669", num: "#A7F3D0" },
  chaufferie:       { bg: "#FFF7ED", icon: "#EA580C", num: "#FED7AA" },
  video_surveillance: { bg: "#F9FAFB", icon: "#374151", num: "#E5E7EB" },
  facade:           { bg: "#FDF4FF", icon: "#9333EA", num: "#E9D5FF" },
  toiture:          { bg: "#FFF1F2", icon: "#E11D48", num: "#FECDD3" },
  local_poubelle:   { bg: "#F9FAFB", icon: "#6B7280", num: "#E5E7EB" },
  piscine:          { bg: "#ECFEFF", icon: "#06B6D4", num: "#A5F3FC" },
  interphone:       { bg: "#F0FDF4", icon: "#16A34A", num: "#BBF7D0" },
  desinfection:     { bg: "#FFF7ED", icon: "#C2410C", num: "#FED7AA" },
  divers:           { bg: "#F8FAFC", icon: "#64748B", num: "#E2E8F0" },
};

export default function JoinCoPro() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { joinCoPro } = useCoPro();
  const { user } = useAuth();

  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [directCode, setDirectCode] = useState("");
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [showDirect, setShowDirect] = useState(false);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const openCategory = (cat: Category) => {
    setSelectedCategory(cat);
    setCode("");
    setError(null);
    setModalVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleJoinCategory = async () => {
    if (code.trim().length < 4) {
      setError("Code trop court — minimum 4 caractères.");
      return;
    }
    setError(null);
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Verify the code belongs to the selected category before joining
      const codeSnap = await getDoc(doc(db, "inviteCodes", code.trim().toUpperCase()));
      if (!codeSnap.exists()) {
        throw new Error("Code invalide. Vérifiez le code transmis par votre syndic.");
      }
      const codeData = codeSnap.data() as { category?: Category; role?: string };
      if (selectedCategory && codeData.category && codeData.category !== selectedCategory) {
        throw new Error(
          `Ce code correspond à "${CATEGORY_LABELS[codeData.category]}", pas à "${CATEGORY_LABELS[selectedCategory!]}". Vérifiez votre code.`
        );
      }
      const copro = await joinCoPro(code.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setModalVisible(false);
      if (copro.status === "active") {
        router.replace("/(app)");
      } else {
        router.replace("/(blocked)");
      }
    } catch (e: any) {
      setError(e.message ?? "Code invalide. Vérifiez et réessayez.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleDirectJoin = async () => {
    if (directCode.trim().length < 4) {
      setDirectError("Code trop court.");
      return;
    }
    setDirectError(null);
    setDirectLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const copro = await joinCoPro(directCode.trim());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (copro.status === "active") {
        router.replace("/(app)");
      } else {
        router.replace("/(blocked)");
      }
    } catch (e: any) {
      setDirectError(e.message ?? "Code invalide.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setDirectLoading(false);
    }
  };

  const selectedColors = selectedCategory ? (CAT_COLORS[selectedCategory] ?? CAT_COLORS.divers) : CAT_COLORS.divers;
  const selectedIcon = selectedCategory ? (CATEGORY_ICONS[selectedCategory] ?? "ellipsis-horizontal-circle") : "ellipsis-horizontal-circle";

  return (
    <View style={[styles.root, { paddingTop: top }]}>
      {/* HEADER */}
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.pageTitle}>Votre prestation</Text>
          <Text style={styles.pageSubtitle}>
            Choisissez votre catégorie et entrez le code de votre syndic
          </Text>
        </View>
      </View>

      <FlatListAny
        data={ALL_CATEGORIES}
        keyExtractor={(item: Category) => item}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 100 }]}
        renderItem={({ item: cat, index }: { item: Category; index: number }) => {
          const colors = CAT_COLORS[cat] ?? CAT_COLORS.divers;
          const iconName = (CATEGORY_ICONS[cat] ?? "ellipsis-horizontal-circle") as keyof typeof Ionicons.glyphMap;
          const num = String(index + 1).padStart(2, "0");
          return (
            <Pressable
              style={({ pressed }) => [styles.catCard, pressed && { opacity: 0.82, transform: [{ scale: 0.97 }] }]}
              onPress={() => openCategory(cat)}
            >
              <View style={[styles.catNum, { backgroundColor: colors.num }]}>
                <Text style={[styles.catNumText, { color: colors.icon }]}>{num}</Text>
              </View>
              <View style={[styles.catIconWrap, { backgroundColor: colors.bg }]}>
                <Ionicons name={iconName} size={26} color={colors.icon} />
              </View>
              <Text style={styles.catLabel} numberOfLines={2}>{CATEGORY_LABELS[cat]}</Text>
              <View style={styles.lockRow}>
                <Ionicons name="lock-closed-outline" size={11} color={COLORS.textMuted} />
                <Text style={styles.lockText}>Code requis</Text>
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              style={styles.directToggle}
              onPress={() => { setShowDirect((v) => !v); setDirectError(null); }}
            >
              <Ionicons name={showDirect ? "chevron-up" : "chevron-down"} size={15} color={COLORS.primary} />
              <Text style={styles.directToggleText}>
                {showDirect ? "Masquer" : "Syndic / Propriétaire — entrer un code directement"}
              </Text>
            </Pressable>

            {showDirect && (
              <View style={styles.directBox}>
                <TextInput
                  style={styles.directInput}
                  placeholder="Code d'accès (ABC123)"
                  placeholderTextColor={COLORS.textMuted}
                  value={directCode}
                  onChangeText={(t) => setDirectCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  returnKeyType="done"
                  onSubmitEditing={handleDirectJoin}
                  textAlign="center"
                />
                {directError && (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
                    <Text style={styles.errorText}>{directError}</Text>
                  </View>
                )}
                <Pressable
                  style={({ pressed }) => [styles.directBtn, pressed && { opacity: 0.85 }]}
                  onPress={handleDirectJoin}
                  disabled={directLoading}
                >
                  {directLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.directBtnText}>Rejoindre</Text>
                  }
                </Pressable>
              </View>
            )}
          </View>
        }
      />

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
                Entrez le code de prestation fourni par votre syndic
              </Text>

              <TextInput
                style={styles.codeInput}
                placeholder="ABC123"
                placeholderTextColor={COLORS.textMuted}
                value={code}
                onChangeText={(t) => { setCode(t.toUpperCase()); setError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                returnKeyType="done"
                onSubmitEditing={handleJoinCategory}
                autoFocus
                textAlign="center"
              />

              {error && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={14} color={COLORS.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.joinBtn,
                  { backgroundColor: selectedColors.icon },
                  pressed && { opacity: 0.85 },
                  loading && { opacity: 0.7 },
                ]}
                onPress={handleJoinCategory}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.joinBtnText}>Accéder à {CATEGORY_LABELS[selectedCategory]}</Text>
                  </>
                }
              </Pressable>

              <Text style={styles.modalHint}>
                Seules les interventions de cette catégorie vous seront accessibles.
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
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  back: { width: 36, height: 36, justifyContent: "center" },
  headerText: { gap: 4 },
  pageTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: -0.5 },
  pageSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: COLORS.textSecondary, lineHeight: 18 },
  list: { paddingHorizontal: 12, gap: 0 },
  row: { gap: 10, marginBottom: 10 },
  catCard: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: 18,
    padding: 16, borderWidth: 1, borderColor: COLORS.border,
    gap: 10, alignItems: "flex-start",
  },
  catNum: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  catNumText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  catIconWrap: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  catLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: COLORS.text, lineHeight: 18 },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lockText: { fontSize: 10, fontFamily: "Inter_400Regular", color: COLORS.textMuted },

  footer: { marginTop: 8, marginHorizontal: 4, gap: 12 },
  directToggle: {
    flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center",
    padding: 14, backgroundColor: "#EFF6FF", borderRadius: 14,
    borderWidth: 1, borderColor: "#BFDBFE",
  },
  directToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: COLORS.primary },
  directBox: {
    backgroundColor: COLORS.surface, borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: COLORS.border, gap: 12,
  },
  directInput: {
    height: 56, backgroundColor: "#F8FAFC", borderRadius: 14,
    borderWidth: 1.5, borderColor: COLORS.primary,
    fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: 6,
  },
  directBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12, height: 48,
    alignItems: "center", justifyContent: "center",
  },
  directBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: "#FECACA",
  },
  errorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.danger },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  modalSheet: {
    backgroundColor: COLORS.background, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40, alignItems: "center", gap: 14,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: COLORS.border, marginBottom: 8,
  },
  modalIconWrap: {
    width: 72, height: 72, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  modalTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: COLORS.text, letterSpacing: -0.3 },
  modalSubtitle: {
    fontSize: 13, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 18,
  },
  codeInput: {
    width: "100%", height: 68, backgroundColor: COLORS.surface,
    borderRadius: 18, borderWidth: 2, borderColor: COLORS.primary,
    fontSize: 28, fontFamily: "Inter_700Bold", color: COLORS.text,
    letterSpacing: 8,
  },
  joinBtn: {
    width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 16, height: 54,
  },
  joinBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  modalHint: {
    fontSize: 11, fontFamily: "Inter_400Regular",
    color: COLORS.textMuted, textAlign: "center",
  },
});
