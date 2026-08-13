/**
 * lib/observationSuggestions.ts
 * Suggestions d'observations professionnelles pour les états des lieux.
 * Organisées par type d'élément (matching par mots-clés) + état constaté.
 */

import type { ElementCondition } from "@/shared/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SuggestionContext = {
  elementName: string;
  condition: ElementCondition;
};

// ── Dictionnaire de suggestions ───────────────────────────────────────────────
// Clé = mots-clés (minuscules, séparés par |)
// Valeur = Record<condition, suggestions[]>

type CondMap = Partial<Record<ElementCondition, string[]>>;

const DICT: Array<{ keys: string[]; cond: CondMap }> = [

  // ── SOL ──────────────────────────────────────────────────────────────────
  {
    keys: ["parquet", "plancher", "lame", "stratifié", "bois"],
    cond: {
      new:     [
        "Parquet en parfait état, aucune rayure ni marque visible.",
        "Revêtement de sol bois neuf, brillant et sans défaut.",
        "Lames parfaitement jointives, surface lisse et propre.",
      ],
      good:      [
        "Parquet en bon état général, quelques micro-rayures d'usage normales.",
        "Revêtement de sol propre, légères traces de passage sans dégradation.",
        "Lames en bon état, quelques marques superficielles sans conséquence.",
      ],
      fair:    [
        "Parquet présentant des rayures et marques d'usure normales liées à l'occupation.",
        "Revêtement usé par le passage, quelques lames légèrement ternis.",
        "Sol bois avec traces d'usure notable sur les zones de circulation.",
      ],
      poor:  [
        "Parquet très usé, nombreuses rayures profondes et zones ternes.",
        "Lames gondolées ou disjointes par endroits, usure avancée.",
        "Revêtement de sol ancien, vétusté importante sans dégradation accidentelle.",
      ],
      damaged:  [
        "Parquet dégradé : lames cassées / décollées nécessitant remplacement.",
        "Taches profondes et dommages irréversibles sur le revêtement de sol.",
        "Sol bois en mauvais état, dégradations dépassant l'usure normale.",
      ],
    },
  },

  {
    keys: ["carrelage", "faïence", "céramique", "tommette", "dalle"],
    cond: {
      new:     [
        "Carrelage en parfait état, joints propres et intacts.",
        "Faïence neuve sans fissure ni éclat, brillante et propre.",
        "Dalles parfaitement posées, aucune trace de détérioration.",
      ],
      good:      [
        "Carrelage propre, quelques micro-éraflures sans importance.",
        "Joints légèrement jaunis par l'usage, carreaux sans éclat.",
        "Revêtement en bon état général, traces d'entretien normales.",
      ],
      fair:    [
        "Carrelage présentant des joints encrassés et quelques éraflures.",
        "Quelques carreaux ébréchés sur les angles, usure régulière.",
        "Sol carrelé usé, joints noircis par l'usage prolongé.",
      ],
      poor:  [
        "Nombreux joints détériorés, quelques fissures sur les carreaux.",
        "Carrelage ancien avec plusieurs éclats et joints dégradés.",
        "Revêtement très usé, quelques dalles descellées.",
      ],
      damaged:  [
        "Plusieurs carreaux cassés ou fissurés, joints inexistants par endroits.",
        "Dégradations importantes du carrelage dépassant l'usure normale.",
        "Carreaux décollés et éclats multiples, remplacement nécessaire.",
      ],
    },
  },

  {
    keys: ["moquette", "tapis", "sol souple"],
    cond: {
      new:     [
        "Moquette neuve, propre et sans aucune trace.",
        "Revêtement textile en parfait état, moelleux et homogène.",
      ],
      good:      [
        "Moquette propre, légères marques de passage normales.",
        "Revêtement textile en bon état, quelques zones plus foncées.",
      ],
      fair:    [
        "Moquette usée sur les zones de circulation, aspect fatigué.",
        "Revêtement textile tassé et marqué par le passage.",
      ],
      poor:  [
        "Moquette très usée, poils couchés et couleur passée.",
        "Revêtement ancien et fatigué, nécessite remplacement à terme.",
      ],
      damaged:  [
        "Moquette tachée et déchirée, dégradations dépassant l'usure normale.",
        "Taches importantes et décollement partiel du revêtement.",
      ],
    },
  },

  // ── MURS / PLAFOND ────────────────────────────────────────────────────────
  {
    keys: ["mur", "paroi", "cloison", "peinture", "tapisserie", "papier peint", "enduit"],
    cond: {
      new:     [
        "Murs en parfait état, peinture fraîche sans aucune marque.",
        "Cloisons propres, peinture lisse et uniforme.",
        "Parois en excellent état, aucune trace ni accroc.",
      ],
      good:      [
        "Murs propres avec quelques légères marques d'usure normale.",
        "Peinture en bon état, quelques accrocs superficiels sans importance.",
        "Cloisons en bon état général, légères traces de frottement.",
      ],
      fair:    [
        "Murs présentant des marques et accrocs liés à l'occupation normale.",
        "Peinture légèrement ternie et quelques impacts mineurs.",
        "Cloisons avec traces d'usage : légères rayures et marques.",
      ],
      poor:  [
        "Peinture vieillie, fissures fines et décollements légers par endroits.",
        "Murs très usés, nombreuses marques et zones décollées.",
        "Parois en mauvais état esthétique, usure importante sans dégradation accidentelle.",
      ],
      damaged:  [
        "Trous, impacts importants et traces dépassant l'usure normale.",
        "Murs dégradés : taches profondes, papier arraché ou peinture écaillée.",
        "Dégradations importantes sur les parois nécessitant remise en état.",
      ],
    },
  },

  {
    keys: ["plafond", "corniche", "faux-plafond"],
    cond: {
      new:     [
        "Plafond en parfait état, peinture blanche sans auréole ni marque.",
        "Plafond neuf, surface lisse et homogène.",
      ],
      good:      [
        "Plafond propre, quelques légères traces sans importance.",
        "Plafond en bon état, légère poussière sur les bords.",
      ],
      fair:    [
        "Plafond avec légères auréoles et traces de condensation ancienne.",
        "Peinture plafond ternie par le temps, sans dégradation notable.",
      ],
      poor:  [
        "Plafond fissuré par endroits, peinture écaillée sur les bords.",
        "Nombreuses auréoles et traces d'humidité ancienne stabilisée.",
      ],
      damaged:  [
        "Plafond dégradé : fissures profondes ou traces d'infiltration active.",
        "Peinture décollée et boursouflures sur le plafond.",
      ],
    },
  },

  // ── MENUISERIES ───────────────────────────────────────────────────────────
  {
    keys: ["porte", "portail", "chambranle", "huisserie"],
    cond: {
      new:     [
        "Porte en parfait état, serrure et poignée fonctionnelles.",
        "Menuiserie neuve, fermeture fluide et étanchéité parfaite.",
      ],
      good:      [
        "Porte en bon état, légères marques sur le bas du vantail.",
        "Serrure et poignée fonctionnelles, quelques micro-éraflures normales.",
      ],
      fair:    [
        "Porte avec rayures et marques d'usage sur le bas, fermeture correcte.",
        "Légère usure de la peinture sur les angles et le bas de porte.",
      ],
      poor:  [
        "Porte très usée, peinture écaillée et bois apparent sur les angles.",
        "Fermeture difficile, joint d'étanchéité défaillant.",
      ],
      damaged:  [
        "Porte dégradée : impacts importants, serrure défaillante ou bois gonflé.",
        "Dommages structurels sur la porte dépassant l'usure normale.",
      ],
    },
  },

  {
    keys: ["fenêtre", "fenetre", "volet", "store", "persienne", "double vitrage"],
    cond: {
      new:     [
        "Fenêtre en parfait état, double vitrage intact, fermeture étanche.",
        "Menuiserie neuve, volets fonctionnels, aucun défaut constaté.",
      ],
      good:      [
        "Fenêtre en bon état, fermeture correcte, quelques traces de condensation.",
        "Volets fonctionnels, légère usure de la peinture extérieure.",
      ],
      fair:    [
        "Fenêtre avec traces de condensation et joints légèrement usés.",
        "Fermeture correcte mais mécanisme de volet légèrement rigide.",
      ],
      poor:  [
        "Joint de fenêtre défaillant, légères infiltrations d'air.",
        "Volets avec lattes abîmées, peinture très usée.",
      ],
      damaged:  [
        "Vitrage fissuré ou fenêtre ne fermant plus correctement.",
        "Volets hors d'usage ou menuiserie gonflée par l'humidité.",
      ],
    },
  },

  // ── SANITAIRES ────────────────────────────────────────────────────────────
  {
    keys: ["baignoire", "bain"],
    cond: {
      new:     [
        "Baignoire en parfait état, émail sans rayure ni tache.",
        "Baignoire neuve, robinetterie fonctionnelle et brillante.",
      ],
      good:      [
        "Baignoire propre, légères traces de calcaire sans importance.",
        "Émail en bon état, quelques micro-rayures d'usage.",
      ],
      fair:    [
        "Baignoire avec dépôts de calcaire et légères décolorations.",
        "Émail terne par endroits, traces d'usage normales.",
      ],
      poor:  [
        "Émail très usé, taches tenaces et zone d'égouttage décolorée.",
        "Robinetterie ancienne avec traces de calcaire importantes.",
      ],
      damaged:  [
        "Émail écaillé ou fissures sur la baignoire.",
        "Dégradations importantes dépassant l'usure normale.",
      ],
    },
  },

  {
    keys: ["douche", "receveur", "paroi de douche"],
    cond: {
      new:     [
        "Receveur de douche en parfait état, paroi sans trace.",
        "Douche neuve, bac propre et joints silicone intacts.",
      ],
      good:      [
        "Receveur propre, légères traces de calcaire sans importance.",
        "Paroi de douche en bon état, joints sains.",
      ],
      fair:    [
        "Dépôts de calcaire sur le receveur et les parois, usage normal.",
        "Joints légèrement noircis, paroi avec traces d'usage.",
      ],
      poor:  [
        "Receveur très calcaire, joints détériorés et paroi ternie.",
        "Paroi de douche avec traces tenaces dépassant l'entretien courant.",
      ],
      damaged:  [
        "Fissures sur le receveur, étanchéité compromise.",
        "Joints décollés et moisissures importantes sur la paroi.",
      ],
    },
  },

  {
    keys: ["wc", "toilette", "cuvette", "abattant", "chasse d'eau", "chasse eau"],
    cond: {
      new:     [
        "WC en parfait état, cuvette et abattant propres.",
        "Chasse d'eau fonctionnelle, mécanisme neuf.",
      ],
      good:      [
        "WC propres, légères traces de calcaire sans importance.",
        "Mécanisme de chasse d'eau fonctionnel.",
      ],
      fair:    [
        "Cuvette avec dépôts de calcaire, usage normal.",
        "Abattant légèrement jauni par le temps.",
      ],
      poor:  [
        "Cuvette très calcaire, abattant usé et jauni.",
        "Mécanisme de chasse d'eau à entretenir.",
      ],
      damaged:  [
        "Fissure sur la cuvette ou chasse d'eau défaillante.",
        "Dégradations importantes dépassant l'usure normale.",
      ],
    },
  },

  {
    keys: ["lavabo", "évier", "evier", "vasque", "robinet", "robinetterie"],
    cond: {
      new:     [
        "Lavabo en parfait état, robinetterie brillante et fonctionnelle.",
        "Évier propre sans tache, mitigeur neuf.",
      ],
      good:      [
        "Lavabo propre, légères traces de calcaire sur le bord.",
        "Robinetterie fonctionnelle, quelques dépôts mineurs.",
      ],
      fair:    [
        "Dépôts de calcaire sur le lavabo et la robinetterie, usage normal.",
        "Évier avec traces d'usage et légère décoloration du joint.",
      ],
      poor:  [
        "Émail très calcaire, robinetterie ancienne avec fuites légères.",
        "Joint de lavabo décollé par endroits, usure avancée.",
      ],
      damaged:  [
        "Fissure sur le lavabo ou fuite importante de robinetterie.",
        "Dégradations importantes nécessitant remplacement.",
      ],
    },
  },

  // ── ÉLECTRICITÉ / CHAUFFAGE ───────────────────────────────────────────────
  {
    keys: ["interrupteur", "prise", "prise électrique", "tableau électrique", "disjoncteur"],
    cond: {
      new:     [
        "Appareillage électrique en parfait état, fonctionnel.",
        "Prises et interrupteurs neufs, sans trace.",
      ],
      good:      [
        "Appareillage électrique fonctionnel, légères traces sans importance.",
        "Prises en bon état, quelques jaunissements d'usage.",
      ],
      fair:    [
        "Appareillage fonctionnel, jaunissement et traces d'usure normales.",
        "Quelques prises avec cache légèrement abîmé.",
      ],
      poor:  [
        "Appareillage ancien, quelques prises à changer à terme.",
        "Interrupteurs cassés par endroits, fonctionnement correct.",
      ],
      damaged:  [
        "Prises défaillantes ou appareillage dangereux à remplacer.",
        "Câbles apparents ou installation non conforme.",
      ],
    },
  },

  {
    keys: ["radiateur", "chauffage", "convecteur", "plancher chauffant"],
    cond: {
      new:     [
        "Radiateur en parfait état, robinet de réglage fonctionnel.",
        "Chauffage neuf, chauffe correctement.",
      ],
      good:      [
        "Radiateur fonctionnel, légères traces de poussière.",
        "Chauffage en bon état, thermostat réactif.",
      ],
      fair:    [
        "Radiateur fonctionnel, peinture légèrement abîmée sur les ailettes.",
        "Quelques traces de rouille superficielle sans incidence.",
      ],
      poor:  [
        "Radiateur ancien, robinet de réglage rigide.",
        "Chauffage fonctionnel mais très usé, à surveiller.",
      ],
      damaged:  [
        "Fuite sur le radiateur ou chauffage défaillant.",
        "Dégradations importantes sur le système de chauffage.",
      ],
    },
  },

  // ── CUISINE ───────────────────────────────────────────────────────────────
  {
    keys: ["plan de travail", "plan travail", "meuble de cuisine", "meuble cuisine", "placard", "tiroir"],
    cond: {
      new:     [
        "Mobilier de cuisine en parfait état, charnières fonctionnelles.",
        "Plan de travail neuf sans rayure ni tache.",
      ],
      good:      [
        "Mobilier en bon état, quelques marques légères d'usage.",
        "Plan de travail propre, légères traces de découpe.",
      ],
      fair:    [
        "Marques de découpe et traces sur le plan de travail, usage normal.",
        "Quelques façades légèrement rayées ou décolorées.",
      ],
      poor:  [
        "Plan de travail très usé, chants décollés par endroits.",
        "Mobilier vétuste, charnières à régler.",
      ],
      damaged:  [
        "Plan de travail brûlé ou décollé, dégradations importantes.",
        "Mobilier endommagé dépassant l'usure normale.",
      ],
    },
  },

  {
    keys: ["cuisine", "cuisinière", "plaque", "four", "hotte"],
    cond: {
      new:     [
        "Électroménager en parfait état, fonctionnel.",
        "Cuisinière neuve, plaques et four propres.",
      ],
      good:      [
        "Appareil propre et fonctionnel, légères traces d'usage.",
        "Cuisinière en bon état, quelques projections légères.",
      ],
      fair:    [
        "Traces d'usage et légères projections normales sur l'appareil.",
        "Grilles légèrement encrassées, fonctionnement correct.",
      ],
      poor:  [
        "Appareil très usé, quelques éléments moins réactifs.",
        "Hotte ancienne, filtre à nettoyer ou remplacer.",
      ],
      damaged:  [
        "Appareil défaillant ou endommagé, dépasse l'usure normale.",
        "Brûlures importantes ou panne sur l'équipement.",
      ],
    },
  },

  // ── DÉFAUT : fallback général ─────────────────────────────────────────────
  {
    keys: ["__default__"],
    cond: {
      new:     [
        "Élément en parfait état, aucune marque ni défaut constaté.",
        "État neuf, aucune usure visible.",
        "Excellent état, conforme à un logement récemment rénové.",
      ],
      good:      [
        "Bon état général, quelques traces légères d'usage normales.",
        "En bon état, usure normale correspondant à l'ancienneté du logement.",
        "État satisfaisant, légères marques sans conséquence.",
      ],
      fair:    [
        "Usure normale liée à l'occupation, sans dégradation particulière.",
        "Marques d'usage habituelles, état conforme à la durée d'occupation.",
        "Traces d'usure normales ne dépassant pas la vétusté naturelle.",
      ],
      poor:  [
        "Usure avancée liée à l'ancienneté, sans dégradation accidentelle.",
        "État vétuste sans dommage accidentel constaté.",
        "Vieillissement naturel prononcé, état cohérent avec l'ancienneté du logement.",
      ],
      damaged:  [
        "Dégradation constatée dépassant l'usure normale.",
        "Dommages importants nécessitant remise en état.",
        "Détérioration anormale ne relevant pas de la vétusté naturelle.",
      ],
      not_checked: [
        "Élément non vérifié au moment de l'état des lieux.",
      ],
    },
  },
];

