export type SubscriptionPlan = "benevole" | "starter" | "pro" | "business";

export const PLAN_COPRO_LIMITS: Record<SubscriptionPlan, number> = {
  benevole: 1,
  starter: 4,
  pro: 15,
  business: 30,
};

export const PLAN_PRICES: Record<SubscriptionPlan, { monthly: number; annual: number; label: string }> = {
  benevole: { monthly: 4.99, annual: 49,  label: "Bénévole" },
  starter:  { monthly: 9.99,  annual: 99,  label: "Starter" },
  pro:      { monthly: 19.99, annual: 199, label: "Pro" },
  business: { monthly: 34.99, annual: 349, label: "Business" },
};

export interface UserSubscription {
  status: "none" | "active" | "expired" | "trialing";
  plan?: SubscriptionPlan;
  activatedAt?: string;
  expiresAt?: string;
  trialEndsAt?: string;
}

export type Category =
  | "nettoyage"
  | "ascenseur"
  | "portail"
  | "parking"
  | "vmc"
  | "plomberie"
  | "electricite"
  | "espaces_verts"
  | "chaufferie"
  | "video_surveillance"
  | "facade"
  | "toiture"
  | "local_poubelle"
  | "piscine"
  | "interphone"
  | "desinfection"
  | "divers";

export const ALL_CATEGORIES: Category[] = [
  "nettoyage", "plomberie", "electricite", "espaces_verts",
  "ascenseur", "portail", "parking", "vmc", "chaufferie",
  "video_surveillance", "facade", "toiture", "local_poubelle",
  "piscine", "interphone", "desinfection", "divers",
];

export const CORE_CATEGORIES: Category[] = [
  "nettoyage", "plomberie", "electricite", "espaces_verts", "divers",
];

export const OPTIONAL_CATEGORIES: Category[] = [
  "ascenseur", "portail", "parking", "vmc", "chaufferie",
  "video_surveillance", "facade", "toiture", "local_poubelle",
  "piscine", "interphone", "desinfection",
];

export type RecurrenceType = "daily" | "weekly" | "monthly" | "quarterly" | "biannual" | "annual";

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  daily:     "Quotidienne",
  weekly:    "Hebdomadaire",
  monthly:   "Mensuelle",
  quarterly: "Trimestrielle",
  biannual:  "Semestrielle",
  annual:    "Annuelle",
};

export const RECURRENCE_ICONS: Record<RecurrenceType, string> = {
  daily:     "sunny-outline",
  weekly:    "calendar-outline",
  monthly:   "calendar",
  quarterly: "repeat",
  biannual:  "repeat-outline",
  annual:    "medal-outline",
};

// Nombre d'occurrences par défaut et maximum par fréquence
export const RECURRENCE_DEFAULTS: Record<RecurrenceType, { default: number; max: number }> = {
  daily:     { default: 30,  max: 365 },
  weekly:    { default: 52,  max: 104 },
  monthly:   { default: 12,  max: 36  },
  quarterly: { default: 4,   max: 20  },
  biannual:  { default: 2,   max: 10  },
  annual:    { default: 1,   max: 10  },
};

export interface RecurrencePattern {
  type: RecurrenceType;
  days?: number[];
  occurrences: number;
  groupId?: string;
}

export type Status = "planifie" | "en_cours" | "termine";
export type CoProStatus = "pending" | "active" | "suspended";
export type MemberRole = "admin" | "collaborateur" | "prestataire" | "propriétaire" | "conseil";

export interface BuildingDef {
  name: string;
  floors: number;
}

export interface BuildingConfig {
  buildings: BuildingDef[];
  hasElevator: boolean;
  hasCellar: boolean;
  hasParking: boolean;
  hasBikeParking: boolean;
  hasTrashRoom: boolean;
  hasExteriorAccess: boolean;
  customAreas: string[];
}

export const DEFAULT_BUILDING_CONFIG: BuildingConfig = {
  buildings: [{ name: "Bâtiment A", floors: 3 }],
  hasElevator: false,
  hasCellar: false,
  hasParking: false,
  hasBikeParking: false,
  hasTrashRoom: true,
  hasExteriorAccess: false,
  customAreas: [],
};

export interface CleaningArea {
  id: string;
  label: string;
  group: string;
}

