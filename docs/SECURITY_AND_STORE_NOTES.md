# Notes sécurité et publication

## Points corrigés
- configuration Expo passée en `app.config.ts`
- build EAS ajouté avec profils `development`, `preview`, `production`
- variables de build store documentées
- fallback `EXPO_PUBLIC_API_BASE_URL` ajouté pour éviter les erreurs sur build natif
- `.env` retiré du livrable

## À valider côté production
- utiliser un vrai domaine API HTTPS
- mettre un reverse proxy / WAF si possible
- mettre des custom claims Firebase pour le rôle super-admin
- revoir la règle Firestore codée en dur sur l'email super-admin
- limiter Stripe, Resend et Firebase aux domaines / usages attendus
- vérifier qu'aucune donnée sensible n'apparaît dans les logs Express
