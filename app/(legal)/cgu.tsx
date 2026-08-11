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
          <Text style={styles.title}>Conditions Générales d'Utilisation</Text>
          <Text style={styles.updated}>Dernière mise à jour : août 2026</Text>

          <Section
            title="1. Éditeur"
            text="L'application Maintena est éditée par Profusion Numérik, entreprise individuelle, SIREN 932 117 500, dont le siège social est en France. Contact : contact@profusionnumerik.com — Tél. : 06 68 18 30 92."
          />

          <Section
            title="2. Objet"
            text="Maintena est une application de gestion et de suivi des interventions en copropriété, destinée aux syndics, prestataires et résidents. Elle est disponible sur Android via Google Play et en version web."
          />

          <Section
            title="3. Acceptation des conditions"
            text="L'utilisation de l'application implique l'acceptation pleine et entière des présentes conditions. Si vous n'acceptez pas ces conditions, vous devez cesser d'utiliser l'application."
          />

          <Section
            title="4. Comptes utilisateurs"
            text="Chaque utilisateur est responsable de l'exactitude des informations fournies et de la confidentialité de ses identifiants d'accès. Toute utilisation du compte est réputée faite par le titulaire. En cas de perte ou de compromission de vos identifiants, vous devez contacter immédiatement contact@profusionnumerik.com."
          />

          <Section
            title="5. Accès au service et abonnement"
            text={
              "L'accès complet au service requiert un abonnement payant souscrit via Stripe.\n\n" +
              "Tarifs mensuels (sans engagement) :\n" +
              "• Syndic Bénévole — 4,99 €/mois (1 copropriété) · 1 mois offert à l'inscription (carte bancaire requise)\n" +
              "• Starter — 9,99 €/mois (1 à 4 copropriétés)\n" +
              "• Pro — 19,99 €/mois (jusqu'à 15 copropriétés)\n" +
              "• Business — 34,99 €/mois (jusqu'à 30 copropriétés)\n\n" +
              "Offres annuelles : Starter 99 €/an · Pro 199 €/an · Business 349 €/an.\n\n" +
              "L'essai gratuit du plan Bénévole est limité à une utilisation par numéro de téléphone. Les prix peuvent évoluer ; les abonnés sont informés 30 jours avant toute modification tarifaire."
            }
          />

          <Section
            title="6. Résiliation"
            text="L'abonnement mensuel est résiliable à tout moment depuis votre espace client Stripe, sans préavis ni frais. L'abonnement annuel est souscrit pour 12 mois et non remboursable en cas de résiliation anticipée, sauf disposition légale contraire."
          />

          <Section
            title="7. Utilisation du service"
            text="L'utilisateur s'engage à utiliser l'application de manière loyale, conformément à sa finalité, et dans le respect de la réglementation en vigueur. Il est notamment interdit de transmettre de fausses informations, de perturber le service, d'accéder sans autorisation à des données tierces ou de détourner le service de son usage prévu."
          />

          <Section
            title="8. Propriété intellectuelle"
            text="L'ensemble des éléments de l'application (code, design, textes, logos) est la propriété exclusive de Profusion Numérik. Toute reproduction, distribution ou modification sans autorisation préalable est interdite."
          />

          <Section
            title="9. Responsabilités"
            text="Profusion Numérik fournit l'application en tant qu'outil numérique d'aide à la gestion. La réalisation des interventions, les relations contractuelles entre syndics et prestataires, et les décisions opérationnelles restent sous la responsabilité exclusive des utilisateurs. Profusion Numérik ne saurait être tenu responsable des dommages indirects liés à l'usage du service."
          />

          <Section
            title="10. Disponibilité"
            text="Profusion Numérik s'efforce d'assurer la disponibilité du service 24h/24 et 7j/7 mais ne peut garantir une disponibilité sans interruption. Des maintenances planifiées ou des incidents techniques peuvent survenir."
          />

          <Section
            title="11. Suppression de compte"
            text="Vous pouvez demander la suppression de votre compte et de vos données depuis l'application (rubrique Profil) ou depuis la page https://maintena-pro.fr/account-deletion."
          />

          <Section
            title="12. Droit applicable"
            text="Les présentes conditions sont régies par le droit français. Tout litige relatif à leur interprétation ou à leur exécution relève de la compétence des tribunaux français."
          />

          <Section
            title="13. Contact"
            text="Pour toute question relative aux présentes conditions : contact@profusionnumerik.com"
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
