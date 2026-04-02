export interface UserSubscription {
  status: "none" | "active" | "expired";
  activatedAt?: string;
  expiresAt?: string;
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

export type RecurrenceType = "weekly" | "monthly";

export interface RecurrencePattern {
  type: RecurrenceType;
  days?: number[];
  occurrences: number;
  groupId?: string;
}

export type Status = "planifie" | "en_cours" | "termine";
export type CoProStatus = "pending" | "active" | "suspended";
export type MemberRole = "admin" | "prestataire" | "propriétaire";

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
      areas.push({ id: `ascenseur${batId}`, label: `Ascenseur${batSuffix}`, group });
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
  areas.forEach((a) => { checklist[a.id] = true; });
  return checklist;
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
  stripeSessionId?: string;
  stripePaid?: boolean;
  createdAt: string;
  latitude?: number;
  longitude?: number;
  locationRadius?: number;
  disabledCategories?: Category[];
  categoryInviteCodes?: Partial<Record<Category, string>>;
  alertEmailEnabled?: boolean;
  buildingConfig?: BuildingConfig;
}

export interface Member {
  uid: string;
  email: string;
  displayName: string;
  role: MemberRole;
  joinedAt: string;
  invitedBy?: string;
  categoryFilter?: Category;
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
  ascenseur: "Ascenseur",
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