function normalizeBuildingConfig(config: BuildingConfig): BuildingDef[] {
  if (config.buildings && config.buildings.length > 0) return config.buildings;
  const legacyCount = (config as any).buildingCount ?? 1;
  const legacyFloors = (config as any).floorsPerBuilding ?? 3;
  return Array.from({ length: legacyCount }, (_, i) => ({
    name: legacyCount > 1 ? `Bâtiment ${String.fromCharCode(65 + i)}` : "Bâtiment",
    floors: legacyFloors,
  }));
}

export function generateCleaningAreas(config: BuildingConfig): CleaningArea[] {
  const areas: CleaningArea[] = [];
  const buildings = normalizeBuildingConfig(config);
  const multi = buildings.length > 1;

  areas.push({ id: "hall_principal", label: "Hall d'entrée principal", group: "Parties communes" });
  areas.push({ id: "boites_lettres", label: "Boîtes aux lettres", group: "Parties communes" });

  buildings.forEach((building, b) => {
    const group = multi ? building.name : "Espaces communs";
    const batId = multi ? `_bat${b + 1}` : "";
    const batSuffix = multi ? ` (${building.name})` : "";

    if (config.hasElevator) {
      areas.push({ id: `ascenseur_cabine${batId}`, label: `Cabine ascenseur${batSuffix}`, group });
      areas.push({ id: `ascenseur_portes${batId}`, label: `Portes palières ascenseur${batSuffix}`, group });
    }
    areas.push({ id: `escalier${batId}`, label: `Cage d'escalier${batSuffix}`, group });

    for (let f = 1; f <= building.floors; f++) {
      const ordinal = f === 1 ? "1er" : `${f}ème`;
      areas.push({
        id: `palier${batId}_etage${f}`,
        label: `Palier ${ordinal} étage${batSuffix}`,
        group,
      });
    }
  });

  const annexes = "Annexes";
  if (config.hasCellar) areas.push({ id: "cave_soussol", label: "Cave / Sous-sol", group: annexes });
  if (config.hasParking) areas.push({ id: "parking_voitures", label: "Parking voitures", group: annexes });
  if (config.hasBikeParking) areas.push({ id: "parking_velos", label: "Parking vélos", group: annexes });
  if (config.hasTrashRoom) areas.push({ id: "local_poubelles", label: "Local poubelles", group: annexes });
  if (config.hasExteriorAccess) areas.push({ id: "acces_exterieur", label: "Accès extérieur", group: annexes });

  config.customAreas.forEach((area, idx) => {
    const trimmed = area.trim();
    if (trimmed) {
      areas.push({ id: `custom_${idx}`, label: trimmed, group: "Personnalisé" });
    }
  });

  return areas;
}

export function buildDefaultChecklist(config: BuildingConfig): Record<string, boolean> {
  const areas = generateCleaningAreas(config);
  const checklist: Record<string, boolean> = {};
  // Démarrer tout à false : le prestataire coche ce qu'il a effectivement nettoyé
  areas.forEach((a) => { checklist[a.id] = false; });
  return checklist;
}

export interface ConseilVoteCandidate {
  uid: string;
  displayName: string;
}

export interface ConseilVote {
  status: "open" | "closed";
  candidates: ConseilVoteCandidate[];
  votes: Record<string, string>; // voterUid → candidateUid
  requestedBy: string;
  requestedAt: string;
  closedAt?: string;
  winnerId?: string | null;
}

export interface RevoteRequest {
  requestedBy: string;
  requestedAt: string; // ISO — expire après 7 jours sans majorité
  approvals: Record<string, boolean>; // uid → true (oui) | false (non)
}

export interface CoPro {
  id: string;
  name: string;
  address?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  adminId: string;
  adminEmail: string;
  status: CoProStatus;
  inviteCode: string;
  ownerInviteCode?: string;
  conseilInviteCode?: string;
  stripeSessionId?: string;
  stripePaid?: boolean;
  createdAt: string;
  latitude?: number;
  longitude?: number;
  locationRadius?: number;
  requireOnsiteCheck?: boolean;
  disabledCategories?: Category[];
  categoryInviteCodes?: Partial<Record<Category, string>>;
  trialEndsAt?: string;
  alertEmailEnabled?: boolean;
  buildingConfig?: BuildingConfig;
  tresorierUid?: string | null;
  conseilVote?: ConseilVote | null;
  revoteRequest?: RevoteRequest | null;
  // Informations légales du syndic (pour les documents officiels)
  syndicCompanyName?: string; // Nom de la société syndic (si différent du nom résidence)
  syndicSiret?: string;       // SIRET du syndicat des copropriétaires ou du syndic
  syndicPhone?: string;       // Téléphone du syndic
  syndicLegalForm?: string;   // Forme juridique (SARL, SAS, bénévole…)
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
  invitedBy?: string;
  categoryFilter?: Category;
  receiveAnnouncementEmails?: boolean; // undefined = true (opt-out model)
}

