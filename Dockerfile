FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run server:build

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "server_dist/index.js"]
