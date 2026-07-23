# syntax=docker/dockerfile:1

# ── Build stage: install ALL deps (incl. tsup/esbuild) and compile to dist/ ──
FROM node:22-alpine AS builder
WORKDIR /app

# HUSKY=0 skips the `prepare` (husky) lifecycle script — there is no .git here.
ENV HUSKY=0

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage: production deps only + the compiled dist/ ──
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Fly injects PORT via fly.toml [env]; keep a sane default for local `docker run`.
ENV PORT=8080

# --ignore-scripts: none of the production deps need a postinstall build, and it
# also avoids the husky `prepare` script (husky is a devDependency, absent here).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/server.js"]
