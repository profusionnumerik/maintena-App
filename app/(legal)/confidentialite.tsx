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
          <Text style={styles.updated}>Dernière mise à jour : mai 2026</Text>

          <Section
            title="1. Responsable du traitement"
            text="Profusion Numérik (SIREN 932 117 500) est responsable du traitement de vos données personnelles dans le cadre de l'application Maintena. Contact : contact@profusionnumerik.com — Tél. : 06 68 18 30 92."
          />

          <Section
            title="2. Données collectées"
            text="Nous collectons uniquement les données nécessaires au fonctionnement du service : nom, prénom, adresse email, numéro de téléphone, rôle au sein de la copropriété, contenu saisi (rapports, notes), photos d'intervention, et, après votre autorisation explicite, données de localisation pour vérifier la présence sur site."
          />

          <Section
            title="3. Finalités du traitement"
            text="Vos données sont utilisées pour : créer et gérer votre compte, suivre et attribuer les interventions, faciliter les échanges entre syndics, prestataires et résidents, envoyer des notifications liées aux interventions, et améliorer la qualité du service."
          />

          <Section
            title="4. Base légale"
            text="Le traitement est fondé sur l'exécution du contrat (fourniture du service), l'intérêt légitime (amélioration du service, sécurité) et, pour certaines données sensibles, votre consentement explicite."
          />

          <Section
            title="5. Partage des données"
            text="Vos données ne sont pas vendues. Elles sont partagées uniquement avec les membres autorisés au sein de votre copropriété (syndic, prestataires concernés, résidents autorisés) ainsi qu'avec nos sous-traitants techniques (Firebase/Google pour l'hébergement et l'authentification, Resend pour les emails, Stripe pour le paiement) dans le strict cadre du service."
          />

          <Section
            title="6. Localisation"
            text="La localisation n'est demandée que lorsque vous effectuez une déclaration de présence sur site. Elle n'est jamais utilisée comme outil de suivi permanent. Vous pouvez révoquer cette autorisation à tout moment depuis les paramètres de votre appareil."
          />

          <Section
            title="7. Hébergement"
            text="Les données sont hébergées sur les serveurs de Google Cloud (europe-west1, Union Européenne) et Firebase (Google). Stripe traite les données de paiement conformément à sa propre politique de confidentialité et aux normes PCI-DSS."
          />

          <Section
            title="8. Durée de conservation"
            text="Les données de compte sont conservées tant que le compte est actif. En cas de suppression du compte, les données personnelles sont effacées dans un délai de 30 jours, sauf obligation légale de conservation (données comptables conservées 10 ans)."
          />

          <Section
            title="9. Vos droits (RGPD)"
            text="Conformément au RGPD, vous disposez des droits suivants : accès, rectification, suppression, limitation, portabilité et opposition au traitement de vos données. Vous pouvez exercer ces droits en nous contactant à contact@profusionnumerik.com. En cas de désaccord, vous avez le droit d'introduire une réclamation auprès de la CNIL (www.cnil.fr)."
          />

          <Section
            title="10. Suppression de compte"
            text="Vous pouvez demander la suppression de votre compte et de l'ensemble de vos données depuis l'application (Profil → Supprimer mon compte) ou via la page https://maintena-pro.fr/account-deletion. La demande est traitée dans un délai de 30 jours."
          />

          <Section
            title="11. Cookies"
            text="L'application mobile n'utilise pas de cookies. La version web utilise des cookies strictement nécessaires au fonctionnement du service (session, authentification). Aucun cookie publicitaire n'est déposé."
          />

          <Section
            title="12. Modifications"
            text="Cette politique peut être mise à jour. En cas de modification substantielle, vous serez notifié dans l'application. La date de dernière mise à jour est indiquée en haut de ce document."
          />

          <Section
            title="13. Contact"
            text="Pour toute question relative à la protection de vos données : contact@profusionnumerik.com"
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
