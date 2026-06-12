# Backend API, Hardening & Ops — DogeSwap on DogeOS

**Audit date:** 2026-06-12
**Auditor role:** Senior DogeOS protocol engineer
**Scope:** Public HTTP API surface (`packages/api`, `packages/web/src/server.mjs`),
HTTP hardening (`httpHardening.mjs`), input validation on `/quote`/`/swap`/`/activity`,
secret handling (client IDs, VITE_ leakage), SSRF/abuse via outbound calls, error
disclosure, the Docker image, the live Apache reverse-proxy + systemd ops model, and
DoS resilience of the public quote endpoint.

All live probes were run against the production host (`https://dogeswap.ag`,
`127.0.0.1:8080`) and the DogeOS Chikyū testnet on 2026-06-12.

---

## Overall assessment

The backend is, for a testnet DEX aggregator, **unusually well-hardened and the ops
posture is sound.** The team has clearly already done one security pass: there is a
dedicated `httpHardening.mjs` with body-size caps, a per-client rate limiter, tightened
socket timeouts, baseline security headers, and a deliberate generic-500 policy that
logs detail server-side. Live probes confirm these are actually deployed:
`https://dogeswap.ag/sources` returns `x-content-type-options: nosniff`,
`x-frame-options: SAMEORIGIN`, `content-security-policy: frame-ancestors 'self'`, and
— critically — `access-control-allow-origin: https://dogeswap.ag` even when the request
carries `Origin: https://evil.example`, so the CORS lock is enforced as configured.

The architecture has **no arbitrary RPC proxy**, **no server-only secrets** (the only
client-exposed values are public-by-design DogeOS client ID / WalletConnect project
ID), the `/activity` Blockscout fan-out is gated by a strict 40-hex-char address regex
that closes SSRF/path-injection, `.env` is gitignored and never committed, and the
`deployer.key` is `chmod 600` in a non-git directory. The Docker image runs as the
non-root `node` user.

The findings below are therefore mostly **medium/low/info**: defense-in-depth gaps and
ops hygiene rather than exploitable holes. The two most material items are (1) the
public `/quote` endpoint's DoS exposure — every quote fans out into multiple upstream
RPC reads, and the only limiter is a coarse global fixed window — and (2) the live
governance reality (router `owner == guardian == a single deployer EOA`) which, while a
contracts-layer concern, is also an *ops* concern because the key lives on this box.
There is also stale documentation that, taken at face value, would cause an operator to
configure CSP wrong or mistrust an already-correct deployment.

---

## Strengths (genuinely well done)

- **CORS is correctly enforced, not theatre.** `handler.mjs:16-23` emits a *fixed*
  `access-control-allow-origin` from `CORS_ALLOW_ORIGIN` (no reflection of the request
  `Origin`, no wildcard suffix matching, no regex). Live: a request with
  `Origin: https://evil.example` to `https://dogeswap.ag/sources` still returns
  `access-control-allow-origin: https://dogeswap.ag` + `vary: origin`. A cross-origin
  page therefore cannot read responses. The accompanying comment honestly notes CORS is
  not the access control (the outputs are unsigned txs the user must sign), which is the
  right mental model.
- **No arbitrary RPC passthrough.** There is no `/rpc`, no `eth_call` proxy, no
  user-supplied-URL fetch. The only outbound hosts are the fixed DogeOS RPC and
  Blockscout base URLs from `config/src/chains.mjs`. This eliminates the single most
  common aggregator-backend SSRF/abuse vector.
- **`/activity` SSRF is closed at the door.** `handler.mjs:611-613` rejects any address
  failing `^0x[0-9a-fA-F]{40}$` (`isHexAddress`, line 59-61) *before* composing the
  Blockscout URL. Live probe with `address=...0000/../../foo` returns
  `invalid-activity-request`. `limit` is clamped to `[1,50]` (line 63-67, line 632).
- **No secret leaks to the client bundle.** The only values surfaced to the browser are
  `dogeosClientId` and `walletConnectProjectId` (`web/src/server.mjs:46-61`,
  `apps/web/src/sdkConfig.js:54-56`) — both public identifiers. Grep for
  `process.env.*` across `packages`/`apps` finds no private/secret server var consumed
  by client code. `runtime-config.js` live returns only those two (empty) fields and is
  `cache-control: no-store`.
