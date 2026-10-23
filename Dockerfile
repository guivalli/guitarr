# syntax=docker/dockerfile:1
# Guitarr: upstream Navidrome + the patches in ./patches, with yt-dlp and ffmpeg.
# Build: docker compose build   (or: docker build -t guitarr .)

ARG NAVIDROME_REPO=https://github.com/navidrome/navidrome.git
ARG NAVIDROME_COMMIT=497dfe25866d32e2229bcd962c38bda0e753c875

########################################################################################################################
### Source: upstream at a fixed commit + Guitarr patches
FROM alpine/git:latest AS src
ARG NAVIDROME_REPO
ARG NAVIDROME_COMMIT
WORKDIR /src
RUN git init -q . &&     git remote add origin "${NAVIDROME_REPO}" &&     git fetch -q --depth 1 origin "${NAVIDROME_COMMIT}" &&     git checkout -q FETCH_HEAD
COPY patches/ /patches/
RUN git apply /patches/*.patch

########################################################################################################################
### Web UI
FROM node:22-alpine AS ui
WORKDIR /app
COPY --from=src /src/ui/package.json /src/ui/package-lock.json ./
COPY --from=src /src/ui/bin/ ./bin/
RUN npm ci --no-audit --no-fund
COPY --from=src /src/ui/ ./
COPY brand/root/android-chrome-192x192.png /app/src/icons/android-icon-192x192.png
COPY guitarr.html /app/public/guitarr.html
COPY apps/mobile/ /app/public/mobile/
RUN npm run build -- --outDir=/build
# 1. Definir o visual do guitarr.html como a interface principal index.html:
RUN cp /app/public/guitarr.html /build/index.html
# 2. Incluir o port mobile em /build/mobile/ e /build/mobile.html:
RUN cp -r /app/public/mobile/ /build/mobile/ && cp /app/public/mobile/index.html /build/mobile.html
# 3. Marca Guitarr: favicon/ícones PWA substituem os do Navidrome e os logos ficam em /app/brand/:
COPY brand/root/ /build/
COPY brand/logos/ /build/brand/
# 4. Limpar o Service Worker do PWA antigo para não ficar preso no cache do navegador:
RUN echo "self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())); });" > /build/sw.js

########################################################################################################################
### Server binary (cgo for SQLite; the Debian Go image already ships gcc)
FROM golang:1.27-trixie AS build
WORKDIR /workspace
COPY --from=src /src/go.mod /src/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY --from=src /src/ ./
COPY --from=ui /build ./ui/build
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache     CGO_ENABLED=1 go build -tags="$(./release/build-tags.sh)"       -ldflags="-w -s -X github.com/navidrome/navidrome/consts.gitTag=seer"       -o /out/navidrome .

########################################################################################################################
### Final image: Python (for yt-dlp) + static ffmpeg + navidrome
FROM python:3.13-slim-trixie
LABEL org.opencontainers.image.title="guitarr"
LABEL org.opencontainers.image.source="https://github.com/navidrome/navidrome"

COPY --from=mwader/static-ffmpeg:7.1 /ffmpeg /ffprobe /usr/local/bin/
# Rebuild the image to update yt-dlp (YouTube changes often): docker compose build --no-cache navidrome
ARG YTDLP_VERSION=
# deno runs YouTube's JavaScript challenges for yt-dlp; mutagen lets it embed tags and covers.
RUN pip install --no-cache-dir "yt-dlp${YTDLP_VERSION:+==$YTDLP_VERSION}" deno mutagen && yt-dlp --version && deno --version | head -1 && ffmpeg -version | head -1

COPY --from=build /out/navidrome /app/

VOLUME ["/data", "/music"]
ENV ND_MUSICFOLDER=/music     ND_DATAFOLDER=/data     ND_CONFIGFILE=/data/navidrome.toml     ND_PORT=4533     ND_SEER_YOUTUBE_PATH=/usr/local/bin/yt-dlp     XDG_CACHE_HOME=/data/cache
RUN touch /.nddockerenv

EXPOSE 4533
WORKDIR /app
ENV PATH="/app:${PATH}"
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s   CMD python3 -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://localhost:4533/ping', timeout=4).status != 200)"
ENTRYPOINT ["/app/navidrome"]
