import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS } from "@/constants/colors";
import { HamburgerButton } from "@/components/rental/RentalDrawer";

export default function RentalProfessionnels() {
  const insets = useSafeAreaInsets();
  const paddingTop = Platform.OS === "web" ? 67 + 20 : insets.top + 16;

  return (
    <View style={[styles.root, { paddingTop }]}>
      <View style={styles.header}>
        <HamburgerButton />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title}>Professionnels</Text>
          <Text style={styles.subtitle}>Votre carnet d'artisans et prestataires</Text>
        </View>
      </View>

      <View style={styles.empty}>
        <Ionicons name="people-outline" size={64} color={COLORS.textMuted} style={{ opacity: 0.4 }} />
        <Text style={styles.emptyTitle}>Carnet vide</Text>
        <Text style={styles.emptyDesc}>
          Enregistrez vos artisans de confiance — plombiers, électriciens, chauffagistes…{"\n\n"}
          Un même professionnel peut intervenir pour plusieurs logements ou copropriétés.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingBottom: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
    gap: 6,
  },
  title:    { fontSize: 20, fontFamily: "Inter_700Bold", color: COLORS.text },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: COLORS.textMuted, marginTop: 1 },
  empty: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 40, gap: 12,
  },
  emptyTitle: {
    fontSize: 18, fontFamily: "Inter_600SemiBold", color: COLORS.text,
  },
  emptyDesc: {
    fontSize: 14, fontFamily: "Inter_400Regular",
    color: COLORS.textSecondary, textAlign: "center", lineHeight: 22,
  },
});