- **`.env` discipline.** `.env` is gitignored (`.gitignore:8`), `git ls-files` shows
  only `.env.example` tracked, and `git log --all -- .env` is empty. The real `.env`
  contains only a testnet router address and the (currently-empty) client IDs — no
  private keys. The `deployer.key` is `-rw-------` and lives in `~/dogeswap-deploy`,
  which is **not** a git repo, so it cannot be accidentally committed.
- **Body cap + slowloris defenses are real and deployed.** `readIncomingBody` caps at
  64 KiB and rejects mid-stream with 413 (`httpHardening.mjs:22-46`); `applyServerTimeouts`
  sets `headersTimeout=15s` / `requestTimeout=30s` (line 119-123), tighter than Node's
  generous defaults. Both production servers wrap `createServer` with these.
- **Sanitized error disclosure.** 500s return generic `{"error":{...}}` and log detail
  server-side (`server.mjs:75-79`, `web/src/server.mjs:181-185`); upstream RPC/Blockscout
  failures map to a generic 503 (`handler.mjs:54-57`). Live `/quote` with bad input
  returns a structured `no-route` with provider error strings that are the aggregator's
  own validation messages — no host names, stack traces, or internal URLs leaked.
- **Rate-limit client key is correctly derived behind the proxy.** `clientKeyFromMessage`
  (line 52-64) trusts only the **last** `x-forwarded-for` entry when the socket is
  loopback. The live Apache vhost (`setup-apache.sh:26`) uses `mod_proxy_http` (enabled;
  `mod_remoteip` is not), which *appends* the real client IP as the last XFF entry — so
  a spoofed `X-Forwarded-For` from a client becomes `spoofed, <realIP>` and the limiter
  keys on `<realIP>`. The "last entry" choice is the right one for this topology.
- **Method/route validation.** Only `GET`/`POST` paths are matched; everything else
  falls through to 404. Live: `PUT /quote` → 404, `GET /admin` → 404.

---

## Findings

### BACKEND-1 — Public `/quote` is a cheap DoS lever; the only limiter is a coarse global fixed window
**Severity:** medium · **Confidence:** high
**Location:** `packages/api/src/httpHardening.mjs:68-89`; `packages/web/src/server.mjs:155-164`; `packages/api/src/handler.mjs:639-702`

**Evidence.** Each `POST /quote` fans out into multiple upstream RPC reads (V2 pools,
concentrated-liquidity quoter, one-hop, split planner; plus `getGasPriceWei`, the
L1GasPriceOracle data-finality fee). Live, a single bad-token quote reported
`candidateProviderMs: 513` and `quoteLatencyMs: 536` in its own telemetry — i.e. one
request holds ~0.5 s of upstream RPC work. The rate limiter is a single **fixed window**
shared across *all* clients' keys, default 300 requests / 10 s
(`DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300`, `DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000`):
- It is per-client-key, but **resets the whole map every window** (line 80-83), so a
  client gets a full fresh 300 immediately at each boundary → an attacker can do
  ~600 requests across a 20 ms boundary straddle, i.e. a 2× burst.
- 300 req / 10 s per IP, each costing ~0.5 s of RPC, is **30 concurrent upstream RPC
  reads/s per IP** — a handful of IPs can saturate the single upstream RPC and degrade
  quotes for everyone (the RPC, not the Node process, is the bottleneck).
- There is no separate, tighter budget for the expensive `POST /quote`/`/swap` versus
  the cheap `GET /sources`/`/tokens` — they share one counter.

**Impact.** A low-effort, unauthenticated request flood (or even organic load spikes)
can exhaust the upstream DogeOS RPC budget and make quoting fail-soft to `no-route` for
all users. This is degradation, not fund loss — but it is the most realistic abuse of a
public aggregator backend.