// ── Moteur de matching ────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // enlève accents
    .replace(/[^a-z0-9\s]/g, "");
}

export function getSuggestions(
  elementName: string,
  condition: ElementCondition
): string[] {
  const norm = normalize(elementName);
  const fallback = DICT.find((d) => d.keys.includes("__default__"))!;

  // Trouver la meilleure entrée (premier match)
  const match = DICT.find((entry) => {
    if (entry.keys.includes("__default__")) return false;
    return entry.keys.some((k) => norm.includes(normalize(k)));
  }) ?? fallback;

  const cond = condition === "not_checked" ? "not_checked" : condition;
  const list = match.cond[cond as ElementCondition] ?? fallback.cond[cond as ElementCondition] ?? [];

  // Toujours retourner 3 suggestions (complète avec le fallback si besoin)
  const fallbackList = fallback.cond[cond as ElementCondition] ?? [];
  const combined = [...list, ...fallbackList.filter((f) => !list.includes(f))];
  return combined.slice(0, 3);
}

// ── Suggestions pour observation de pièce (niveau général) ───────────────────

const ROOM_SUGGESTIONS: Partial<Record<ElementCondition, string[]>> = {
  new:      [
    "Pièce en parfait état général, aucun défaut constaté.",
    "Ensemble de la pièce en excellent état, prête à être occupée.",
    "Tous les éléments de la pièce sont en état neuf.",
  ],
  good:     [
    "Pièce en bon état général, légères traces d'usage sans importance.",
    "État satisfaisant de l'ensemble de la pièce.",
    "Bon état général, quelques marques normales liées à l'occupation.",
  ],
  fair:     [
    "Pièce présentant une usure normale correspondant à la durée d'occupation.",
    "Usure habituelle sur l'ensemble des éléments, sans dégradation.",
    "État d'usage courant, aucune dégradation anormale constatée.",
  ],
  poor:     [
    "Pièce très usée dans l'ensemble, vétusté naturelle prononcée.",
    "Usure avancée de la pièce sans dommage accidentel.",
    "État vétuste général cohérent avec l'ancienneté du logement.",
  ],
  damaged:  [
    "Plusieurs éléments de la pièce présentent des dégradations importantes.",
    "Pièce dégradée au-delà de l'usure normale.",
    "Dommages constatés sur l'ensemble de la pièce nécessitant remise en état.",
  ],
};

export function getRoomSuggestions(condition: ElementCondition): string[] {
  return ROOM_SUGGESTIONS[condition] ?? [
    "Aucune observation particulière.",
    "État non évalué au moment de l'état des lieux.",
  ];
}
