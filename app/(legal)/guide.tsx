import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/colors";
import { useCoPro } from "@/context/CoProContext";

// Role sets — used to gate sections and items
const ADMIN      = ["admin", "co-admin"];
const PRIVILEGED = ["admin", "co-admin", "conseil"];
const RESIDENTS  = ["admin", "co-admin", "conseil", "propriétaire", "collaborateur"];
const ALL        = ["admin", "co-admin", "conseil", "propriétaire", "collaborateur", "prestataire"];

function canSee(visibleRoles: string[] | undefined, role: string | null | undefined): boolean {
  if (!visibleRoles) return true;
  if (!role) return true;
  return visibleRoles.includes(role);
}

type Item = {
  title: string;
  roleLabel?: string;
  visibleRoles?: string[];
  steps: string[];
};

type Section = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  title: string;
  desc: string;
  visibleRoles: string[];
  items: Item[];
};

const SECTIONS: Section[] = [
  {
    id: "rejoindre",
    icon: "key-outline",
    color: "#2563EB",
    bg: "#EFF6FF",
    title: "Rejoindre la résidence",
    desc: "Créez votre compte et rejoignez votre copropriété.",
    visibleRoles: ALL,
    items: [
      {
        title: "Depuis un lien d'invitation",
        visibleRoles: ALL,
        steps: [
          "Appuyez sur le lien d'invitation reçu par message ou email",
          "Téléchargez Maintena depuis le Google Play Store",
          "Créez un compte avec votre adresse email",
          "Vous êtes automatiquement ajouté(e) à la résidence",
        ],
      },
    ],
  },
  {
    id: "signalements",
    icon: "megaphone-outline",
    color: "#E11D48",
    bg: "#FFF1F2",
    title: "Signalements",
    desc: "Signalez un problème (fuite, panne, éclairage…) en quelques secondes.",
    visibleRoles: RESIDENTS,
    items: [
      {
        title: "Faire un signalement",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet Alertes → appuyez sur « Nouveau signalement »",
          "Décrivez le problème et ajoutez une photo si possible",
          "Envoyez — le conseil syndical est notifié immédiatement",
          "Vous recevrez une notification quand votre signalement est pris en compte",
        ],
      },
      {
        title: "Répondre à un signalement",
        roleLabel: "Conseil syndical & Admin",
        visibleRoles: PRIVILEGED,
        steps: [
          "Recevez la notification ou consultez l'onglet Alertes",
          "Appuyez sur le signalement pour lire le détail",
          "Rédigez une réponse pour informer le résident de la suite donnée",
        ],
      },
    ],
  },
  {
    id: "interventions",
    icon: "construct-outline",
    color: "#D97706",
    bg: "#FFFBEB",
    title: "Interventions",
    desc: "Suivez les travaux et maintenances de la résidence.",
    visibleRoles: ALL,
    items: [
      {
        title: "Soumettre un rapport",
        roleLabel: "Prestataire",
        visibleRoles: ["prestataire"],
        steps: [
          "Onglet Interventions — retrouvez les interventions qui vous sont assignées",
          "Appuyez sur une intervention pour ouvrir la fiche",
          "Une fois le travail effectué, appuyez sur « Marquer comme réalisée »",
          "Rédigez votre rapport et ajoutez des photos si nécessaire",
          "Soumettez — le conseil syndical est notifié pour valider",
        ],
      },
      {
        title: "Créer une intervention",
        roleLabel: "Conseil syndical & Admin",
        visibleRoles: PRIVILEGED,
        steps: [
          "Onglet Interventions → bouton + en bas à droite",
          "Renseignez le titre, la catégorie et la date",
          "Assignez à un prestataire existant ou ajoutez-en un nouveau",
          "Validez — le prestataire est notifié automatiquement",
        ],
      },
      {
        title: "Valider une intervention",
        roleLabel: "Conseil syndical & Admin",
        visibleRoles: PRIVILEGED,
        steps: [
          "Le prestataire soumet son rapport une fois le travail terminé",
          "Vous recevez une notification « Rapport à valider »",
          "Vérifiez et appuyez sur « Valider l'intervention »",
          "L'intervention passe au statut Terminée et s'enregistre dans le carnet",
        ],
      },
      {
        title: "Consulter les interventions",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet Interventions — vue de toutes les interventions en cours et passées",
          "Appuyez sur une intervention pour voir le détail, les photos et le rapport",
        ],
      },
    ],
  },
  {
    id: "annonces",
    icon: "notifications-outline",
    color: "#0891B2",
    bg: "#ECFEFF",
    title: "Annonces",
    desc: "Publiez ou lisez les informations importantes de la résidence.",
    visibleRoles: RESIDENTS,
    items: [
      {
        title: "Publier une annonce",
        roleLabel: "Admin / Co-admin",
        visibleRoles: ADMIN,
        steps: [
          "Onglet Alertes → onglet « Annonces »",
          "Appuyez sur « Nouvelle annonce »",
          "Choisissez le type : Information, Urgence ou Réunion",
          "Rédigez et publiez — tous les membres reçoivent une notification",
        ],
      },
      {
        title: "Lire les annonces",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet Alertes → « Annonces »",
          "Les annonces sont classées par date avec le type affiché en couleur",
        ],
      },
    ],
  },
  {
    id: "sondages",
    icon: "bar-chart-outline",
    color: "#7C3AED",
    bg: "#F5F3FF",
    title: "Sondages",
    desc: "Consultez les résidents avant de prendre une décision.",
    visibleRoles: RESIDENTS,
    items: [
      {
        title: "Créer un sondage",
        roleLabel: "Admin / Co-admin",
        visibleRoles: ADMIN,
        steps: [
          "Onglet Alertes → « Sondages »",
          "Appuyez sur « Nouveau sondage »",
          "Saisissez la question et les options de réponse",
          "Publiez — tous les membres reçoivent une notification pour voter",
        ],
      },
      {
        title: "Participer à un sondage",
        visibleRoles: RESIDENTS,
        steps: [
          "Recevez la notification ou consultez l'onglet Alertes → Sondages",
          "Appuyez sur votre choix pour voter",
          "Les résultats s'affichent en temps réel après votre vote",
        ],
      },
    ],
  },
  {
    id: "carnet",
    icon: "book-outline",
    color: "#16A34A",
    bg: "#F0FDF4",
    title: "Carnet d'entretien",
    desc: "Consultez l'historique des équipements et maintenances de la résidence.",
    visibleRoles: RESIDENTS,
    items: [
      {
        title: "Consulter le carnet",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet Admin → section « Carnet d'entretien »",
          "Retrouvez chaque équipement : ascenseur, chauffage, toiture, VMC…",
          "Date de dernière visite, prochaine échéance, prestataire",
        ],
      },
      {
        title: "Enregistrer après une intervention",
        roleLabel: "Conseil syndical & Admin",
        visibleRoles: PRIVILEGED,
        steps: [
          "Après avoir validé une intervention, une option d'enregistrement apparaît",
          "Sélectionnez l'équipement concerné dans le carnet",
          "L'entrée est créée automatiquement avec la date et le prestataire",
        ],
      },
    ],
  },
  {
    id: "finances",
    icon: "cash-outline",
    color: "#475569",
    bg: "#F8FAFC",
    title: "Suivi des dépenses",
    desc: "Enregistrez les factures et suivez les dépenses engagées sur la résidence.",
    visibleRoles: PRIVILEGED,
    items: [
      {
        title: "Ajouter une dépense",
        roleLabel: "Admin / Co-admin",
        visibleRoles: ADMIN,
        steps: [
          "Onglet Admin → « Finances »",
          "Appuyez sur « Ajouter une dépense »",
          "Renseignez le montant, le prestataire et la catégorie",
          "Ajoutez la photo de la facture si disponible",
        ],
      },
      {
        title: "Consulter les dépenses",
        roleLabel: "Conseil syndical & Admin",
        visibleRoles: PRIVILEGED,
        steps: [
          "Onglet Admin → « Finances »",
          "Visualisez le total des dépenses et le détail par catégorie",
          "Filtrez par période ou type de dépense",
          "Exportez en CSV ou PDF pour l'assemblée générale",
        ],
      },
    ],
  },
  {
    id: "documents",
    icon: "folder-outline",
    color: "#EA580C",
    bg: "#FFF7ED",
    title: "Documents de la résidence",
    desc: "Accédez aux règlements, assurances, diagnostics et comptes-rendus d'AG.",
    visibleRoles: RESIDENTS,
    items: [
      {
        title: "Consulter les documents",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet Admin → « Documents de la résidence »",
          "Filtrez par type : règlement, assurance, diagnostic, AG, contrat…",
          "Appuyez sur un document pour l'ouvrir ou le partager",
        ],
      },
      {
        title: "Ajouter un document",
        roleLabel: "Conseil syndical & Admin",
        visibleRoles: PRIVILEGED,
        steps: [
          "Onglet Admin → « Documents » → bouton + en bas",
          "Sélectionnez le fichier depuis votre téléphone",
          "Choisissez le type et nommez le document",
          "Il est immédiatement accessible à tous les membres",
        ],
      },
    ],
  },
  {
    id: "calendrier",
    icon: "calendar-outline",
    color: "#0369A1",
    bg: "#F0F9FF",
    title: "Planning calendrier",
    desc: "Visualisez toutes les interventions par mois sur un calendrier.",
    visibleRoles: PRIVILEGED,
    items: [
      {
        title: "Naviguer dans le calendrier",
        visibleRoles: PRIVILEGED,
        steps: [
          "Onglet Admin → « Planning calendrier »",
          "Naviguez entre les mois avec les flèches",
          "Points colorés : jaune = planifié, bleu = en cours, vert = terminé",
          "Touchez un jour pour voir la liste des interventions",
        ],
      },
    ],
  },
  {
    id: "tantiemes",
    icon: "pie-chart-outline",
    color: "#9333EA",
    bg: "#FAF5FF",
    title: "Tantièmes & charges",
    desc: "Gérez les lots de copropriété et calculez les quotes-parts de charges.",
    visibleRoles: RESIDENTS,
    items: [
      {
        title: "Consulter les lots et tantièmes",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet Admin → « Tantièmes »",
          "Retrouvez la liste de tous les lots avec leur quote-part",
          "Le total est validé en vert quand il atteint 10 000 tantièmes",
        ],
      },
      {
        title: "Calculer les charges",
        visibleRoles: RESIDENTS,
        steps: [
          "Onglet « Calcul de charges » dans l'écran Tantièmes",
          "Saisissez le montant total à répartir",
          "La quote-part de chaque lot est calculée automatiquement",
          "Exportez le tableau en PDF pour les copropriétaires",
        ],
      },
      {
        title: "Gérer les lots",
        roleLabel: "Admin / Co-admin",
        visibleRoles: ADMIN,
        steps: [
          "Onglet Admin → « Tantièmes » → bouton + en bas",
          "Renseignez le numéro de lot, le propriétaire et les millièmes",
          "Modifiez ou supprimez un lot en appuyant dessus",
        ],
      },
    ],
  },
];