**Recommendation.** (1) Give `/quote` and `/swap` a distinct, lower budget than the
read-only GETs. (2) Replace the global fixed window with a per-key sliding window or
token bucket to kill the boundary 2× burst. (3) Add a small in-process LRU cache of
recent quote responses keyed by the existing `quoteCandidateRequestKey` (the in-flight
de-dup at `handler.mjs:475-505` already collapses concurrent identical requests, but not
sequential ones) with a 1–2 s TTL — this both cuts RPC load and smooths bursts. (4)
Consider Apache-level `mod_ratelimit`/`mod_qos` or fail2ban as a second layer, since the
app limiter sees post-proxy traffic only.

---

### BACKEND-2 — `/quote` does not validate token-address shape before dispatching to providers
**Severity:** low · **Confidence:** high
**Location:** `packages/api/src/handler.mjs:197-228` (`parseQuoteRequest`)

**Evidence.** `parseQuoteRequest` validates `chainId`, `quoteMode`, amounts (positive
BigInt), and slippage, but `sellToken`/`buyToken` are taken as
`String(body.sellToken ?? "")` with **no `isHexAddress` check** — even though
`isHexAddress` already exists in the same file (line 59-61) and *is* used for `/activity`.
Live: `POST /quote` with `sellToken: "0xdeadbeef"` returns HTTP 200 `no-route` whose
telemetry contains three deep provider errors (`muchfi-v2`, `muchfi-v3`,
`barkswap-algebra`: *"sellToken must be a 20-byte hex address."*). The malformed input
propagated all the way into every venue provider before being rejected.

**Impact.** Low. It fails closed (no route, no tx), and the deep validation in the
providers prevents bad addresses reaching calldata. But it is wasted upstream work per
bad request (amplifies BACKEND-1), and the leaked per-venue error strings are mild
internal-shape disclosure. It is a defense-in-depth gap: the cheapest, earliest possible
rejection is skipped at the trust boundary.

**Recommendation.** In `parseQuoteRequest`, reject non-`isHexAddress` `sellToken`/
`buyToken` (and `sellToken === buyToken`) with a 400 *before* any provider dispatch,
matching the existing `/activity` pattern. This short-circuits the RPC fan-out for
garbage input.

---

### BACKEND-3 — Live router governance is a single EOA whose key sits on the web host (ops blast radius)
**Severity:** medium · **Confidence:** high
**Location:** Live reads of `DOGESWAP_ROUTER_ADDRESS=0xa3158549f38400F355aDf20C92DA1769620Aa35A`; `~/dogeswap-deploy/deployer.key`; `dogeswap-deploy/README-DEPLOY.md:100-105`

**Evidence (live + ops).** On-chain the router's `owner()` and `guardian()` are the
**same EOA** `0xE659A8d3745b1355CA47B3d92925997Ef93a2873` (ground-truth live reads;
the timelock/Safe handover described in `DEPLOYMENT.md` has **not** happened). The
deploy README confirms `ROUTER_SAFE` and `ROUTER_GUARDIAN` are "currently the deployer
EOA … key at `~/dogeswap-deploy/deployer.key`." That key file is present on the same
host that runs the internet-facing web/API service. The router has `pause()` and caps
(`defaultMaxInputPerTx`), and is `feeBps()=0` today but fee-switch-ready.

**Impact.** From an *ops* standpoint: a single key, stored on the public-facing box,
holds both ownership and the guardian/pause power of the contract that every router-mode
swap routes through (router mode default is `all`). Host compromise → key exfiltration →
attacker controls pause, caps, and the fee switch (and any owner-only functions). This is
testnet with no real funds today, but it is the dominant ops risk and a hard blocker for
mainnet. The single-EOA owner==guardian also defeats the guardian/owner separation the
design assumes.

**Recommendation.** Before mainnet: (1) move the key off the web host entirely (a signer
service / hardware wallet / separate ops box); (2) complete the TimelockController
`acceptOwnership()` handover so `owner` is a timelock, not an EOA; (3) make `guardian`
a distinct address (a Safe) from `owner`; (4) confirm `DEPLOYMENT.md`/`KNOWN_ISSUES.md`
reflect the *actual* live owner/guardian, not the intended end-state.

---

