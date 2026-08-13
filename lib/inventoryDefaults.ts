import { RoomType, AnnexType, RoomItem, PropertyType } from "@/shared/types";
import { v4 as randomUUID } from "uuid";

// ─── Labels lisibles ──────────────────────────────────────────────────────────

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  entree:      "Entrée",
  sejour:      "Séjour",
  salon:       "Salon",
  cuisine:     "Cuisine",
  chambre:     "Chambre",
  salle_bains: "Salle de bains",
  salle_eau:   "Salle d'eau",
  wc:          "WC",
  couloir:     "Couloir / Dégagement",
  dressing:    "Dressing",
  bureau:      "Bureau",
  buanderie:   "Buanderie",
  cellier:     "Cellier",
  custom:      "Pièce personnalisée",
};

export const ANNEX_TYPE_LABELS: Record<AnnexType, string> = {
  garage:       "Garage",
  parking:      "Parking",
  cave:         "Cave",
  grenier:      "Grenier",
  balcon:       "Balcon",
  terrasse:     "Terrasse",
  jardin:       "Jardin",
  cour:         "Cour",
  dependance:   "Dépendance",
  local:        "Local / Remise",
  autre:        "Autre annexe",
};

// ─── Items par défaut par type de pièce ───────────────────────────────────────

const item = (name: string): RoomItem => ({
  id:        randomUUID(),
  name,
  condition: "not_checked",
  photos:    [],
});

export const DEFAULT_ROOM_ITEMS: Record<RoomType, RoomItem[]> = {
  entree: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Porte d'entrée"), item("Serrure / Verrou"), item("Sonnette"),
    item("Prises électriques"), item("Interrupteurs"), item("Éclairage"),
    item("Rangements"), item("Boîte aux lettres"),
  ],
  sejour: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Fenêtres"), item("Volets / Stores"), item("Portes"),
    item("Prises électriques"), item("Interrupteurs"), item("Éclairage"),
    item("Chauffage"), item("Placard / Rangements"),
  ],
  salon: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Fenêtres"), item("Volets / Stores"), item("Portes"),
    item("Prises électriques"), item("Interrupteurs"), item("Éclairage"),
    item("Chauffage"),
  ],
  cuisine: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Fenêtres"), item("Volets / Stores"), item("Porte"),
    item("Prises électriques"), item("Interrupteurs"), item("Éclairage"),
    item("Évier"), item("Robinetterie"), item("Plan de travail"),
    item("Meubles bas"), item("Meubles hauts"), item("Hotte"),
    item("Plaques de cuisson"), item("Four"), item("Réfrigérateur"),
    item("Lave-vaisselle"), item("Plomberie (dessous évier)"),
    item("Joints / Faïence"), item("Chauffage"),
  ],
  chambre: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Fenêtres"), item("Volets / Stores"), item("Portes"),
    item("Prises électriques"), item("Interrupteurs"), item("Éclairage"),
    item("Chauffage"), item("Placards / Rangements"),
  ],
  salle_bains: [
    item("Sol"), item("Murs / Carrelage"), item("Plafond"),
    item("Fenêtres"), item("Porte"), item("Miroir"),
    item("Lavabo"), item("Robinetterie lavabo"), item("Douche"),
    item("Robinetterie douche"), item("Baignoire"), item("Joints / Silicone"),
    item("WC"), item("Chasse d'eau"), item("Abattant WC"),
    item("Éclairage"), item("Ventilation / VMC"), item("Chauffage / Sèche-serviette"),
    item("Prises électriques"),
  ],
  salle_eau: [
    item("Sol"), item("Murs / Carrelage"), item("Plafond"),
    item("Fenêtres"), item("Porte"),
    item("Lavabo"), item("Robinetterie lavabo"),
    item("Douche"), item("Robinetterie douche"), item("Joints / Silicone"),
    item("Éclairage"), item("Ventilation / VMC"), item("Chauffage"),
    item("Prises électriques"),
  ],
  wc: [
    item("Sol"), item("Murs"), item("Plafond"), item("Porte"),
    item("WC"), item("Chasse d'eau"), item("Abattant WC"),
    item("Ventilation"), item("Éclairage"),
  ],
  couloir: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Portes"), item("Éclairage"), item("Interrupteurs"),
    item("Prises électriques"), item("Chauffage"),
  ],
  dressing: [
    item("Sol"), item("Murs"), item("Plafond"), item("Porte"),
    item("Penderies / Tringles"), item("Étagères"), item("Éclairage"),
  ],
  bureau: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Fenêtres"), item("Volets / Stores"), item("Portes"),
    item("Prises électriques"), item("Interrupteurs"), item("Éclairage"),
    item("Chauffage"),
  ],
  buanderie: [
    item("Sol"), item("Murs"), item("Plafond"), item("Porte"),
    item("Lave-linge (emplacement)"), item("Sèche-linge (emplacement)"),
    item("Évier / Bac à laver"), item("Robinetterie"),
    item("Prises électriques"), item("Éclairage"), item("Ventilation"),
  ],
  cellier: [
    item("Sol"), item("Murs"), item("Plafond"), item("Porte"),
    item("Étagères / Rangements"), item("Éclairage"),
  ],
  custom: [],
};

