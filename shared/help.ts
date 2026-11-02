import type { HelpContent } from "@/components/HelpModal";

export const HELP: Record<string, { title: string; content: HelpContent }> = {

  annuaire: {
    title: "Annuaire prestataires",
    content: {
      intro: "L'annuaire centralise tous vos prestataires : plombiers, électriciens, ascensoristes… Vous pouvez les retrouver rapidement et les associer à vos interventions.",
      sections: [
        {
          icon: "person-add-outline",
          title: "Ajouter un prestataire",
          text: "Appuyez sur le bouton + en haut à droite. Choisissez le type : Personne physique (artisan indépendant avec nom/prénom) ou Entreprise (raison sociale uniquement).",
        },
        {
          icon: "business-outline",
          title: "Personne morale (Entreprise)",
          text: "Pour une société comme un ascensoriste ou un grand groupe, choisissez Entreprise et saisissez uniquement la raison sociale. Exemple : Orona, OTIS, TotalEnergies.",
        },
        {
          icon: "grid-outline",
          title: "Catégories d'intervention",
          text: "Sélectionnez les domaines de compétence du prestataire (plomberie, électricité, serrurerie…). Cela facilite la recherche lors de la création d'une intervention.",
        },
        {
          icon: "location-outline",
          title: "Géolocalisation automatique",
          text: "La ville saisie est géocodée automatiquement. Cela permet d'afficher la distance entre le prestataire et vos résidences.",
        },
      ],
    },
  },

  interventions: {
    title: "Interventions",
    content: {
      intro: "Suivez toutes les interventions de vos résidences : de la création jusqu'à la clôture, avec photos, prestataire assigné et historique.",
      sections: [
        {
          icon: "add-circle-outline",
          title: "Créer une intervention",
          text: "Appuyez sur + pour créer une nouvelle intervention. Choisissez la catégorie, décrivez le problème, assignez un prestataire depuis l'annuaire et définissez une date.",
        },
        {
          icon: "flag-outline",
          title: "Statuts",
          text: "Planifié → En cours → Terminé. Faites glisser ou modifiez le statut directement depuis la fiche. Les interventions terminées sont archivées automatiquement.",
        },
        {
          icon: "camera-outline",
          title: "Photos",
          text: "Ajoutez des photos avant et après l'intervention pour documenter l'état du bien. Les photos sont stockées de façon sécurisée.",
        },
        {
          icon: "location-outline",
          title: "Géolocalisation",
          text: "En mode passage effectué, votre position GPS est enregistrée pour confirmer la présence sur le site lors de l'intervention.",
        },
      ],
    },
  },

  invitePrestataire: {
    title: "Inviter un prestataire",
    content: {
      intro: "Invitez un prestataire à rejoindre Maintena pour qu'il puisse accéder aux interventions qui le concernent et mettre à jour leur statut.",
      sections: [
        {
          icon: "mail-outline",
          title: "Comment ça marche",
          text: "Saisissez le nom, prénom et email du prestataire. Il reçoit un email d'invitation avec un lien pour créer son compte et accéder directement à ses interventions.",
        },
        {
          icon: "shield-checkmark-outline",
          title: "Accès limité",
          text: "Le prestataire ne voit que les interventions qui lui sont assignées. Il ne peut pas accéder aux informations des autres résidents ou copropriétaires.",
        },
        {
          icon: "refresh-outline",
          title: "Suivi en temps réel",
          text: "Une fois connecté, le prestataire peut mettre à jour le statut de ses interventions et vous envoyer des messages directement depuis l'application.",
        },
      ],
    },
  },

  entretien: {
    title: "Entretiens & maintenance",
    content: {
      intro: "Planifiez et suivez les entretiens récurrents de votre résidence : ascenseur, chaudière, extincteurs, parking…",
      sections: [
        {
          icon: "add-circle-outline",
          title: "Créer un entretien",
          text: "Appuyez sur + et choisissez la catégorie. Définissez la fréquence (mensuelle, trimestrielle, annuelle…) et la date du prochain passage.",
        },
        {
          icon: "alarm-outline",
          title: "Alertes automatiques",
          text: "Maintena vous alerte automatiquement quand un entretien approche ou est en retard. Un badge rouge apparaît dans le menu.",
        },
        {
          icon: "checkmark-circle-outline",
          title: "Valider un passage",
          text: "Après chaque visite, marquez l'entretien comme effectué. La prochaine date se calcule automatiquement selon la fréquence définie.",
        },
      ],
    },
  },

  documents: {
    title: "Documents",
    content: {
      intro: "Centralisez tous les documents importants de votre résidence : contrats, procès-verbaux, diagnostics, assurances…",
      sections: [
        {
          icon: "cloud-upload-outline",
          title: "Ajouter un document",
          text: "Appuyez sur + pour importer un fichier depuis votre téléphone (PDF, image). Donnez-lui un nom et une catégorie pour le retrouver facilement.",
        },
        {
          icon: "people-outline",
          title: "Partage avec les résidents",
          text: "Les documents marqués comme visibles sont accessibles à tous les résidents de la copropriété depuis leur espace personnel.",
        },
        {
          icon: "search-outline",
          title: "Recherche rapide",
          text: "Utilisez la barre de recherche pour retrouver un document par son nom ou sa catégorie.",
        },
      ],
    },
  },

  tantièmes: {
    title: "Tantièmes",
    content: {
      intro: "Les tantièmes représentent la quote-part de chaque copropriétaire dans les parties communes. Ils servent à répartir les charges.",
      sections: [
        {
          icon: "home-outline",
          title: "Configurer les lots",
          text: "Saisissez chaque lot (appartement, parking, cave…) avec son nombre de tantièmes. La somme totale doit correspondre au total de la copropriété (souvent 1000 ou 10 000).",
        },
        {
          icon: "calculator-outline",
          title: "Répartition des charges",
          text: "Une fois les tantièmes renseignés, la répartition des charges se calcule automatiquement au prorata de chaque lot.",
        },
        {
          icon: "document-text-outline",
          title: "Retrouver les tantièmes",
          text: "Les tantièmes figurent dans le règlement de copropriété ou l'état descriptif de division (EDD), documents fournis lors de l'achat.",
        },
      ],
    },
  },

  demandesDevis: {
    title: "Demandes de devis",
    content: {
      intro: "Envoyez des demandes de devis à vos prestataires directement depuis l'application et suivez leurs réponses.",
      sections: [
        {
          icon: "send-outline",
          title: "Créer une demande",
          text: "Décrivez les travaux à réaliser, joignez des photos si nécessaire, puis sélectionnez un ou plusieurs prestataires de votre annuaire.",
        },
        {
          icon: "mail-open-outline",
          title: "Réception des devis",
          text: "Le prestataire reçoit votre demande par email. Lorsqu'il répond, vous êtes notifié et le devis apparaît dans cette section.",
        },
        {
          icon: "checkmark-done-outline",
          title: "Accepter un devis",
          text: "Comparez les devis reçus et acceptez celui de votre choix. Cela crée automatiquement une intervention associée.",
        },
      ],
    },
  },

  controleComptes: {
    title: "Contrôle des comptes",
    content: {
      intro: "Suivez toutes les dépenses de votre copropriété, gérez le budget annuel et partagez les rapports financiers avec le conseil syndical.",
      sections: [
        {
          icon: "person-outline",
          title: "Syndic bénévole : pas besoin de voter",
          text: "Si vous gérez vous-même votre résidence (syndic bénévole), vous êtes à la fois propriétaire, syndic ET trésorier. Vous avez le rôle Admin dans Maintena.\n\nDans ce cas, inutile d'organiser un vote : vous accédez directement au Contrôle des comptes et saisissez les dépenses vous-même.",
        },
        {
          icon: "business-outline",
          title: "Syndic professionnel : élire un trésorier",
          text: "Si votre résidence est gérée par une société (Foncia, Nexity, cabinet indépendant…), le syndic professionnel gère sa propre comptabilité.\n\nDans ce cas, le conseil syndical doit élire un trésorier parmi ses membres pour surveiller les comptes dans Maintena.\n\nPré-requis : invitez d'abord les membres du conseil syndical avec le rôle Conseil.",
        },
        {
          icon: "ribbon-outline",
          title: "Comment se déroule le vote (syndic pro) ?",
          text: "Le vote se fait dans l'onglet Conseil de cet écran :\n\n1. L'admin ouvre le vote (bouton \"Ouvrir le vote\")\n2. Chaque membre du conseil peut se porter candidat\n3. Chaque membre vote pour le candidat de son choix\n4. Le candidat majoritaire devient trésorier automatiquement\n\nEn cas d'égalité, un nouveau tour est lancé. Un membre peut aussi demander un re-vote — la demande expire après 7 jours sans majorité.",
        },
        {
          icon: "add-circle-outline",
          title: "Ajouter une dépense",
          text: "Appuyez sur + pour enregistrer une dépense. Indiquez le montant, la date, le prestataire, la catégorie (travaux, entretien, assurance…) et joignez une facture si besoin.",
        },
        {
          icon: "link-outline",
          title: "Lier à une intervention",
          text: "Le bouton de lien (icône chaîne) permet d'associer une dépense directement à une intervention existante pour un suivi complet travaux → coût.",
        },
        {
          icon: "bar-chart-outline",
          title: "Budget annuel",
          text: "Dans l'onglet Budget, saisissez les montants prévisionnels par catégorie. Maintena compare automatiquement le budget prévu aux dépenses réelles.",
        },
        {
          icon: "download-outline",
          title: "Export CSV / PDF",
          text: "Exportez le récapitulatif des dépenses en CSV (pour Excel) ou en PDF pour le partager lors d'une assemblée générale ou avec le conseil syndical.",
        },
        {
          icon: "shield-checkmark-outline",
          title: "Accès conseil syndical",
          text: "Les membres du conseil syndical ont accès en lecture seule à cet écran. Ils peuvent consulter les dépenses et les budgets sans pouvoir les modifier.",
        },
      ],
    },
  },

  communication: {
    title: "Communication",
    content: {
      intro: "Centralisez toute la communication de votre copropriété : alertes des résidents, annonces de l'admin, sondages et rappels aux prestataires.",
      sections: [
        {
          icon: "warning-outline",
          title: "Alertes",
          text: "Les résidents et prestataires peuvent signaler un problème (fuite, panne, dégradation…). Chaque signalement indique le nom, l'appartement, la catégorie et le niveau d'urgence. L'admin peut accuser réception ou demander un devis directement.",
        },
        {
          icon: "megaphone-outline",
          title: "Annonces",
          text: "L'admin publie des annonces visibles par tous les membres : coupure d'eau, travaux programmés, réunion de copropriété… Chaque annonce peut avoir une date d'expiration. Les membres peuvent activer les notifications par email.",
        },
        {
          icon: "bar-chart-outline",
          title: "Sondages",
          text: "Créez des sondages pour consulter les copropriétaires ou le conseil syndical sur un sujet. Choisissez les destinataires (conseil, propriétaires, tous) et une date de clôture. Les résultats s'affichent en temps réel.",
        },
        {
          icon: "notifications-outline",
          title: "Rappels",
          text: "Envoyez un rappel par email à un prestataire pour une intervention programmée ou en retard. L'historique des rappels envoyés est conservé ici avec la date, l'heure et le destinataire.",
        },
      ],
    },
  },

  configResidence: {
    title: "Configuration de la résidence",
    content: {
      intro: "Configurez votre résidence pour que Maintena soit adapté à votre copropriété : nombre de bâtiments, équipements, résidents…",
      sections: [
        {
          icon: "person-outline",
          title: "Syndic bénévole ou professionnel ?",
          text: "Syndic bénévole : vous êtes copropriétaire ET vous gérez vous-même la résidence. Vous créez le compte Maintena → rôle Admin. Vous êtes aussi le trésorier, pas besoin de vote.\n\nSyndic professionnel (Foncia, Nexity…) : société externe mandatée par l'AG. Elle crée le compte → rôle Admin. Le conseil syndical devra élire un trésorier parmi ses membres pour surveiller les comptes.",
        },
        {
          icon: "business-outline",
          title: "Informations générales",
          text: "Renseignez le nom, l'adresse et le nombre de lots de votre résidence. Ces informations apparaissent sur tous vos documents.",
        },
        {
          icon: "layers-outline",
          title: "Bâtiments et équipements",
          text: "Indiquez le nombre de bâtiments, le nombre d'étages, la présence d'ascenseurs, de parking souterrain, d'espaces verts… Cela personnalise les catégories d'interventions.",
        },
        {
          icon: "people-outline",
          title: "Inviter les résidents",
          text: "Depuis le menu Résidents, invitez vos copropriétaires, locataires et membres du conseil syndical. Chaque rôle a un accès adapté à ses besoins.",
        },
        {
          icon: "key-outline",
          title: "Rôles et accès",
          text: "Admin : accès complet (syndic bénévole ou professionnel).\nCo-admin : gère interventions et comptes (ex. trésorier élu).\nConseil syndical : consulte les finances et documents.\nCopropriétaire / locataire : voit les interventions et documents partagés.",
        },
        {
          icon: "ribbon-outline",
          title: "Conseil syndical et trésorier",
          text: "Le conseil syndical est élu en assemblée générale. Parmi ses membres, l'un est désigné trésorier — il surveille les comptes.\n\nDans Maintena : invitez le trésorier avec le rôle Co-admin pour qu'il puisse accéder au module Contrôle des comptes.",
        },
      ],
    },
  },
};