### BACKEND-4 — Production deployment runs without a hardened CSP; default policy does not restrict script/connect/frame sources
**Severity:** medium · **Confidence:** high
**Location:** `packages/api/src/httpHardening.mjs:98-106`; live header; `.env:38` (commented-out full policy)

**Evidence.** `securityHeaders()` emits `content-security-policy: <CONTENT_SECURITY_POLICY
|| "frame-ancestors 'self'">`. Live `https://dogeswap.ag` returns exactly
`content-security-policy: frame-ancestors 'self'` — i.e. the hardened policy is **not**
set in prod. The default only constrains framing (clickjacking); it does **not** set
`default-src`, `script-src`, `connect-src`, or `img-src`. The full hardened policy
exists, fully written, but only as a **commented-out** line in `.env:38`. The README
(`README-DEPLOY.md:52-61`) explicitly leaves it unset so the MyDoge embedded wallet
(`https://dogeos.embedded-wallet.tomo.inc`, `mydoge-wallet.tomo.inc`,
`social-relay.tomo.inc` — confirmed: the SDK is built on `@tomo-inc/*` adaptors) "works
out of the box."

**Impact.** Without `script-src`/`connect-src` restrictions, any XSS or a compromised
third-party dependency in the bundle can exfiltrate to arbitrary origins or inject
script — there is no CSP backstop. For a wallet-connected swap UI this is the highest-
value secondary defense and it is currently off. (The framing protection *is* present,
so clickjacking is covered.)

**Recommendation.** Enable the prepared full CSP in prod (it already allowlists the
required `tomo.inc` frame/connect origins, RPC, Blockscout, and fonts). The note in
`.env` that the policy uses `'unsafe-inline' 'unsafe-eval'` for `script-src` is a known
weakening — track removing `unsafe-eval` (and moving toward nonce/hash-based inline)
as a follow-up, but shipping the restrictive `connect-src`/`frame-src`/`default-src`
now is a strict improvement over the framing-only default. Test in staging first
(`README` correctly warns a wrong CSP silently breaks wallet/chart/fonts).

---

### BACKEND-5 — Stale security docs would misconfigure or mislead an operator
**Severity:** low · **Confidence:** high
**Location:** `packages/contracts/audit/DEPLOYMENT.md` & `KNOWN_ISSUES.md` (Permit2 "ABSENT"); `packages/config/src/chains.mjs:4,5,11`

**Evidence.** (1) `DEPLOYMENT.md`/`KNOWN_ISSUES.md` state Permit2 is "ABSENT" on DogeOS
testnet, but Permit2 **is** deployed at the canonical
`0x000000000022D473030F116dDEE9F6B43aC78BA3` (ground-truth `getCode` returns bytecode),
and the live router's single-approval flow depends on it. (2) `chains.mjs:11` declares
`wsRpcUrls: ["wss://ws.rpc.testnet.dogeos.com"]`, which is dead (HTTPS GET → 404) and is
**not documented by DogeOS**; grep confirms `wsRpcUrls` is referenced **nowhere** in
runtime code (all RPC is HTTP via `createJsonRpcClient`), so it is config noise that a
future integrator could wire up and have silently fail. (3) `chains.mjs:4-5` names the
chain "DogeOS Chikyu Testnet" / native "DogeOS DOGE" vs official docs "DogeOS Chikyū
Testnet" / "DOGE".

**Impact.** Low (no runtime failure today). But stale Permit2-ABSENT docs could lead an
operator to mistrust a working approval flow or rebuild it; the phantom WS endpoint
invites a future ops mistake; the naming drift is cosmetic but undermines trust in the
docs.

**Recommendation.** Correct `DEPLOYMENT.md`/`KNOWN_ISSUES.md` to record Permit2 as
present at the canonical address. Remove `wsRpcUrls` from `chains.mjs` (or mark it
unsupported) until DogeOS actually offers a WS endpoint. Align chain/native names with
the official docs.

---

### BACKEND-6 — `.env.example` ships `HOST=0.0.0.0`, encouraging a directly-exposed origin server
**Severity:** low · **Confidence:** high
**Location:** `.env.example:17`; `Dockerfile:22`; vs live `.env:17` (`HOST=127.0.0.1`)