export type EntryType = "programmation" | "intervention";

export interface Intervention {
  id: string;
  coProId: string;
  title: string;
  description: string;
  category: Category;
  status: Status;
  date: string;
  entryType?: EntryType;
  scheduledDate?: string;

  assignedToUid?: string;
  assignedToName?: string;

  rating?: number;
  technician?: string;
  technicianPhone?: string;

  recurrenceGroupId?: string;
  recurrenceIndex?: number;
  recurrenceTotal?: number;

  createdBy: string;
  createdByName: string;
  createdAt: string;

  photos?: string[];
  completionPhotos?: string[];
  completionComment?: string;

  locationVerified?: boolean;
  locationDistance?: number;

  cleaningChecklist?: Record<string, boolean>;

  // 🔥 NOUVEAUX CHAMPS (IMPORTANT)
  interventionReport?: string;
  interventionRemaining?: string;

  // Statut de confirmation du prestataire
  providerStatus?: "pending" | "accepted" | "refused";
  providerStatusAt?: string;

  // Montant de l'intervention (saisi par le syndic après réalisation)
  amount?: number;
  amountSetAt?: string;

  // 🔥 MODE INVITATION RAPIDE
  interventionAccessCode?: string;
  providerMode?: "registered" | "external";

  invitedProvider?: {
    name?: string;
    email?: string;
    phone?: string;
  };
}

export const CATEGORY_LABELS: Record<Category, string> = {
  nettoyage: "Nettoyage",
  ascenseur: "Ascenseur (maintenance)",
  portail: "Portail",
  parking: "Parking",
  vmc: "VMC",
  plomberie: "Plomberie",
  electricite: "Électricité",
  espaces_verts: "Espaces verts",
  chaufferie: "Chaufferie",
  video_surveillance: "Vidéo-surveillance",
  facade: "Façade",
  toiture: "Toiture",
  local_poubelle: "Local poubelles",
  piscine: "Piscine",
  interphone: "Interphone",
  desinfection: "Désinfection",
  divers: "Divers",
};

export const CATEGORY_ICONS: Record<Category, string> = {
  nettoyage: "sparkles",
  ascenseur: "arrow-up-circle",
  portail: "enter",
  parking: "car",
  vmc: "partly-sunny",
  plomberie: "water",
  electricite: "flash",
  espaces_verts: "leaf",
  chaufferie: "flame",
  video_surveillance: "videocam",
  facade: "business",
  toiture: "home",
  local_poubelle: "trash",
  piscine: "water-outline",
  interphone: "call",
  desinfection: "shield-checkmark",
  divers: "ellipsis-horizontal-circle",
};

export const STATUS_LABELS: Record<Status, string> = {
  planifie: "Planifié",
  en_cours: "En cours",
  termine: "Terminé",
};

export const COPRO_STATUS_LABELS: Record<CoProStatus, string> = {
  pending: "En attente",
  active: "Active",
  suspended: "Suspendue",
};

export interface PendingProvider {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  coProIds: string[];
  categoryFilters: Partial<Record<string, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface Signalement {
  id: string;
  coProId: string;
  message: string;
  uid: string;
  displayName: string;
  senderName: string;
  apartmentNumber: string;
  photoUrl?: string;
  photos?: string[];
  createdAt: string;
  read: boolean;
  acknowledged: boolean;
  acknowledgedAt?: string;
  category?: Category;
  urgency?: "normal" | "urgent";
  devisDemandeId?: string;
}

export type AnnouncementType = "info" | "eau" | "chauffage" | "travaux" | "urgent";

export interface Announcement {
  id: string;
  coProId: string;
  title: string;
  message: string;
  type: AnnouncementType;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  expiresAt?: string;
}

// Sondages
export type PollTarget = "conseil" | "propriétaires" | "tous";

export interface Poll {
  id: string;
  coProId: string;
  title: string;
  options: string[];
  target: PollTarget;
  createdBy: string;       // uid
  createdByName: string;
  createdAt: string;
  votes: Record<string, number>; // uid → index de l'option choisie
  status: "open" | "closed";
  closedAt?: string;
  expiresAt?: string;
}

export const POLL_TARGET_LABELS: Record<PollTarget, string> = {
  conseil: "Conseil syndical uniquement",
  "propriétaires": "Tous les copropriétaires",
  tous: "Tout le monde (admin inclus)",
};

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  info: "Information",
  eau: "Coupure d'eau",
  chauffage: "Coupure de chauffage",
  travaux: "Travaux",
  urgent: "Urgence",
};

