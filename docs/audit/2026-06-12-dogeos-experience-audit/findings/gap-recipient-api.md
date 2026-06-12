# Gap: Output-recipient integrity on the API

**Area:** API output-recipient integrity (`/quote`, `/approval`, `/swap`)
**Date:** 2026-06-12
**Severity:** High (Medium for the self-hosted first-party UI; High for hosted/embedded/third-party integrations)
**Status:** Confirmed via code reads + live chain reads.

## Question

Is the settlement recipient (inside the quote) ever cross-checked against the
swap sender? Can a caller obtain a swap tx whose `recipient != sender`? Given
the contract's `recipient == address(0)` silent no-op, what is the
recipient-integrity risk for hosted/embedded integrations, and should the API
reject `quote.recipient != sender`?

## Answer (short)

No cross-check exists anywhere on the API. The settlement recipient is fully
client-supplied and is copied verbatim into the on-chain swap/settlement
calldata. A caller can trivially obtain a signed-but-unsent swap tx whose
`recipient` is any third party (or `address(0)`). Recommendation: the API
**should** bind/validate the recipient — reject (or overwrite) `quote.recipient`
when it differs from `sender` — for every execution path.

## Evidence

### 1. The recipient is client-supplied; the server never sets or validates it

- The `/quote` response carries **no recipient at all**. `buildQuoteResponse`
  (`packages/aggregator/src/quoteService.mjs:149`) returns route/pricing only.
- The recipient is injected client-side. Production frontend
  `apps/web/src/lib/execute.js:298-309` (`bindExecutionQuote`) sets
  `recipient: sender` — but this is a courtesy default chosen by the honest UI,
  not an invariant. The value is sent in the request body to `/approval` and
  `/swap` (`apps/web/src/lib/api.js:83,87`).

### 2. `/swap` accepts whatever recipient the body contains and never compares it to `sender`

`packages/api/src/handler.mjs:763-812`:
- L766 `const originalQuote = normalizeSwapQuote(body.quote ?? {})` — recipient
  comes straight from the client body.
- L767 `const sender = String(body.sender ?? originalQuote.sender ?? "")` — a
  separate, independent field.
- `normalizeSwapQuote` (L230-266) validates amounts/slippage but **never touches
  `recipient`** — it is passed through via `...quote`.
- `preSwapVerifier` is `verifyChain` only (`live.mjs:289`) — it checks chain ID,
  not recipient.
- The only place `sender` is used is `from: sender` on the returned tx
  (L786-787) and the gas/balance simulation (L793-795). It is **never** compared
  to `quote.recipient`.

Grep confirms the absence of any check across the whole API/aggregator source:
```
grep -rnE "recipient.*sender|recipient !== |recipient === " packages/api/src packages/aggregator/src   ->  (no matches)
```

### 3. The refresh path explicitly preserves the client's recipient

`quoteWithSwapExecutionFields` (`handler.mjs:299-309`) re-attaches
`recipient: originalQuote.recipient` after the pre-build re-quote. So even with
`refreshSwapQuoteBeforeBuild` on, the client-chosen recipient survives untouched
into the freshly built calldata.

### 4. The recipient is written verbatim into on-chain calldata (both execution modes)

- DogeSwapRouter split path: `dogeSwapRouterCalldata.mjs:288`
  `recipient: normalizeAddress(quote.recipient, "recipient")` →
  encoded into the `Settlement` tuple at `:191`.
- Direct venue path: every builder in `venueCalldataBuilders.mjs` (lines
  98,106,113,120,127,134) encodes `quote.recipient` as the swap recipient
  (MuchFi V2/V3, Barkswap Algebra, exact-in and exact-out).
- `buildSwapTx.mjs:60` only asserts the recipient is a valid 20-byte hex
  address — no equality check to sender. `routeBindingFor` (L21-42) echoes the
  recipient back but does not constrain it.

So `recipient` is attacker-controlled end-to-end: request body → quote →
calldata → on-chain settlement destination.

### 5. Contract behavior makes a wrong recipient unrecoverable for users

`packages/contracts/src/DogeSwapRouter.sol`:
- `_settle` pays the bought tokens to the caller-declared recipient:
  L295 `_pay(s.buyToken, s.recipient, out)`.
- `recipient == address(0)` silently **disables settlement**:
  L288 `if (s.recipient == address(0)) return;` — the swapped output stays in the
  router with no event-driven payout. Output is then recoverable **only** by the
  owner via `rescue(...)` which is `onlyOwner` (L144).