export const DEFAULT_ANNEX_ITEMS: Partial<Record<AnnexType, RoomItem[]>> = {
  garage: [
    item("Sol"), item("Murs"), item("Plafond / Toiture"),
    item("Porte de garage"), item("Motorisation"), item("Éclairage"),
    item("Prises électriques"),
  ],
  parking: [
    item("Marquage au sol"), item("Barrière / Accès"), item("Éclairage"),
  ],
  cave: [
    item("Sol"), item("Murs"), item("Plafond"),
    item("Porte / Serrure"), item("Éclairage"), item("Humidité"),
  ],
  grenier: [
    item("Sol"), item("Murs"), item("Charpente / Toiture"),
    item("Fenêtre de toit / Velux"), item("Isolation"), item("Éclairage"),
  ],
  balcon: [
    item("Sol"), item("Garde-corps / Balustrade"), item("Joints / Étanchéité"),
    item("Porte-fenêtre"), item("Éclairage"),
  ],
  terrasse: [
    item("Sol / Revêtement"), item("Garde-corps"), item("Joints / Étanchéité"),
    item("Porte-fenêtre"), item("Éclairage extérieur"),
  ],
  jardin: [
    item("Pelouse / Végétation"), item("Portail / Clôture"),
    item("Arrosage"), item("Éclairage extérieur"),
  ],
};

// ─── Templates de pièces selon le type de logement ────────────────────────────

interface RoomTemplate {
  type:    RoomType;
  name:    string;
  isAnnex: false;
}

export const ROOM_TEMPLATES_BY_PROPERTY_TYPE: Record<PropertyType, RoomTemplate[]> = {
  studio: [
    { type: "entree",      name: "Entrée",         isAnnex: false },
    { type: "sejour",      name: "Pièce principale", isAnnex: false },
    { type: "cuisine",     name: "Cuisine",        isAnnex: false },
    { type: "salle_eau",   name: "Salle d'eau",    isAnnex: false },
    { type: "wc",          name: "WC",             isAnnex: false },
  ],
  room: [
    { type: "chambre",     name: "Chambre",        isAnnex: false },
    { type: "wc",          name: "WC partagé",     isAnnex: false },
  ],
  apartment: [
    { type: "entree",      name: "Entrée",         isAnnex: false },
    { type: "sejour",      name: "Séjour",         isAnnex: false },
    { type: "cuisine",     name: "Cuisine",        isAnnex: false },
    { type: "chambre",     name: "Chambre 1",      isAnnex: false },
    { type: "salle_bains", name: "Salle de bains", isAnnex: false },
    { type: "wc",          name: "WC",             isAnnex: false },
  ],
  house: [
    { type: "entree",      name: "Entrée",         isAnnex: false },
    { type: "sejour",      name: "Séjour / Salon", isAnnex: false },
    { type: "cuisine",     name: "Cuisine",        isAnnex: false },
    { type: "chambre",     name: "Chambre 1",      isAnnex: false },
    { type: "chambre",     name: "Chambre 2",      isAnnex: false },
    { type: "salle_bains", name: "Salle de bains", isAnnex: false },
    { type: "wc",          name: "WC",             isAnnex: false },
    { type: "couloir",     name: "Couloir",        isAnnex: false },
  ],
  other: [
    { type: "custom", name: "Pièce principale", isAnnex: false },
  ],
};

// ─── Compteurs par défaut ─────────────────────────────────────────────────────

export function createDefaultMeterReadings() {
  return [
    { id: randomUUID(), type: "electricity" as const, index: "", unit: "kWh", date: new Date().toISOString().slice(0, 10), number: "", comment: "" },
    { id: randomUUID(), type: "water_cold"  as const, index: "", unit: "m³",  date: new Date().toISOString().slice(0, 10), number: "", comment: "" },
  ];
}

// ─── Clés par défaut ──────────────────────────────────────────────────────────

export function createDefaultKeyItems() {
  return [
    { id: randomUUID(), type: "apartment" as const, quantity: 2, description: "", observation: "" },
    { id: randomUUID(), type: "mailbox"   as const, quantity: 1, description: "", observation: "" },
  ];
}
