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

# --- Translation models -------------------------------------------------------
# Separated for the same reason as the voices: ~71 MB of weights that must not be
# re-downloaded because application code changed. Every file is checked against
# the sha256 published alongside it, so a corrupt download fails the build.
FROM deps AS translation
WORKDIR /app
ARG TRANSLATION_PAIRS
ENV TRANSLATION_PAIRS=${TRANSLATION_PAIRS}
COPY translation.catalog.json ./
COPY scripts/fetch-translation-models.mjs ./scripts/
RUN node scripts/fetch-translation-models.mjs

# --- Build --------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
COPY --from=voices /app/public/tts/voices ./public/tts/voices
# Always present: with TRANSLATION_PAIRS="" the stage still writes an empty
# registry, so this copy succeeds and the app simply finds nothing to offer and
# falls back to the browser's own translator.
COPY --from=translation /app/public/mt ./public/mt
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
