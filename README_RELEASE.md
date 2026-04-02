# Maintena - package de publication

Ce package est préparé pour une publication Expo / EAS plus propre.

## Fichiers clés
- `app.config.ts` : configuration dynamique Expo
- `eas.json` : profils de build / submit
- `.env.example` : variables attendues
- `scripts/validate-env.mjs` : contrôle avant build
- `docs/STORE_RELEASE_CHECKLIST.md` : checklist finale

## Démarrage
```bash
npm install
cp .env.example .env
npm run check:env
npm run typecheck
npx expo start -c
```