export const ANNOUNCEMENT_TYPE_COLORS: Record<AnnouncementType, string> = {
  info: "#2563EB",
  eau: "#0EBAAA",
  chauffage: "#F59E0B",
  travaux: "#8B5CF6",
  urgent: "#EF4444",
};

// ─── Module Conseil Syndical — Contrôle des comptes ───────────────────────

export type ExpenseCategory =
  | "eau"
  | "ecs"
  | "chauffage"
  | "electricite"
  | "gaz"
  | "assurance"
  | "ascenseur"
  | "nettoyage"
  | "espaces_verts"
  | "travaux"
  | "honoraires_syndic"
  | "divers";

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  eau: "Eau froide",
  ecs: "ECS (eau chaude)",
  chauffage: "Chauffage collectif",
  electricite: "Électricité",
  gaz: "Gaz",
  assurance: "Assurance",
  ascenseur: "Ascenseur",
  nettoyage: "Nettoyage",
  espaces_verts: "Espaces verts",
  travaux: "Travaux",
  honoraires_syndic: "Honoraires syndic",
  divers: "Divers",
};

export const EXPENSE_CATEGORY_ICONS: Record<ExpenseCategory, string> = {
  eau: "water-outline",
  ecs: "thermometer-outline",
  chauffage: "bonfire-outline",
  electricite: "flash-outline",
  gaz: "flame-outline",
  assurance: "shield-checkmark-outline",
  ascenseur: "arrow-up-circle-outline",
  nettoyage: "sparkles-outline",
  espaces_verts: "leaf-outline",
  travaux: "construct-outline",
  honoraires_syndic: "briefcase-outline",
  divers: "ellipsis-horizontal-circle-outline",
};

export const EXPENSE_CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  eau: "#0EBAAA",
  ecs: "#F97316",
  chauffage: "#EF4444",
  electricite: "#F59E0B",
  gaz: "#FB923C",
  assurance: "#6366F1",
  ascenseur: "#8B5CF6",
  nettoyage: "#10B981",
  espaces_verts: "#22C55E",
  travaux: "#3B82F6",
  honoraires_syndic: "#64748B",
  divers: "#94A3B8",
};

export const ALL_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "eau", "ecs", "chauffage", "electricite", "gaz", "assurance", "ascenseur",
  "nettoyage", "espaces_verts", "travaux", "honoraires_syndic", "divers",
];

export interface Expense {
  id: string;
  coProId: string;
  label: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  invoiceNumber?: string;
  description?: string;
  interventionId?: string;
  buildingId?: string; // "commun" | building name
  addedBy: string;
  addedByName: string;
  createdAt: string;
  updatedAt?: string;
}

export interface BudgetLine {
  category: ExpenseCategory;
  budgeted: number;
}

export interface BudgetCustomLine {
  id: string;
  label: string;
  amount: number;
  buildingId?: string; // "commun" | building name
}