// ── Intro text per role ───────────────────────────────────────────────────────

function getIntroText(role: string | null | undefined): string {
  if (role === "prestataire") {
    return "Retrouvez vos interventions assignées, soumettez vos rapports et suivez l'avancement de vos missions.";
  }
  if (role === "propriétaire" || role === "collaborateur") {
    return "Signalez des problèmes, consultez les annonces, les sondages, le carnet d'entretien et les documents de votre résidence.";
  }
  if (role === "conseil") {
    return "Gérez les interventions, répondez aux signalements, suivez les dépenses et consultez tous les documents de la résidence.";
  }
  // admin / co-admin / unknown
  return "Retrouvez ici tout ce dont vous avez besoin pour gérer votre résidence : signalements, interventions, finances, documents et bien plus.";
}

// ── Badge component ───────────────────────────────────────────────────────────

function RoleBadge({ label }: { label: string }) {
  const isAll         = label === "Tous";
  const isPrestataire = label === "Prestataire";
  const isAdmin       = label.includes("Admin");
  const isConseil     = label.includes("Conseil");

  return (
    <View style={[
      styles.badge,
      isAll         && styles.badgeAll,
      isConseil     && !isAll && styles.badgeConseil,
      isAdmin       && !isConseil && styles.badgeAdmin,
      isPrestataire && styles.badgePrestataire,
    ]}>
      <Text style={[
        styles.badgeText,
        isAll         && styles.badgeTextAll,
        isConseil     && !isAll && styles.badgeTextConseil,
        isAdmin       && !isConseil && styles.badgeTextAdmin,
        isPrestataire && styles.badgeTextPrestataire,
      ]}>
        {isAll         ? "👤 Tous"
          : isPrestataire ? "🔧 Prestataire"
          : isConseil   ? "🛡 " + label
          : "⭐ " + label}
      </Text>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function GuideScreen() {
  const { currentRole } = useCoPro();
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (id: string) => setExpanded(expanded === id ? null : id);

  const visibleSections = SECTIONS.filter(s => canSee(s.visibleRoles, currentRole));

  const isAdmin       = currentRole === "admin" || currentRole === "co-admin";
  const isConseil     = currentRole === "conseil";
  const isPrestataire = currentRole === "prestataire";

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={COLORS.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Guide d'utilisation</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Intro */}
        <View style={styles.intro}>
          <Ionicons name="sparkles" size={28} color={COLORS.primary} />
          <Text style={styles.introTitle}>Bienvenue sur Maintena</Text>
          <Text style={styles.introText}>{getIntroText(currentRole)}</Text>
        </View>

        {/* Legend — only show if multiple role levels are relevant */}
        {!isPrestataire && (
          <View style={styles.legendRow}>
            <RoleBadge label="Tous" />
            {(isAdmin || isConseil) && <RoleBadge label="Conseil syndical" />}
            {isAdmin && <RoleBadge label="Admin / Co-admin" />}
          </View>
        )}

        {/* Sections */}
        {visibleSections.map((section) => {
          const isOpen      = expanded === section.id;
          const visibleItems = section.items.filter(item => canSee(item.visibleRoles, currentRole));
          if (visibleItems.length === 0) return null;

          return (
            <Pressable
              key={section.id}
              onPress={() => toggle(section.id)}
              style={({ pressed }) => [styles.sectionCard, pressed && { opacity: 0.92 }]}
            >
              {/* Section header */}
              <View style={styles.sectionHead}>
                <View style={[styles.sectionIconBox, { backgroundColor: section.bg }]}>
                  <Ionicons name={section.icon} size={22} color={section.color} />
                </View>
                <View style={styles.sectionMeta}>
                  <Text style={styles.sectionName}>{section.title}</Text>
                  <Text style={styles.sectionDesc} numberOfLines={isOpen ? undefined : 1}>
                    {section.desc}
                  </Text>
                </View>
                <Ionicons
                  name={isOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={COLORS.textMuted}
                />
              </View>

              {/* Section body */}
              {isOpen && (
                <View style={styles.sectionBody}>
                  {visibleItems.map((item, idx) => (
                    <View key={idx} style={styles.itemBlock}>
                      <View style={styles.itemHeadRow}>
                        <Text style={styles.itemTitle}>{item.title}</Text>
                        {item.roleLabel && <RoleBadge label={item.roleLabel} />}
                      </View>
                      {item.steps.map((step, si) => (
                        <View key={si} style={styles.step}>
                          <View style={[styles.stepNum, { borderColor: section.color + "55", backgroundColor: section.bg }]}>
                            <Text style={[styles.stepNumText, { color: section.color }]}>{si + 1}</Text>
                          </View>
                          <Text style={styles.stepText}>{step}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Maintena — Profusion Numérik</Text>
          <Text style={styles.footerSub}>maintena-pro.fr</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background ?? "#F1F5F9" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "web" ? 20 : 16,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
  },
  placeholder: { width: 30 },

  content: { padding: 16, paddingBottom: 40, gap: 10 },

  intro: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 4,
  },
  introTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
    textAlign: "center",
  },
  introText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },

  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 4,
  },

  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeAll:          { backgroundColor: "#F0FDF4" },
  badgeConseil:      { backgroundColor: "#ECFEFF" },
  badgeAdmin:        { backgroundColor: "#EFF6FF" },
  badgePrestataire:  { backgroundColor: "#FFF7ED" },
  badgeText:             { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  badgeTextAll:          { color: "#15803D" },
  badgeTextConseil:      { color: "#0E7490" },
  badgeTextAdmin:        { color: "#1E40AF" },
  badgeTextPrestataire:  { color: "#C2410C" },

  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
  },

  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  sectionIconBox: {
    width: 42,
    height: 42,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sectionMeta: { flex: 1 },
  sectionName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
    marginBottom: 2,
  },
  sectionDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
  },

  sectionBody: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    padding: 14,
    gap: 16,
  },

  itemBlock: { gap: 8 },
  itemHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  itemTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: COLORS.text,
    flex: 1,
  },

  step: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  stepText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 19,
    flex: 1,
  },

  footer: {
    alignItems: "center",
    marginTop: 12,
    gap: 2,
  },
  footerText: { fontSize: 12, color: COLORS.textMuted, fontFamily: "Inter_500Medium" },
  footerSub:  { fontSize: 11, color: COLORS.textMuted },
});
