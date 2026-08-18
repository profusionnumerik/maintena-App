FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build server
COPY server/ ./server/
COPY shared/ ./shared/
RUN npm run server:build

# Build Expo web app
COPY app/ ./app/
COPY assets/ ./assets/
COPY components/ ./components/
COPY constants/ ./constants/
COPY context/ ./context/
COPY lib/ ./lib/
COPY app.config.ts ./
COPY tsconfig.json ./
COPY metro.config.cjs ./
COPY babel.config.cjs ./

ENV EXPO_PUBLIC_API_BASE_URL=https://maintena-pro.fr
ENV EXPO_PUBLIC_APP_NAME=Maintena
ENV EXPO_PUBLIC_APP_SLUG=maintena
ENV EXPO_PUBLIC_APP_SCHEME=maintena
ENV EXPO_PUBLIC_IOS_BUNDLE_ID=com.profusionnumerik.maintena
ENV EXPO_PUBLIC_ANDROID_PACKAGE=com.profusionnumerik.maintena
ENV EXPO_PUBLIC_EAS_PROJECT_ID=f942f5d6-18ac-41c4-89a0-4d9b2fe98138
ENV EXPO_PUBLIC_FIREBASE_API_KEY=AIzaSyAhdH1T_FP2NKdBE47kSjWJKifA6Yix_AA
ENV EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=maintena-3a544.firebaseapp.com
ENV EXPO_PUBLIC_FIREBASE_PROJECT_ID=maintena-3a544
ENV EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=maintena-3a544.firebasestorage.app
ENV EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=478264688227
ENV EXPO_PUBLIC_FIREBASE_APP_ID=1:478264688227:web:9d9ec9988e3fa6722dc256
ENV EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=G-BPMPDM3CSS
ENV EXPO_PUBLIC_SUPER_ADMIN_EMAIL=bijourobert1@gmail.com
ENV EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_51SvmY4Rtzr6Km0bbBeBGsRm74QrYbuXwD0SJnaBLJNGiszEqCpEVQIR74J5aI4vCVTqSY5XctmNESM6VVl9ROcL100UIxNLUp2

RUN npx expo export --platform web --output-dir static-build 2>&1 || true

# Patch l'index.html généré : lang=fr, titre + méta SEO (module locatif)
RUN node -e " \
  const fs = require('fs'); \
  const p = 'static-build/index.html'; \
  if (!fs.existsSync(p)) { console.log('index.html absent, skip'); process.exit(0); } \
  let h = fs.readFileSync(p, 'utf8'); \
  h = h.replace('<html lang=\"en\">', '<html lang=\"fr\">'); \
  h = h.replace('<title>Maintena</title>', '<title>Maintena — Copropriétés &amp; Gestion locative</title>'); \
  const metas = [ \
    '<meta name=\"description\" content=\"Maintena gère vos copropriétés ET votre parc locatif : suivi des interventions, états des lieux, quittances de loyer, signalements locataires. Essai gratuit 30 jours.\" />', \
    '<meta property=\"og:title\" content=\"Maintena — Copropriétés &amp; Gestion locative\" />', \
    '<meta property=\"og:description\" content=\"Gérez vos copropriétés et vos locations en un seul endroit. Interventions, états des lieux, quittances, signalements locataires.\" />', \
    '<meta property=\"og:type\" content=\"website\" />', \
    '<meta property=\"og:url\" content=\"https://maintena-pro.fr\" />', \
    '<meta name=\"twitter:card\" content=\"summary\" />', \
  ].join('\n  '); \
  h = h.replace('<link rel=\"icon\"', metas + '\n  <link rel=\"icon\"'); \
  fs.writeFileSync(p, h); \
  console.log('index.html patched OK'); \
"

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/server_dist ./server_dist
COPY server/templates/ ./server/templates/
COPY public/ ./public/
COPY --from=builder /app/static-build ./static-build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server_dist/index.js"]
