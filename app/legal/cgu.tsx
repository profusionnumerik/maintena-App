import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

export default function CguScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>CGU</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Conditions d’utilisation</Text>
          <Text style={styles.updated}>Dernière mise à jour : 2026</Text>

          <Section
            title="1. Objet"
            text="Maintena est une application destinée à la gestion et au suivi des interventions en copropriété."
          />

          <Section
            title="2. Utilisateurs"
            text="L’application peut être utilisée par les syndics, les prestataires et les copropriétaires ou occupants autorisés."
          />

          <Section
            title="3. Compte utilisateur"
            text="Chaque utilisateur est responsable des informations qu’il fournit et de l’usage de ses identifiants d’accès."
          />

          <Section
            title="4. Utilisation du service"
            text="L’utilisateur s’engage à utiliser l’application de manière loyale et conforme à sa finalité, notamment pour la gestion réelle d’interventions et d’informations liées à une copropriété."
          />

          <Section
            title="5. Interdictions"
            text="Il est interdit d’utiliser l’application pour transmettre de fausses informations, perturber le service, accéder sans autorisation à des données ou détourner le service de son usage prévu."
          />

          <Section
            title="6. Responsabilités"
            text="Profusion Numérik fournit l’application en tant qu’outil numérique. La réalisation des interventions, les relations contractuelles et les décisions opérationnelles restent sous la responsabilité des utilisateurs concernés."
          />

          <Section
            title="7. Suspension ou suppression"
            text="Un compte peut être suspendu ou supprimé en cas d’usage frauduleux, abusif ou non conforme aux présentes conditions."
          />

          <Section
            title="8. Contact"
            text="Pour toute question relative à l’utilisation du service : contact@profusionnumerik.com"
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Section({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    width: 38,
    height: 38,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    gap: 14,
  },
  title: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: COLORS.text,
  },
  updated: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: COLORS.textMuted,
  },
  section: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  sectionText: {
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_400Regular",
    color: COLORS.text,
  },
});