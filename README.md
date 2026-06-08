# DogeSwap

A non-custodial DEX **aggregator** for **DogeOS** (the Dogecoin zkEVM, Chikyū **testnet**, chain id `6281971`). React frontend + a Node aggregator/API that quotes and routes swaps across the verified DogeOS venues (MuchFi V2, MuchFi V3, Barkswap Algebra), plus an audited on-chain command/executor router in `packages/contracts/`.

> "DogeSwap" = this product. "DogeOS" = the underlying chain/platform.

## What runs
- **Web app** (`apps/web/`, built with Vite) — the DogeSwap UI: swap, tokens, activity, settings, TradingView chart, DogeOS-SDK wallet connect.
- **Aggregator + API** (`packages/{aggregator,api,config,dogeos-rpc}`) — live quotes/routing/fees against the DogeOS RPC, served by `packages/web/src/server.mjs` (static app + API proxy at `/quote`, `/swap`, `/approval`, `/tokens`, `/chain-status`, `/activity`, `/sources`, `/venues`, `/intelligence`, `/verification`).
- **Contracts** (`packages/contracts/`) — the audited Foundry router suite (separate deploy; see `packages/contracts/audit/DEPLOYMENT.md`). Not required to run the web app.

## Requirements
- **Node ≥ 22**, npm, and **git** (git is needed at build time to fetch the charting library).
- A public domain + reverse proxy (nginx/Caddy) recommended for TLS — and **required** to obtain the DogeOS SDK `clientId` (the form needs your live domain).

## Run on a server (clone → build → serve)
```sh
git clone <this-repo-url> dogeswap && cd dogeswap
npm ci                                   # install dependencies

# Restore the vendored TradingView Advanced Charts library (gitignored, ~26MB).
bash scripts/fetch-charting-library.sh   # clones it into apps/web/src/public/

cp .env.example .env                      # then edit .env (see below)

# Build the web app and start the server (binds HOST:PORT from .env)
npm run start:web
```
`npm run start:web` runs `vite build` then starts `packages/web/src/server.mjs`, which serves the built app from `apps/web/dist/` and proxies the API to the live DogeOS RPC. With `HOST=0.0.0.0 PORT=8080` it listens on all interfaces.

Put it behind your reverse proxy on the domain, e.g. nginx:
```nginx
server {
  server_name dex.example.com;
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
```
(Then add TLS with certbot/Caddy.)

## Configure (`.env`)
| Var | Purpose |
| --- | --- |
| `DOGEOS_CLIENT_ID` | DogeOS SDK Connect Kit client id — enables the in-app wallet modal + **mobile MyDoge via WalletConnect**. Read at **server runtime** (`/runtime-config.js`) — set it and **restart, no rebuild**. |
| `WALLETCONNECT_PROJECT_ID` | Optional — WalletConnect Cloud project id (mobile wallets). |
| `HOST` / `PORT` | Server bind address/port (default `0.0.0.0` / `8080` in `.env.example`). |

### Getting `DOGEOS_CLIENT_ID` (the MyDoge SDK flow)
1. Deploy this app to your server and point your **domain** at it (HTTPS).
2. Register the domain at **https://sdk.dogeos.com/register** to get a `clientId`.
3. Set `DOGEOS_CLIENT_ID=<your id>` in `.env` and **restart** the server (no rebuild — it's injected at runtime). The DogeOS Connect Kit (MyDoge / MetaMask / Rainbow / WalletConnect) then activates automatically.

> Until `DOGEOS_CLIENT_ID` is set, connect falls back to the **injected** path — desktop MyDoge (browser extension) still works; the in-app Connect Kit modal and mobile MyDoge do not.

## Docker (alternative)
```sh
docker build -t dogeswap .
docker run -d -p 8080:8080 \
  -e DOGEOS_CLIENT_ID=your_id \
  -e WALLETCONNECT_PROJECT_ID=your_wc_id \
  dogeswap
```
The image fetches the charting library and builds the app; the container serves on port 8080. Set `DOGEOS_CLIENT_ID` at `docker run` (runtime).

## Develop
```sh
npm run dev:web    # Vite dev server (127.0.0.1:8788) with the API proxy
npm test           # off-chain test suite (aggregator/api/web)
```

## Contracts (separate)
```sh
cd packages/contracts && forge test     # 53 tests; see audit/ for the security package + DEPLOYMENT.md
```

**Testnet only.** Not externally audited — do not put real funds behind it.
