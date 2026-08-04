# syntax=docker/dockerfile:1

# Node 24 "Krypton" — the active LTS line.
ARG NODE_VERSION=24-alpine
ARG NGINX_VERSION=1.29-alpine

# --- Dependencies -------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` needs a lockfile; fall back to `install` on a first, unlocked build.
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- Voice models -------------------------------------------------------------
# Separated so changing application code never re-downloads ~130 MB of weights.
# This is the only step that uses the network, and it moves model files only.
FROM deps AS voices
WORKDIR /app
ARG PIPER_VOICES
ENV PIPER_VOICES=${PIPER_VOICES}
COPY voices.catalog.json ./
# Only the files this step reads, so editing an unrelated script does not
# invalidate the layer and re-download the models.
COPY scripts/fetch-voices.mjs ./scripts/
RUN node scripts/fetch-voices.mjs

# --- Build --------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
COPY --from=voices /app/public/tts/voices ./public/tts/voices
RUN npm run build

# --- Test ---------------------------------------------------------------------
# Built on demand: `docker compose run --rm test`.
FROM build AS test
CMD ["npm", "run", "test"]

# --- Runtime ------------------------------------------------------------------
FROM nginx:${NGINX_VERSION} AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
