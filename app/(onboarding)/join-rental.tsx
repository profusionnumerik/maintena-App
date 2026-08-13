import { useState, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "@/lib/firebase";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { COLORS } from "@/constants/colors";

interface InvitationPreview {
  propertyAddress: string;
  propertyCity:    string;
  propertyType:    string;
  landlordName:    string;
}

export default function JoinRental() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [code, setCode]               = useState("");
  const [validating, setValidating]   = useState(false);
  const [accepting, setAccepting]     = useState(false);
  const [preview, setPreview]         = useState<InvitationPreview | null>(null);
  const [error, setError]             = useState<string | null>(null);

  const normalizedCode = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const canValidate    = normalizedCode.length === 6;

  const handleValidate = useCallback(async () => {
    if (!canValidate) return;
    setError(null);
    setValidating(true);
    setPreview(null);

    try {
      const baseUrl = getApiUrl();
      const url     = new URL(`/api/rental/invitation/${normalizedCode}`, baseUrl).toString();
      const res     = await fetch(url);

      if (res.status === 404) {
        setError("Ce code d'invitation est invalide ou introuvable.");
        return;
      }
      if (res.status === 410) {
        setError("Ce code a déjà été utilisé ou a expiré.");
        return;
      }
      if (!res.ok) {
        setError("Erreur lors de la vérification. Réessayez.");
        return;
      }

      const data = await res.json();
      setPreview({
        propertyAddress: data.propertyAddress ?? "",
        propertyCity:    data.propertyCity    ?? "",
        propertyType:    data.propertyType    ?? "",
        landlordName:    data.landlordName    ?? "Votre bailleur",
      });
    } catch {
      setError("Impossible de se connecter au serveur. Vérifiez votre connexion.");
    } finally {
      setValidating(false);
    }
  }, [normalizedCode, canValidate]);

  const handleAccept = useCallback(async () => {
    if (!preview) return;
    setError(null);
    setAccepting(true);

    try {
      const token = await auth.currentUser?.getIdToken(true);
      if (!token) {
        setError("Session expirée. Reconnectez-vous et réessayez.");
        return;
      }

      await apiRequest(
        "POST",
        "/api/rental/accept-invitation",
        { token: normalizedCode },
        { Authorization: `Bearer ${token}` }
      );

      // L'onSnapshot dans AuthContext détectera userType = "tenant"
      // et _layout.tsx redirigera automatiquement vers /(tenant)
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (msg.includes("410") || msg.toLowerCase().includes("déjà")) {
        setError("Ce code a déjà été utilisé.");
      } else {
        setError("Impossible d'activer l'invitation. Réessayez.");
      }
    } finally {
      setAccepting(false);
    }
  }, [preview, normalizedCode]);

  const paddingTop    = Platform.OS === "web" ? 67 + 32 : insets.top + 32;
  const paddingBottom = Platform.OS === "web" ? 34 : insets.bottom + 24;

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={s.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={[s.inner, { paddingTop, paddingBottom }]}>

          {/* Back */}
          <Pressable style={s.backBtn} onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={20} color="rgba(255,255,255,0.7)" />
            <Text style={s.backText}>Retour</Text>
          </Pressable>

          {/* En-tête */}
          <View style={s.header}>
            <View style={s.iconBadge}>
              <Ionicons name="mail-open" size={36} color="#D97706" />
            </View>
            <Text style={s.title}>Code d'invitation</Text>
            <Text style={s.subtitle}>
              Entrez le code à 6 caractères reçu par email de votre bailleur.
            </Text>
          </View>

          {/* Saisie code */}
          <View style={s.codeSection}>
            <TextInput
              ref={inputRef}
              style={s.codeInput}
              value={normalizedCode}
              onChangeText={(v) => {
                setCode(v);
                setPreview(null);
                setError(null);
              }}
              placeholder="A1B2C3"
              placeholderTextColor="rgba(255,255,255,0.2)"
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              keyboardAppearance="dark"
            />

            {error && (
              <View style={s.errorBanner}>
                <Ionicons name="warning" size={16} color="#EF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Aperçu logement */}
            {preview && (
              <View style={s.previewCard}>
                <View style={s.previewRow}>
                  <Ionicons name="home" size={20} color="#D97706" />
                  <View style={s.previewInfo}>
                    <Text style={s.previewAddress}>{preview.propertyAddress}</Text>
                    {!!preview.propertyCity && (
                      <Text style={s.previewCity}>{preview.propertyCity}</Text>
                    )}
                    {!!preview.landlordName && (
                      <Text style={s.previewLandlord}>Bailleur : {preview.landlordName}</Text>
                    )}
                  </View>
                </View>
                <View style={s.previewBadge}>
                  <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                  <Text style={s.previewBadgeText}>Invitation valide</Text>
                </View>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={s.actions}>
            {!preview ? (
              <Pressable
                style={[s.primaryBtn, (!canValidate || validating) && s.btnDisabled]}
                onPress={handleValidate}
                disabled={!canValidate || validating}
              >
                {validating
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="search" size={18} color="#fff" />
                      <Text style={s.primaryBtnText}>Vérifier le code</Text>
                    </>
                }
              </Pressable>
            ) : (
              <Pressable
                style={[s.primaryBtn, s.acceptBtn, accepting && s.btnDisabled]}
                onPress={handleAccept}
                disabled={accepting}
              >
                {accepting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={s.primaryBtnText}>Rejoindre ce logement</Text>
                    </>
                }
              </Pressable>
            )}

            {preview && (
              <Pressable
                style={s.secondaryBtn}
                onPress={() => { setPreview(null); setCode(""); setError(null); }}
              >
                <Text style={s.secondaryBtnText}>Saisir un autre code</Text>
              </Pressable>
            )}
          </View>

        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  inner: {
    flex: 1, paddingHorizontal: 24,
    justifyContent: "space-between",
  },

  backBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  backText: {
    fontSize: 14, fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.6)",
  },

  header: { alignItems: "center", gap: 12 },
  iconBadge: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: "rgba(234,179,8,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(234,179,8,0.3)",
  },
  title: {
    fontSize: 26, fontFamily: "Inter_700Bold",
    color: "#fff", letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 20,
  },

  codeSection: { gap: 14 },
  codeInput: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 18, borderWidth: 2, borderColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 24, paddingVertical: 18,
    fontSize: 32, fontFamily: "Inter_700Bold", color: "#fff",
    textAlign: "center", letterSpacing: 10,
  },

  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(239,68,68,0.12)",
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.25)",
  },
  errorText: {
    flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
    color: "#FCA5A5", lineHeight: 18,
  },

  previewCard: {
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 16, padding: 16, gap: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  previewRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  previewInfo: { flex: 1, gap: 3 },
  previewAddress: {
    fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff",
  },
  previewCity: {
    fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)",
  },
  previewLandlord: {
    fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.45)",
  },
  previewBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(16,185,129,0.12)", borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: "flex-start",
  },
  previewBadgeText: {
    fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#10B981",
  },

  actions: { gap: 12 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: "#D97706", borderRadius: 16,
    paddingVertical: 16,
  },
  acceptBtn: { backgroundColor: "#8B5CF6" },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff",
  },
  secondaryBtn: { alignItems: "center", paddingVertical: 8 },
  secondaryBtnText: {
    fontSize: 14, fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.4)",
  },
});