- Live ownership is a plain EOA, not the documented TimelockController+Safe:
  `owner() = guardian() = 0xE659A8d3745b1355CA47B3d92925997Ef93a2873`, and
  `cast code` on that address returns `0x` (empty bytecode → EOA). Confirmed live
  on Chikyū testnet (chainId 6281971, rpc.testnet.dogeos.com). So the
  "rescue" backstop for `address(0)` strandings is a single hot key, not a
  governance process.

## Threat model / impact

The DEX itself does not custody funds, and the user signs the final tx in their
own wallet — so for the **honest first-party self-hosted UI** the practical risk
is low (the UI always sets `recipient = sender`). The exposure is in everything
that sits between the API and the signer:

- **Hosted / embedded / third-party integrations** (the CORS note at
  `handler.mjs:12-16` explicitly anticipates third-party pages scripting the
  builders): a malicious or compromised front-end / proxy can request a swap tx
  with `recipient = attacker` while showing the user their own address. The user
  signs a tx that sends the bought tokens to the attacker. The API gives this a
  clean, "verified/simulated" stamp (`/swap` returns `verification.status:
  "simulated"`) because the simulation runs with `from: sender` and the swap
  succeeds — it just succeeds in the attacker's favor. The API's verification
  step provides **false assurance** here: it confirms the tx will execute, not
  that it executes for the sender's benefit.
- **`recipient = address(0)`**: passes `buildSwapTx`'s hex-address check
  (`0x000...0` is a valid 20-byte address) and produces a tx that pulls the
  user's input, performs the swaps, and **strands the entire output in the
  router** (no MinOut revert because `_settle` returns before the check).
  Funds are then recoverable only by the EOA owner. A buggy or hostile
  integration can grief users into total-output loss with a tx the API happily
  built and "verified".
- **Fee-on-recipient / phishing UIs**: because recipient is decoupled from
  sender, an embedded widget can quietly skim or redirect output without the
  contract or API objecting.

This is a defense-in-depth gap: the server is the one component positioned to
enforce "swap output goes to the swapper," and it currently delegates that
entirely to client honesty.

## Recommendation

1. **Bind recipient to sender on the server (preferred).** In the `/swap`
   (and `/approval`) handler, after resolving `sender`, either:
   - **Reject** when `quote.recipient` is present and
     `recipient.toLowerCase() !== sender.toLowerCase()` (HTTP 422,
     `recipient-mismatch`), **and** reject `recipient == address(0)`; or
   - **Overwrite** `quote.recipient = sender` unconditionally before
     `executionQuoteTransform` / `buildSwapTx`, so the recipient can never be
     anything but the signer. This is the simplest, fully-safe option and
     removes the third-party-recipient capability entirely.
   Do this in `handler.mjs` around L766-777 (and L733-744 for `/approval`),
   before the calldata is built, so it also covers the refreshed-quote path.
2. If a deliberate "swap to a different address" feature is ever wanted, make it
   explicit and opt-in (a separate signed field), never the silent default, and
   still forbid `address(0)`.
3. Add `recipient != address(0)` validation in `buildSwapTx.mjs:60` /
   `dogeSwapRouterCalldata.mjs:288` as a contract-aligned belt-and-suspenders
   (the `address(0)` no-op path is documented as "tests only" — production
   calldata should never be able to hit it).
4. Independently: complete `acceptOwnership()` to the intended
   TimelockController+Safe so the only recovery path for any stranded funds is
   not a single EOA hot key (tracked separately; reinforces why preventing
   `address(0)`/wrong-recipient at the API matters).

## Confirmed facts

- No recipient/sender cross-check exists in `packages/api/src` or
  `packages/aggregator/src` (grep returns nothing).
- `/swap` and `/approval` accept a client-supplied `quote.recipient` and pass it
  through unmodified into calldata.
- A caller can obtain a swap tx with `recipient != sender` or
  `recipient == address(0)`.
- Contract `_settle` no-ops on `recipient == address(0)` (DogeSwapRouter.sol:288)
  and pays output to the caller-declared recipient (L295); recovery is
  `onlyOwner` `rescue` (L144).
- Live owner/guardian = `0xE659A8d3745b1355CA47B3d92925997Ef93a2873`, an EOA
  (empty bytecode), feeBps=0 — confirmed via `cast` on Chikyū testnet.
- Served stack confirmed: systemd runs `packages/web/src/server.mjs`, which
  serves `apps/web/dist` and routes `/quote`,`/approval`,`/swap` to
  `createLiveAggregatorApiHandler` (`packages/api/src/live.mjs` →
  `handler.mjs`). Both the production frontend (`apps/web`) and the audited
  handler are the live ones.
