import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";
import { getApiUrl } from "@/lib/query-client";

export default function JoinCoPro() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { joinCoPro, refreshCoPros, currentCopro } = useCoPro();
  const { user } = useAuth();
  const codeRef = useRef<TextInput>(null);
  const { code: codeParam } = useLocalSearchParams<{ code?: string }>();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNav, setPendingNav] = useState<"/(app)" | "/(blocked)" | null>(null);

  // Naviguer seulement quand currentCopro est chargé (évite la race condition avec le guard)
  useEffect(() => {
    if (pendingNav && currentCopro) {
      router.replace(pendingNav);
      setPendingNav(null);
    }
  }, [pendingNav, currentCopro]);

  // Pré-remplir le code depuis le lien /rejoindre/:code
  useEffect(() => {
    if (codeParam && typeof codeParam === "string" && codeParam.length >= 4) {
      setCode(codeParam.toUpperCase());
    }
  }, [codeParam]);

  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError("Code trop court — minimum 4 caractères.");
      return;
    }
    setError(null);
    setLoading(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Tentative 1 : code de copropriété
      const copro = await joinCoPro(trimmed);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const isActive = copro.subscriptionStatus === "active" || copro.status === "active";
      router.replace(isActive ? "/(app)" : "/(blocked)");
    } catch {
      // Tentative 2 : code salarie_invites (email invite)
      const idToken = await user?.getIdToken().catch(() => null);
      if (!idToken) {
        setError("Non connecté. Reconnectez-vous.");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      let linked = false;
      let inviteError: string | null = null;

      // Tentative 2 : code salarie_invites (invitation email)
      try {
        const res2 = await fetch(new URL("/api/salarie/link", getApiUrl()).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ token: trimmed }),
        });
        const data2 = await res2.json();
        if (data2.ok) {
          linked = true;
        } else if (res2.status !== 404) {
          // Code trouvé mais erreur (expiré, déjà utilisé, erreur serveur)
          inviteError = data2.error ?? null;
        }
      } catch { /* fallback suivant */ }

      // Tentative 3 : code salarié entretien récurrent
      if (!linked) {
        try {
          const res3 = await fetch(new URL("/api/entretien-salarie/link", getApiUrl()).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ code: trimmed }),
          });
          const data3 = await res3.json();
          if (data3.ok) {
            linked = true;
          } else {
            // Afficher l'erreur la plus pertinente
            const msg = inviteError ?? data3.error ?? "Code invalide. Vérifiez et réessayez.";
            setError(msg);
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            return;
          }
        } catch (e3: any) {
          const msg = inviteError ?? e3.message ?? "Code invalide. Vérifiez et réessayez.";
          setError(msg);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          return;
        }
      }

      if (linked) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refreshCoPros();
        setPendingNav("/(app)");
      }
    } finally {
      setLoading(false);
    }
  };

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

      </ScrollView>
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

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEF2F2", borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: "#FECACA",
  },
  errorText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.danger },

});
