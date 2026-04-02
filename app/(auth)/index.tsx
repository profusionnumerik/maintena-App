import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

type Mode = "login" | "register";

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+\s().-]/g, "");
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isValidEmail(email: string): boolean {
  return /\S+@\S+\.\S+/.test(email.trim());
}

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ inviteCode?: string; mode?: string }>();
  const { login, register, error, clearError } = useAuth();

  const [mode, setMode] = useState<Mode>("login");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const inviteCodeRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;
  const displayError = localError || error;

  useEffect(() => {
    if (params.inviteCode && typeof params.inviteCode === "string") {
      setInviteCode(params.inviteCode.toUpperCase());
    }

    if (params.mode === "register") {
      setMode("register");
    }
  }, [params.inviteCode, params.mode]);

  const switchMode = (next: Mode) => {
    Haptics.selectionAsync();
    clearError();
    setLocalError(null);
    setMode(next);

    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");

    // On garde le code d'invitation s'il vient d'un lien
    if (!params.inviteCode) {
      setInviteCode("");
    }

    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async () => {
    clearError();
    setLocalError(null);

    if (!email.trim()) {
      setLocalError("Veuillez saisir votre email.");
      return;
    }

    if (!isValidEmail(email)) {
      setLocalError("Veuillez saisir une adresse email valide.");
      return;
    }

    if (!password) {
      setLocalError("Veuillez saisir votre mot de passe.");
      return;
    }

    if (mode === "register") {
      if (!firstName.trim()) {
        setLocalError("Veuillez saisir votre prénom.");
        return;
      }

      if (!lastName.trim()) {
        setLocalError("Veuillez saisir votre nom.");
        return;
      }

      if (!phone.trim()) {
        setLocalError("Veuillez saisir votre numéro de téléphone.");
        return;
      }

      if (!isValidPhone(phone)) {
        setLocalError("Veuillez saisir un numéro de téléphone valide.");
        return;
      }

      if (password !== confirmPassword) {
        setLocalError("Les mots de passe ne correspondent pas.");
        return;
      }

      if (password.length < 6) {
        setLocalError("Le mot de passe doit contenir au moins 6 caractères.");
        return;
      }
    }

    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register({
          firstName,
          lastName,
          email,
          phone,
          password,
          inviteCode: inviteCode.trim() || undefined,
        });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={styles.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 20 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.logoWrap}>
              <Ionicons name="business" size={32} color={COLORS.tealLight} />
            </View>
            <Text style={styles.appName}>Maintena</Text>
            <Text style={styles.appTagline}>Gestion de copropriété</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.tabRow}>
              <Pressable
                onPress={() => switchMode("login")}
                style={[styles.tab, mode === "login" && styles.tabActive]}
              >
                <Text
                  style={[
                    styles.tabText,
                    mode === "login" && styles.tabTextActive,
                  ]}
                >
                  Connexion
                </Text>
              </Pressable>

              <Pressable
                onPress={() => switchMode("register")}
                style={[styles.tab, mode === "register" && styles.tabActive]}
              >
                <Text
                  style={[
                    styles.tabText,
                    mode === "register" && styles.tabTextActive,
                  ]}
                >
                  Créer un compte
                </Text>
              </Pressable>
            </View>

            <View style={styles.form}>
              <Text style={styles.formTitle}>
                {mode === "login" ? "Bon retour" : "Créer votre compte"}
              </Text>

              <Text style={styles.formSubtitle}>
                {mode === "login"
                  ? "Connectez-vous à votre espace"
                  : "Renseignez vos informations personnelles"}
              </Text>

              {mode === "register" && (
                <>
                  <View style={styles.inputWrap}>
                    <View style={styles.inputIcon}>
                      <Ionicons
                        name="person-outline"
                        size={18}
                        color={COLORS.textMuted}
                      />
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="Prénom *"
                      placeholderTextColor={COLORS.textMuted}
                      value={firstName}
                      onChangeText={setFirstName}
                      returnKeyType="next"
                      onSubmitEditing={() => lastNameRef.current?.focus()}
                      autoCapitalize="words"
                    />
                  </View>

                  <View style={styles.inputWrap}>
                    <View style={styles.inputIcon}>
                      <Ionicons
                        name="person-outline"
                        size={18}
                        color={COLORS.textMuted}
                      />
                    </View>
                    <TextInput
                      ref={lastNameRef}
                      style={styles.input}
                      placeholder="Nom *"
                      placeholderTextColor={COLORS.textMuted}
                      value={lastName}
                      onChangeText={setLastName}
                      returnKeyType="next"
                      onSubmitEditing={() => emailRef.current?.focus()}
                      autoCapitalize="words"
                    />
                  </View>
                </>
              )}

              <View style={styles.inputWrap}>
                <View style={styles.inputIcon}>
                  <Ionicons
                    name="mail-outline"
                    size={18}
                    color={COLORS.textMuted}
                  />
                </View>
                <TextInput
                  ref={emailRef}
                  style={styles.input}
                  placeholder="Email *"
                  placeholderTextColor={COLORS.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    if (mode === "register") phoneRef.current?.focus();
                    else passwordRef.current?.focus();
                  }}
                />
              </View>

              {mode === "register" && (
                <>
                  <View style={styles.inputWrap}>
                    <View style={styles.inputIcon}>
                      <Ionicons
                        name="call-outline"
                        size={18}
                        color={COLORS.textMuted}
                      />
                    </View>
                    <TextInput
                      ref={phoneRef}
                      style={styles.input}
                      placeholder="Numéro de téléphone *"
                      placeholderTextColor={COLORS.textMuted}
                      value={phone}
                      onChangeText={(text) => setPhone(normalizePhone(text))}
                      keyboardType="phone-pad"
                      returnKeyType="next"
                      onSubmitEditing={() => inviteCodeRef.current?.focus()}
                    />
                  </View>

                  <View style={styles.inputWrap}>
                    <View style={styles.inputIcon}>
                      <Ionicons
                        name="key-outline"
                        size={18}
                        color={COLORS.textMuted}
                      />
                    </View>
                    <TextInput
                      ref={inviteCodeRef}
                      style={styles.input}
                      placeholder="Code d'invitation (optionnel)"
                      placeholderTextColor={COLORS.textMuted}
                      value={inviteCode}
                      onChangeText={(text) => setInviteCode(text.toUpperCase())}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="next"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </View>
                </>
              )}

              <View style={styles.inputWrap}>
                <View style={styles.inputIcon}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={COLORS.textMuted}
                  />
                </View>
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, styles.inputPassword]}
                  placeholder="Mot de passe"
                  placeholderTextColor={COLORS.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType={mode === "register" ? "next" : "done"}
                  onSubmitEditing={() => {
                    if (mode === "register") confirmRef.current?.focus();
                    else handleSubmit();
                  }}
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={COLORS.textMuted}
                  />
                </Pressable>
              </View>

              {mode === "register" && (
                <View style={styles.inputWrap}>
                  <View style={styles.inputIcon}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={18}
                      color={COLORS.textMuted}
                    />
                  </View>
                  <TextInput
                    ref={confirmRef}
                    style={styles.input}
                    placeholder="Confirmer le mot de passe"
                    placeholderTextColor={COLORS.textMuted}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                </View>
              )}

              {displayError ? (
                <View style={styles.errorBox}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={16}
                    color={COLORS.danger}
                  />
                  <Text style={styles.errorText}>{displayError}</Text>
                </View>
              ) : null}

              <Pressable
                onPress={handleSubmit}
                disabled={isLoading}
                style={({ pressed }) => [
                  styles.submitBtn,
                  pressed && styles.submitBtnPressed,
                  isLoading && styles.submitBtnDisabled,
                ]}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {mode === "login" ? "Se connecter" : "Créer mon compte"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {mode === "login" ? "Pas encore de compte ?" : "Déjà un compte ?"}
            </Text>
            <Pressable
              onPress={() => switchMode(mode === "login" ? "register" : "login")}
            >
              <Text style={styles.footerLink}>
                {mode === "login" ? "S'inscrire" : "Se connecter"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  keyboardView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
    gap: 24,
  },
  brand: {
    alignItems: "center",
    gap: 8,
    paddingBottom: 8,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    marginBottom: 4,
  },
  appName: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -1,
  },
  appTagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.25,
    shadowRadius: 32,
    elevation: 20,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: COLORS.surfaceAlt,
    padding: 4,
    margin: 16,
    borderRadius: 14,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 11,
  },
  tabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  tabText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: COLORS.textMuted,
  },
  tabTextActive: {
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  form: {
    padding: 20,
    paddingTop: 4,
    gap: 14,
  },
  formTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
    marginBottom: 2,
  },
  formSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
    height: "100%",
  },
  inputPassword: {
    paddingRight: 36,
  },
  eyeBtn: {
    position: "absolute",
    right: 14,
    height: "100%",
    justifyContent: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.danger,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  submitBtnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingBottom: 8,
  },
  footerText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
  },
  footerLink: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.tealLight,
  },
});
