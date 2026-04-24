FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY server/ ./server/
COPY shared/ ./shared/
RUN npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=server_dist

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/server_dist ./server_dist
COPY server/templates/ ./server/templates/
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server_dist/index.js"]
