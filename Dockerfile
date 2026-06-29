# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

# storefront/ and scripts/ are needed by the prebuild sync step
COPY . .
RUN npm run build

# ── Production stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/views ./views

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main"]
