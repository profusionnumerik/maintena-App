import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useCoPro } from "@/context/CoProContext";

export default function OnboardingIndex() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { logout, user } = useAuth();
  const { loadError, refreshCoPros, isLoading } = useCoPro();
  const top = Platform.OS === "web" ? 67 : insets.top;
  const bottom = Platform.OS === "web" ? 34 : insets.bottom;

  const showErrorDetails = () => {
    Alert.alert(
      "Diagnostic Firestore",
      `UID: ${user?.uid ?? "??"}\nEmail: ${user?.email ?? "??"}\n\nErreur: ${loadError}\n\nSolutions:\n1. Vérifiez vos règles Firestore dans Firebase Console\n2. La règle requise:\n   resource.data.adminId == request.auth.uid\n3. Ou utilisez "Récupérer avec un code"`,
      [
        { text: "Réessayer", onPress: refreshCoPros },
        { text: "OK" },
      ]
    );
  };

  return (
    <LinearGradient
      colors={[COLORS.dark, COLORS.darkMid, "#0D2047"]}
      style={styles.root}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={[styles.inner, { paddingTop: top + 32, paddingBottom: bottom + 24 }]}>
        <View style={styles.brand}>
          <View style={styles.logoWrap}>
            <Ionicons name="business" size={36} color={COLORS.tealLight} />
          </View>
          <Text style={styles.title}>Bienvenue sur Maintena</Text>
          <Text style={styles.subtitle}>
            Gérez votre copropriété en équipe.{"\n"}Commencez par créer ou rejoindre une copropriété.
          </Text>
        </View>

        {loadError && (
          <Pressable style={styles.errorBanner} onPress={showErrorDetails}>
            <Ionicons name="warning" size={16} color="#FF6B35" />
            <Text style={styles.errorText}>
              Vos copropriétés n'ont pas pu être chargées.{"\n"}
              <Text style={styles.errorLink}>Appuyez pour voir le diagnostic</Text>
            </Text>
          </Pressable>
        )}

        <View style={styles.cards}>
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push("/(onboarding)/create")}
          >
            <View style={[styles.cardIcon, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
              <Ionicons name="add-circle" size={28} color={COLORS.primary} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Créer une copropriété</Text>
              <Text style={styles.cardDesc}>
                Je suis syndic ou gestionnaire et je veux configurer ma copropriété
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push("/(onboarding)/join")}
          >
            <View style={[styles.cardIcon, { backgroundColor: "rgba(14,186,170,0.12)" }]}>
              <Ionicons name="qr-code" size={28} color={COLORS.teal} />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Rejoindre avec un code</Text>
              <Text style={styles.cardDesc}>
                {loadError
                  ? "Syndic : entrez votre code prestataire pour récupérer l'accès admin"
                  : "J'ai un code d'invitation pour rejoindre une copropriété existante"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} />
          </Pressable>

          {loadError && (
            <Pressable
              style={({ pressed }) => [styles.card, styles.recoverCard, pressed && styles.cardPressed]}
              onPress={refreshCoPros}
              disabled={isLoading}
            >
              <View style={[styles.cardIcon, { backgroundColor: "rgba(255,107,53,0.12)" }]}>
                <Ionicons name="refresh" size={28} color="#FF6B35" />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: "#FF6B35" }]}>
                  {isLoading ? "Chargement..." : "Réessayer le chargement"}
                </Text>
                <Text style={styles.cardDesc}>
                  Tentative de récupération de vos copropriétés existantes
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FF6B35" />
            </Pressable>
          )}
        </View>

        <Pressable style={styles.logoutBtn} onPress={logout}>
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 20, justifyContent: "space-between" },
  brand: { alignItems: "center", gap: 12 },
  logoWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
  },
  title: {
    fontSize: 26, fontFamily: "Inter_700Bold",
    color: "#fff", textAlign: "center", letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 20,
  },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,107,53,0.12)",
    borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(255,107,53,0.3)",
  },
  errorText: {
    flex: 1, fontSize: 13, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.7)", lineHeight: 18,
  },
  errorLink: {
    fontFamily: "Inter_600SemiBold", color: "#FF6B35",
  },
  cards: { gap: 14 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  recoverCard: {
    borderColor: "rgba(255,107,53,0.2)",
    backgroundColor: "rgba(255,107,53,0.05)",
  },
  cardPressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
  cardIcon: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  cardText: { flex: 1, gap: 4 },
  cardTitle: {
    fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff",
  },
  cardDesc: {
    fontSize: 12, fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)", lineHeight: 16,
  },
  logoutBtn: { alignItems: "center", paddingVertical: 8 },
  logoutText: {
    fontSize: 13, fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.35)",
  },
});
