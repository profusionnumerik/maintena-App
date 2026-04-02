import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";
import { useCoPro } from "@/context/CoProContext";
import { ALL_CATEGORIES, CATEGORY_LABELS, Category } from "@/shared/types";

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+\s().-]/g, "");
}

function isValidEmail(email: string): boolean {
  return /\S+@\S+\.\S+/.test(email.trim());
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export default function InvitePrestataireScreen() {
  const insets = useSafeAreaInsets();
  const { currentCopro, currentRole, invitePrestataire } = useCoPro();

  const isAdmin = currentRole === "admin";
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const disabledCats: Category[] = currentCopro?.disabledCategories ?? [];
  const availableCategories = useMemo(
    () => ALL_CATEGORIES.filter((c) => !disabledCats.includes(c)),
    [disabledCats]
  );

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<Category | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [generatedName, setGeneratedName] = useState<string>("");

  const handleSubmit = async () => {
    if (!isAdmin) {
      Alert.alert("Accès refusé", "Seul le syndic peut inviter un prestataire.");
      return;
    }

    if (!firstName.trim()) {
      Alert.alert("Champ requis", "Veuillez saisir le prénom.");
      return;
    }

    if (!lastName.trim()) {
      Alert.alert("Champ requis", "Veuillez saisir le nom.");
      return;
    }

    if (!email.trim() || !isValidEmail(email)) {
      Alert.alert("Email invalide", "Veuillez saisir une adresse email valide.");
      return;
    }

    if (!phone.trim() || !isValidPhone(phone)) {
      Alert.alert("Téléphone invalide", "Veuillez saisir un numéro de téléphone valide.");
      return;
    }

    if (!category) {
      Alert.alert("Catégorie requise", "Veuillez sélectionner une catégorie.");
      return;
    }

    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const result = await invitePrestataire({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        categoryFilter: category,
      });

      setGeneratedCode(result.inviteCode);
      setGeneratedName(`${firstName.trim()} ${lastName.trim()}`.trim());

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert(
        "Erreur",
        "Impossible de créer l'invitation du prestataire."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCode = async () => {
    if (!generatedCode) return;
    await Clipboard.setStringAsync(generatedCode);
    Haptics.selectionAsync();
    Alert.alert("Code copié", "Le code d'invitation a été copié.");
  };

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setCategory(null);
    setGeneratedCode(null);
    setGeneratedName("");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="arrow-back" size={20} color={COLORS.text} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Inviter un prestataire</Text>
          <Text style={styles.headerSubtitle}>
            Création rapide avec code individuel
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPadding + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introCard}>
          <Ionicons name="person-add-outline" size={18} color={COLORS.primary} />
          <Text style={styles.introText}>
            Créez une fiche prestataire nominative, puis générez immédiatement un
            code d'invitation unique à lui transmettre.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Informations du prestataire</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Prénom *</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="Ex: Marc"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Nom *</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Ex: Dupont"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email *</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Ex: contact@artisan.fr"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Téléphone *</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(text) => setPhone(normalizePhone(text))}
              placeholder="Ex: 06 12 34 56 78"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Catégorie *</Text>
            <View style={styles.chipGrid}>
              {availableCategories.map((cat) => {
                const active = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCategory(cat);
                    }}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      style={[styles.chipText, active && styles.chipTextActive]}
                    >
                      {CATEGORY_LABELS[cat]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={({ pressed }) => [
              styles.submitBtn,
              pressed && { opacity: 0.88 },
              isSubmitting && { opacity: 0.65 },
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="flash-outline" size={18} color="#fff" />
                <Text style={styles.submitText}>
                  Générer l’invitation
                </Text>
              </>
            )}
          </Pressable>
        </View>

        {generatedCode && (
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              <Text style={styles.resultTitle}>Invitation créée</Text>
            </View>

            <Text style={styles.resultSubtitle}>
              Prestataire : {generatedName || "Prestataire"}
            </Text>

            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Code individuel</Text>
              <Text style={styles.codeValue}>{generatedCode}</Text>
            </View>

            <Text style={styles.helperText}>
              Transmets ce code au prestataire. Il pourra l’entrer lors de la
              création de son compte pour activer son accès.
            </Text>

            <View style={styles.actionsRow}>
              <Pressable style={styles.secondaryBtn} onPress={copyCode}>
                <Ionicons name="copy-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryBtnText}>Copier le code</Text>
              </Pressable>

              <Pressable style={styles.secondaryBtn} onPress={resetForm}>
                <Ionicons name="add-outline" size={16} color={COLORS.primary} />
                <Text style={styles.secondaryBtnText}>Nouveau prestataire</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  introCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  introText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.primary,
    lineHeight: 18,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    marginBottom: 2,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
  },
  chipTextActive: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
  },
  submitBtn: {
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  submitText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  resultCard: {
    backgroundColor: "#ECFDF5",
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: COLORS.success,
  },
  resultSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.text,
  },
  codeBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#D1FAE5",
    alignItems: "center",
  },
  codeLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  codeValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    letterSpacing: 2,
  },
  helperText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "#D1FAE5",
  },
  secondaryBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.primary,
  },
});