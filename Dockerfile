FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY server/ ./server/
COPY shared/ ./shared/
RUN npm run server:build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/server_dist ./server_dist
COPY server/templates/ ./server/templates/
COPY public/ ./public/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server_dist/index.js"]
