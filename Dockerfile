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

COPY scripts/ ./scripts/
# Copie le static-build engagé comme filet de sécurité si l'export Expo échoue
COPY static-build/ ./static-build/
# Tente de rebuilder (écrase si réussi)
RUN npx expo export --platform web --output-dir static-build 2>&1 || echo "Expo export failed — using committed static-build as fallback"
RUN node scripts/patch-web-index.js

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
