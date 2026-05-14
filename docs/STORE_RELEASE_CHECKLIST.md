# Checklist finale — Publication Google Play

## 1) Compte et identité

- [ ] Compte Google Play Developer actif (frais uniques 25 $)
- [ ] Package Android unique : `com.profusionnumerik.maintena`
- [ ] Nom public : **Maintena**
- [ ] APK / AAB signé avec la clé de production EAS

## 2) Variables et secrets Cloud Run

- [ ] `STRIPE_SECRET_KEY=sk_live_...` (mode live)
- [ ] `STRIPE_PRICE_ID_MENSUEL=price_live_...` (19,99 €/mois)
- [ ] `STRIPE_PRICE_ID_ANNUEL=price_live_...` (169 €/an)
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_live_...`
- [ ] `FIREBASE_SERVICE_ACCOUNT` renseigné et non commité
- [ ] `RESEND_API_KEY` configuré
- [ ] `EXPO_PUBLIC_API_BASE_URL` pointe vers `https://maintena-pro.fr`

## 3) Informations Google Play Console

- [ ] Description courte (80 car. max)
- [ ] Description longue (4 000 car. max)
- [ ] Captures d'écran Android (min. 2 — ratio 9:16)
- [ ] Icône haute résolution 512×512 px
- [ ] Catégorie : Entreprises / Productivité
- [ ] Classification du contenu : Tout public

## 4) Pages légales (URLs à renseigner dans Play Console)

- [x] Politique de confidentialité : `https://maintena-pro.fr/privacy-policy`
- [x] Suppression de données : `https://maintena-pro.fr/account-deletion`

## 5) Section "Sécurité des données" dans Play Console

- [ ] Données collectées : email, nom, téléphone, photos, localisation (optionnelle)
- [ ] Données partagées avec des tiers : Stripe (paiement), Google Firebase (infrastructure)
- [ ] Chiffrement en transit : Oui (HTTPS/TLS)
- [ ] Suppression de données possible : Oui
- [ ] Autorisation localisation justifiée (vérification présence sur site)
- [ ] Autorisation caméra/stockage justifiée (photos d'intervention)

## 6) Stripe — Passage en mode production

- [ ] Créer les produits et prix dans Stripe Dashboard (mode live)
- [ ] Configurer le webhook Stripe live pointant vers `https://maintena-pro.fr/api/stripe-webhook`
- [ ] Tester un paiement réel end-to-end en mode live avant publication

## 7) Tests obligatoires

- [ ] Inscription / connexion / déconnexion
- [ ] Création d'une copropriété
- [ ] Invitation d'un membre ou prestataire
- [ ] Création d'une intervention avec photo
- [ ] Envoi du lien invité prestataire par email
- [ ] Formulaire web de compte-rendu (avec photo)
- [ ] Géolocalisation sur appareil Android réel
- [ ] Flux de paiement Stripe live
- [ ] Suppression du compte
- [ ] Comportement hors-ligne

## 8) Build et soumission

```bash
npm run typecheck
npx expo-doctor

# Build AAB pour Google Play
eas build --platform android --profile production

# Soumettre
eas submit --platform android
```

## 9) Infrastructure

- [ ] Déployer `firestore.rules` en production
- [ ] Déployer `storage.rules` en production
- [ ] Restreindre les clés Firebase dans Google Cloud Console
- [ ] Vérifier les logs Cloud Run après publication
