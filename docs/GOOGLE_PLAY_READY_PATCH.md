# Correctif complet prêt à publier

## Ce patch corrige
- démarrage Railway en mode production
- exposition publique des pages `/privacy-policy` et `/account-deletion`
- formulaire public de demande de suppression de compte
- suppression in-app via API sécurisée par token Firebase
- retrait des permissions Android les plus risquées pour Play
- remplacement du super-admin codé en dur par un custom claim Firebase
- endpoint `/healthz` pour vérifier le déploiement

## Déploiement Railway
- Build command: `npm run railway:build`
- Start command: `npm run railway:start`

## Variables à ajouter
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- `EXPO_PUBLIC_ACCOUNT_DELETION_URL`
- `FIREBASE_SERVICE_ACCOUNT`

## À exécuter avant soumission
```bash
npm install
npm run server:build
npm run typecheck
firebase deploy --only firestore:rules,storage
```

## Custom claim super-admin
Attribuer le claim `superAdmin: true` avec Firebase Admin au compte administrateur principal avant mise en production.
