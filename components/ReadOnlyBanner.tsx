import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "@/constants/colors";
import { useCoPro } from "@/context/CoProContext";

/**
 * Résidence en lecture seule (essai terminé, abonnement du syndic arrêté) : tout reste
 * consultable, rien ne peut être ajouté. Le syndic est invité à choisir un abonnement.
 */
export function ReadOnlyNotice({ compact, style }: { compact?: boolean; style?: object }) {
  const { isReadOnly, currentRole } = useCoPro();
  if (!isReadOnly) return null;
  const isSyndic = currentRole === "admin" || currentRole === "co-admin";
  const text = isSyndic
    ? "Votre résidence est en lecture seule : tout reste consultable, mais plus rien ne peut être ajouté ni modifié (interventions, alertes, documents, photos…). La suppression reste possible."
    : "La résidence est en lecture seule : tout reste consultable, mais plus rien ne peut être ajouté ni modifié. Votre syndic peut réactiver l'accès.";
  return (
    <View style={[styles.box, compact && styles.compact, style]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.title}>⏸️ Période d'essai terminée</Text>
        {!compact && <Text style={styles.text}>{text}</Text>}
      </View>
      {isSyndic && (
        <Pressable style={styles.btn} onPress={() => router.push("/(blocked)")}>
          <Text style={styles.btnText}>Voir l'abonnement</Text>
          <Ionicons name="chevron-forward" size={14} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: COLORS.warning,
    borderRadius: 14,
    padding: 14,
  },
  compact: { paddingVertical: 10, borderRadius: 12 },
  title: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#92400E" },
  text: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#78350F", lineHeight: 18 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
