import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";

export default function ConfidentialiteScreen() {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Confidentialité</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>Politique de confidentialité</Text>
          <Text style={styles.updated}>Dernière mise à jour : 2026</Text>

          <Section
            title="1. Éditeur"
            text="L’application Maintena est éditée et exploitée par Profusion Numérik."
          />

          <Section
            title="2. Données collectées"
            text="Nous collectons uniquement les données nécessaires au fonctionnement du service : nom, prénom, email, téléphone, informations liées aux interventions, photos d’intervention et, lorsque nécessaire, la localisation pour vérifier la présence sur site."
          />

          <Section
            title="3. Utilisation des données"
            text="Ces données sont utilisées pour créer, suivre et attribuer les interventions, faciliter les échanges entre syndics, prestataires et copropriétaires, et améliorer la qualité du service."
          />

          <Section
            title="4. Partage des données"
            text="Les données ne sont pas revendues. Elles sont partagées uniquement avec les personnes autorisées dans le cadre de l’exploitation du service : syndic, prestataires concernés, membres autorisés de la copropriété."
          />

          <Section
            title="5. Localisation"
            text="La localisation n’est utilisée que pour vérifier la présence sur site lors d’une déclaration ou d’une intervention. Elle n’est pas utilisée comme outil de suivi permanent."
          />

          <Section
            title="6. Sécurité"
            text="Nous mettons en place des mesures techniques raisonnables pour sécuriser les données et limiter les accès non autorisés."
          />

          <Section
            title="7. Conservation"
            text="Les données sont conservées pendant la durée nécessaire au fonctionnement du service et au respect des obligations légales ou contractuelles."
          />

          <Section
            title="8. Vos droits"
            text="Conformément à la réglementation applicable, vous pouvez demander l’accès, la rectification ou la suppression de vos données, dans la mesure permise par la loi."
          />

          <Section
            title="9. Contact"
            text="Pour toute demande liée à la confidentialité ou à vos données personnelles : contact@profusionnumerik.com"
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