export interface AnnualBudget {
  id: string;
  coProId: string;
  year: number;
  lines: Partial<Record<ExpenseCategory, number>>;
  customLines?: BudgetCustomLine[];
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ProviderContact {
  id: string;
  coProId: string;
  coProName?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
  specialty?: string; // métier / fonction (plombier, électricien…)
  createdAt: string;
}

export interface DevisOffer {
  id: string;
  contactId: string;
  contactName: string;
  contactCompany: string;
  contactEmail: string;
  token: string; // token unique pour le formulaire public
  signatureToken?: string; // token unique pour la signature électronique
  priceTTC?: number;
  description?: string;
  devisFileUrl?: string; // URL du document devis uploadé
  signatureUrl?: string; // URL de la signature électronique (prestataire)
  signedAt?: string;
  adminSignatureUrl?: string; // URL de la signature du syndic/admin
  adminSignedAt?: string;
  finalDevisUrl?: string; // PDF final avec signatures apposées
  submittedAt?: string;
  submitted: boolean;
}

// ─── Module Suivi d'entretien ──────────────────────────────────────────────

export type EntretienPeriodicite = "mensuel" | "trimestriel" | "semestriel" | "annuel" | "biennal";

export const ENTRETIEN_PERIODICITE_LABELS: Record<EntretienPeriodicite, string> = {
  mensuel:     "Mensuel",
  trimestriel: "Trimestriel",
  semestriel:  "Semestriel",
  annuel:      "Annuel",
  biennal:     "Tous les 2 ans",
};

export const ENTRETIEN_PERIODICITE_DAYS: Record<EntretienPeriodicite, number> = {
  mensuel:     30,
  trimestriel: 91,
  semestriel:  182,
  annuel:      365,
  biennal:     730,
};

export type EntretienEquipement =
  | "ascenseur"
  | "vmc"
  | "chaufferie"
  | "portail"
  | "interphone"
  | "extincteurs"
  | "desenfumage"
  | "toiture"
  | "facade"
  | "espaces_verts"
  | "piscine"
  | "video_surveillance"
  | "divers";

export const ENTRETIEN_EQUIPEMENT_LABELS: Record<EntretienEquipement, string> = {
  ascenseur:        "Ascenseur",
  vmc:              "VMC / Ventilation",
  chaufferie:       "Chaufferie",
  portail:          "Portail / Accès",
  interphone:       "Interphone / Visiophone",
  extincteurs:      "Extincteurs",
  desenfumage:      "Désenfumage",
  toiture:          "Toiture",
  facade:           "Façade",
  espaces_verts:    "Espaces verts",
  piscine:          "Piscine",
  video_surveillance: "Vidéo-surveillance",
  divers:           "Équipement divers",
};

export const ENTRETIEN_EQUIPEMENT_ICONS: Record<EntretienEquipement, string> = {
  ascenseur:        "arrow-up-circle-outline",
  vmc:              "partly-sunny-outline",
  chaufferie:       "flame-outline",
  portail:          "enter-outline",
  interphone:       "call-outline",
  extincteurs:      "alert-circle-outline",
  desenfumage:      "cloud-outline",
  toiture:          "home-outline",
  facade:           "business-outline",
  espaces_verts:    "leaf-outline",
  piscine:          "water-outline",
  video_surveillance: "videocam-outline",
  divers:           "construct-outline",
};

export interface EntretienVisit {
  id: string;
  date: string;          // ISO date
  technicianName?: string;
  notes?: string;
  addedBy: string;
  addedByName: string;
  createdAt: string;
}

export interface Entretien {
  id: string;
  coProId: string;
  equipement: EntretienEquipement;
  label: string;             // Nom personnalisé (ex: "Ascenseur bat. A")
  prestataire?: string;      // Nom de la société prestataire
  prestatairePhone?: string;
  periodicite: EntretienPeriodicite;
  lastVisitDate?: string;    // ISO date
  nextVisitDate?: string;    // ISO date (calculée ou manuelle)
  notes?: string;            // Notes générales sur l'équipement
  visits: EntretienVisit[];  // Historique des visites
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
}

export type EntretienStatut = "ok" | "bientot" | "retard" | "inconnu";

/** Calcule le statut visuel d'un équipement basé sur nextVisitDate */
export function getEntretienStatut(entretien: Entretien): EntretienStatut {
  if (!entretien.nextVisitDate) return "inconnu";
  const now = Date.now();
  const next = new Date(entretien.nextVisitDate).getTime();
  const diff = next - now;
  const days = diff / 86_400_000;
  if (days < 0) return "retard";
  if (days <= 30) return "bientot";
  return "ok";
}

export const ENTRETIEN_STATUT_CONFIG: Record<EntretienStatut, { label: string; color: string; bg: string; icon: string }> = {
  ok:      { label: "À jour",       color: "#10B981", bg: "rgba(16,185,129,0.1)",  icon: "checkmark-circle" },
  bientot: { label: "Bientôt dû",   color: "#F59E0B", bg: "rgba(245,158,11,0.1)",  icon: "time" },
  retard:  { label: "En retard",    color: "#EF4444", bg: "rgba(239,68,68,0.1)",   icon: "warning" },
  inconnu: { label: "Non planifié", color: "#94A3B8", bg: "rgba(148,163,184,0.1)", icon: "help-circle" },
};

export type DemandeDevisStatus = "open" | "devis_demandes" | "devis_recus" | "cloture";

export interface DemandeDevis {
  id: string;
  coProId: string;
  title: string;
  description: string;
  category: Category;
  urgency: "normal" | "urgent";
  createdBy: string;
  createdByName: string;
  createdAt: string;
  status: DemandeDevisStatus;
  devis: DevisOffer[];
  selectedDevisId?: string | null;
  closedAt?: string;
}
