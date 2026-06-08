# DogeSwap — production image (web app + API server)
FROM node:22-slim
WORKDIR /app

# git + CA certs: the build fetches the (gitignored) TradingView charting library.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates bash \
  && rm -rf /var/lib/apt/lists/*

# Install deps first (layer cache).
COPY package.json package-lock.json ./
RUN npm ci

# App source.
COPY . .

# Restore the vendored charting library into public/ (so the Vite build copies it into dist/),
# then build the web app.
RUN bash scripts/fetch-charting-library.sh \
  && npm run build:web

ENV HOST=0.0.0.0 \
    PORT=8080 \
    NODE_ENV=production
EXPOSE 8080

# Serve the built app + proxy the DogeOS API. Pass DOGEOS_CLIENT_ID / WALLETCONNECT_PROJECT_ID
# at `docker run -e ...` (read at runtime via /runtime-config.js — no rebuild needed).
CMD ["node", "packages/web/src/server.mjs"]
