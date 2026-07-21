FROM node:22-bookworm-slim

# Toolchain pour compiler better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production PORT=3040 DATA_DIR=/app/data
EXPOSE 3040
VOLUME ["/app/data"]

# Seed le jeu de démo si la base est vide, puis démarre.
CMD ["sh", "-c", "node scripts/seed-if-empty.js && node src/server.js"]
