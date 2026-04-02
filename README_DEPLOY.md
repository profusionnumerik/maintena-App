# Maintena — package prêt au déploiement

## Ce qui a été corrigé
- typage TypeScript corrigé (`npx tsc --noEmit` passe)
- génération de lien web invité pour un prestataire externe
- page web publique de compte-rendu d'intervention sans installation de l'app
- upload des photos via l'API serveur vers Firebase Storage
- règles Firestore / Storage resserrées
- en-têtes de sécurité HTTP et CORS `Authorization`
- `.env.example` ajouté
- fichiers de test / copies retirés du package de livraison

## Variables d'environnement
Copiez `.env.example` vers `.env` puis renseignez toutes les valeurs.

## Déploiement recommandé
### Frontend mobile / web
- Expo / EAS Build pour iOS et Android
- Expo web statique si vous gardez l'interface web

### Backend
- Node 20+
- Déployer `server/index.ts` compilé sur Render, Railway, Fly.io ou un VPS
- Domaine conseillé : `app.maintena.fr`

## Commandes
```bash
npm install
npx tsc --noEmit
npx expo start
```

Pour le backend, utilisez un build Node standard. Si `esbuild` n'est pas exécutable dans votre environnement, réinstallez les dépendances puis lancez :
```bash
npm rebuild esbuild
npm run server:build
npm run server:prod
```

## Flux prestataire invité
1. Le syndic crée une intervention avec un prestataire externe.
2. L'app appelle `POST /api/guest-invites`.
3. Le backend renvoie un lien du type :
   `https://app.maintena.fr/guest-intervention/<token>`
4. Le prestataire ouvre le lien web et dépose son compte-rendu.
5. Le backend met à jour l'intervention dans Firestore.

## Avant mise en production
- révoquer les anciens secrets qui étaient dans l'archive initiale
- déployer `firestore.rules` et `storage.rules`
- configurer Stripe, Firebase Admin et Resend
- tester iOS, Android et web sur un vrai projet Firebase
