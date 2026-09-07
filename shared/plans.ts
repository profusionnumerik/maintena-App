/**
 * Plans d'abonnement Maintena — module Location
 * Référence unique pour les limites côté client et serveur.
 */

export type RentalPlan = "free" | "starter" | "pro" | "business";

export interface PlanLimits {
  properties: number;   // logements max (Infinity = illimité)
  tenants: number;      // locataires max au total
  storageBytes: number; // stockage max par fichier
  label: string;
  price: string;
  period: string;
}

export const PLAN_LIMITS: Record<RentalPlan, PlanLimits> = {
  free: {
    properties:   1,
    tenants:      1,
    storageBytes: 5 * 1024 * 1024,   // 5 Mo
    label:        "Gratuit",
    price:        "0 €",
    period:       "",
  },
  starter: {
    properties:   4,
    tenants:      4,
    storageBytes: 5 * 1024 * 1024,   // 5 Mo
    label:        "Starter",
    price:        "4,99 €",
    period:       "/mois",
  },
  pro: {
    properties:   15,
    tenants:      15,
    storageBytes: 20 * 1024 * 1024,  // 20 Mo
    label:        "Pro",
    price:        "14,99 €",
    period:       "/mois",
  },
  business: {
    properties:   Infinity,
    tenants:      100,               // 100 inclus, +1,50 €/locataire au-delà
    storageBytes: 20 * 1024 * 1024,  // 20 Mo
    label:        "Business",
    price:        "34,99 €",
    period:       "/mois",
  },
};

/** Résout le plan à partir du champ Firestore (undefined → "free") */
export function resolvePlan(raw: string | undefined | null): RentalPlan {
  if (raw === "starter" || raw === "pro" || raw === "business") return raw;
  return "free";
}
