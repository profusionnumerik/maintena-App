# Checklist finale App Store / Google Play

## 1) Identité et comptes
- Compte Apple Developer actif
- Compte Google Play Console actif
- Nom public de l'app vérifié
- Bundle ID iOS unique
- Package Android unique

## 2) Variables et secrets
- `.env` local rempli
- Secrets serveur déplacés dans EAS / hébergeur
- `FIREBASE_SERVICE_ACCOUNT` non commité
- `SESSION_SECRET` long et unique
- `EXPO_PUBLIC_API_BASE_URL` pointe vers l'API de production en HTTPS

## 3) Conformité Apple / Google
- Politique de confidentialité publiée sur une URL publique
- Processus de suppression de compte publié sur une URL publique
- Permissions justifiées dans la fiche store
- Captures d'écran iPhone et Android prêtes
- Icône 1024x1024 vérifiée
- Compte démo disponible pour la revue si nécessaire

## 4) Tests obligatoires
- Inscription / connexion
- Déconnexion / relance session
- Création d'une copropriété
- Invitation d'un membre
- Création d'une intervention
- Ajout photo
- Géolocalisation sur appareil réel
- Génération du lien invité prestataire
- Suppression du compte
- Vérification des erreurs hors-ligne

## 5) Build et soumission
```bash
npm install
cp .env.example .env
npm run check:env
npm run typecheck
npx expo login
npx eas login
eas build:configure
npm run build:store:all
npm run submit:store:all
```

## 6) À ne pas oublier
- Déployer `firestore.rules`
- Déployer `storage.rules`
- Restreindre les clés Firebase dans Google Cloud
- Vérifier Stripe en mode live
- Désactiver les logs verbeux en production