**Evidence.** `.env.example:17` and the `Dockerfile` (`ENV HOST=0.0.0.0`) default the
server to bind all interfaces. The *actual* prod `.env` correctly overrides this to
`HOST=127.0.0.1` (so only Apache, the TLS-terminating reverse proxy, can reach it), and
the README documents the 127.0.0.1 binding. But an operator copying `.env.example`
verbatim — or running the Docker image with its baked `0.0.0.0` and exposed `:8080` —
gets the Node server reachable directly on the public interface, bypassing Apache's TLS,
the HTTP→HTTPS redirect, and any proxy-layer controls.

**Impact.** Low on this host (firewall + actual `.env` mitigate it), but the *defaults*
point operators toward an unencrypted, proxy-bypassing public binding. The app limiter
also derives client identity assuming a loopback socket + trusted last-XFF (BACKEND
strengths); a direct `0.0.0.0` binding breaks that assumption — `x-forwarded-for` is
then fully client-controlled and rate-limit keys become spoofable.

**Recommendation.** Default `.env.example` and the Dockerfile `HOST` to `127.0.0.1` and
document `0.0.0.0` only for the behind-a-proxy container case. Note in the limiter that
direct exposure (non-loopback socket) makes XFF untrusted — which the code already
handles by falling back to the socket address, but the *default config* should not put
it in the spoofable state.

---

### BACKEND-7 — Vite dev middleware leaks raw error messages and omits body cap (dev-only)
**Severity:** info · **Confidence:** high
**Location:** `vite.config.mjs:45-52, 99-109`

**Evidence.** The dev `dogeosApiPlugin` has its **own** `readIncomingBody` with **no
size cap** (line 45-52, unlike the hardened version) and returns
`{"error":{"code":"vite-api-error","message": error.message}}` — the raw error string —
on 500 (line 99-109). It also emits none of the `securityHeaders()`.

**Impact.** None in production: `vite.config.mjs` is the dev server (`npm run dev`); prod
serves via `packages/web/src/server.mjs`, which uses the hardened path. Flagged only so
nobody is tempted to expose the Vite dev server publicly.

**Recommendation.** No prod action. If the dev server is ever exposed (demos), front it
with the same hardening or don't expose it. Optionally reuse the shared
`readIncomingBody`/`securityHeaders` in the Vite plugin for consistency.

---

### BACKEND-8 — Static file serving is path-traversal-safe; one minor hardening note
**Severity:** info · **Confidence:** high
**Location:** `packages/web/src/server.mjs:102-137`

**Evidence.** `staticFilePath` decodes, normalizes, strips leading `../`, resolves
against the static root, and rejects any path not under `${root}${sep}` (line 109-111).
This correctly blocks `..%2f` traversal (live: traversal attempts on `/activity` and the
static path return 404/validation errors). Files are served `cache-control: no-store`
with a fixed content-type map. This is a positive — recorded as info because the
defense is good and worth not regressing.

**Impact.** None — it works.

**Recommendation.** Keep it. The only nit: `no-store` on all static assets (including
hashed JS/CSS) forgoes caching; consider long-lived immutable caching for fingerprinted
assets and `no-store` only for `index.html`/`runtime-config.js`. Performance, not
security.

---

## Summary table

| ID | Title | Severity | Confidence |
|----|-------|----------|------------|
| BACKEND-1 | Public `/quote` DoS lever; coarse global fixed-window limiter | medium | high |
| BACKEND-2 | `/quote` skips token-address validation before provider fan-out | low | high |
| BACKEND-3 | Router owner==guardian==single EOA; key on the web host | medium | high |
| BACKEND-4 | Prod runs framing-only CSP; hardened policy left commented-out | medium | high |
| BACKEND-5 | Stale docs (Permit2 "ABSENT"); dead `wsRpcUrls`; name drift | low | high |
| BACKEND-6 | `.env.example`/Dockerfile default `HOST=0.0.0.0` | low | high |
| BACKEND-7 | Vite dev middleware leaks raw errors / no body cap (dev-only) | info | high |
| BACKEND-8 | Static serving path-traversal-safe (positive) | info | high |
