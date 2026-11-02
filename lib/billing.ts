import { Platform } from "react-native";

/**
 * Paiement des abonnements : uniquement sur le site web (Stripe).
 * Google Play (et l'App Store) interdisent, dans l'application mobile, tout autre moyen de paiement
 * que le leur pour les abonnements à l'application : pas de prix, pas de bouton de paiement Stripe,
 * pas de lien vers le portail client ni vers le site pour payer.
 */
export const canPayInApp = Platform.OS === "web";

/** Message neutre affiché à la place du paiement dans l'application mobile (sans renvoi vers le site). */
export const NO_IN_APP_PAYMENT =
  "La souscription et la gestion de l'abonnement ne sont pas disponibles dans l'application mobile.";
