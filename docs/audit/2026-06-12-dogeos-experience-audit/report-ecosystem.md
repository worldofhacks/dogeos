# DogeSwap — Ecosystem & Experience Audit (DogeOS Featuring Decision)

**Date:** 2026-06-12
**Author:** Head of Ecosystem, DogeOS
**Subject:** DogeSwap (production, `main`) — non-custodial DEX aggregator on the DogeOS Chikyū Testnet (chainId 6281971)
**Decision owned here:** Should DogeOS feature and back DogeSwap today, and what must change first?
**Companion document:** `report-engineering.md` (security/correctness half). This half covers UX, competitive fit, ecosystem fit, and the cross-cutting engineering items that affect user trust and the go/no-go.

All on-chain claims below were verified live on 2026-06-12 against `https://rpc.testnet.dogeos.com` (head ~block 5,583,000) and the production server at `127.0.0.1:8080`. Where this report corrects a prior assumption, it is called out explicitly.

---

## 1. Ecosystem Verdict

**CONDITIONAL GO — feature after a short, well-scoped hardening pass. Do not feature today.**

DogeSwap is the single most credible *DogeOS-native* dApp I have reviewed. It is a real DogeOS product, not a generic EVM aggregator pointed at our RPC: it uses the official `@dogeos/dogeos-sdk` as its primary wallet layer, ships only our official faucet token set with explicit provenance, accounts for our signature DOGE-denominated data/finality fee in route scoring (verified: the estimator's `getL1Fee` selector, oracle predeploy, and decoder all match live chain behavior to the wei), deep-links to our Blockscout, and is admirably neutral — it routes users to *competitors'* venues (MuchFi V2/V3, Barkswap) and refuses first-party liquidity. Every token, venue, pool, and fee-oracle claim in its config was checked on-chain and **matched reality**. That discipline is exactly what an ecosystem wants to feature.

It is not yet featureable because two classes of problem would actively embarrass DogeOS if we put our logo next to it today: (1) the app makes **demonstrably false claims about our own chain** in user-facing copy, and (2) the live deployment's **trust posture is weaker than its own documentation claims** — most acutely, the fund-touching router is governed by a single EOA. Neither class is a months-long fix. The fact that the blockers are copy edits, one governance transaction, a verification command, and a doc refresh — against an otherwise genuinely native, well-architected app — is itself the strongest argument for backing it.

**Top 3 conditions (blockers — all must be cleared before any "featured / official / audited" framing):**

1. **Fix the false chain claims.** Remove "instant finality via PWR Chain" (PWR Chain is an unrelated blockchain — a copy-paste leak), correct "10,000+ TPS" to ~300 TPS, and drop "instant finality" / "instant withdrawals" (our bridge withdrawals can take up to ~4h). These become *official-looking statements about DogeOS* the moment we feature the app. (~1 day.)
2. **Fix the router governance posture.** The live `DogeSwapRouter` (`0xa315…aA35A`) has `owner() == guardian() == 0xE659…2873`, a single EOA with no code — not the TimelockController the audit docs describe. The documented timelock handover was initiated (`pendingOwner()` is the real 48h timelock) but `acceptOwnership()` was never executed, and the guardian was never split to a distinct pause-only key. Complete the handover and split the guardian, **or** stop describing governance as hardened. We cannot vouch for a fund-moving contract one compromised key can drain, set fees on, and `rescue()` with no delay and no multisig. (One transaction + one `setGuardian`.)
3. **Verify the router on Blockscout and refresh the stale audit docs.** The core fund-moving contract is currently `is_verified: false` on our own explorer, and the audit package still says Permit2 is "ABSENT" when it is in fact deployed at the canonical address (verified live: 9,152 bytes of code). An unverified flagship contract plus self-contradicting "critical-path" docs is a transparency failure we would have to defend. (A verify command + a doc pass.)

**Secondary conditions** (strongly recommended for a credible showcase, not strict blockers): provision the production DogeOS SDK `clientId` so mobile MyDoge / embedded wallets actually work (currently disabled in prod — UX-1); add the success-screen Blockscout link (UX-2); align the chain name to the official "DogeOS Chikyū Testnet" (with macron) and `nativeCurrency.name` to "DOGE"; and break out the DogeOS data/finality fee in the UI as a native-feature showcase.

> **Ground-truth correction worth recording:** a prior assumption held that `chains.mjs`'s `wss://ws.rpc.testnet.dogeos.com` was a dead endpoint (an HTTPS GET returns 404, and no WS URL is documented by DogeOS). A genuine RFC6455 WebSocket handshake **succeeded**: the socket opened, returned the correct chainId, and pushed live `newHeads`. The endpoint is a **functional, undocumented** WebSocket RPC; the 404 was a probe-methodology artifact. **Do not flag DogeSwap's WS config as broken.** (The chain-name/native-currency cosmetics remain real and worth fixing.)

---

## 2. Experience Scorecard

Grades reflect what a real DogeOS user encounters today, weighted by what matters for featuring. Engineering ground-truth is folded into "Trust/Transparency."

| Dimension | Grade | Summary |
|---|---|---|
| Wallet / Onboarding | **C+** | Excellent desktop extension flow; **mobile MyDoge & embedded login disabled in prod** (no clientId); faucet buried. |
| Swap Flow | **A−** | Best-in-class CTA state machine, quote freshness/expiry, error mapping, single-approval Permit2. Success screen under-delivers. |
| Trust / Transparency | **C** | Honest *in-app* numbers, but single-EOA router, unverified contract, false chain copy, stale docs drag this down. |
| DogeOS-Nativeness | **A−** | Native SDK, official tokens, correct DOGE fee accounting, Blockscout-first, neutral routing. False chain copy is the blemish. |
| Mobile | **B−** | Genuinely mobile-built (bottom-sheet, tab bar, safe-area, haptics) — but the dominant mobile wallet path is off in prod. |

### Wallet / Onboarding — C+
The four-state CTA (connect → switch network → enter amount / insufficient balance → review) is implemented correctly in a *single button slot*, with wrong-network surfaced in both the CTA and a red header chip. Connect is always a real button, never passive text. But **production ships with `dogeosClientId: ""`** (verified live in `runtime-config.js`), so the DogeOS Connect Kit modal never mounts and the app silently runs the injected-only fallback — meaning mobile MyDoge via WalletConnect and the email/social embedded logins the SDK config *advertises* do not work in prod. The only signal of this degradation is a `console.info`. The faucet — the literal first step for a new user — is buried in Settings and only surfaces reactively after a failed swap. For a chain whose community is mobile-first and whose whole SDK pitch is easy MyDoge onboarding, shipping that path disabled is the biggest gap between "good desktop dApp" and "best DogeOS experience."

### Swap Flow — A−
This is the strongest part of the product. One primary button slot cycles connect → switch network → insufficient balance → quotes unavailable → review swap, in the correct precedence. Quotes are debounced (250ms), polled (10s), sequence-guarded, abortable, with a per-quote TTL countdown that flips to "quote expired · refresh" so users never sign stale. Contract reverts are mapped to friendly copy with faucet links on insufficient-DOGE; no raw selectors leak. Pending is non-dismissible with a cancel escape hatch and a 120s wallet timeout. The single-approval Permit2 path is real and *works because Permit2 is genuinely deployed* (contradicting the stale docs). Two deductions keep it off an A: the success screen shows the pre-trade **estimate** ("received ~X (est.)") rather than the realized on-chain delta, and (see below) it doesn't link the result to the explorer.

### Trust / Transparency — C
The in-app honesty is exemplary: no fabricated USD totals, no fake price-impact, no fake sparklines — the UI renders "—" and says so. That restraint is rare and trust-building. But the surrounding trust posture is where featuring risk concentrates:
- **Single-EOA governance on a fund-touching router** (`owner == guardian ==` one keyless-of-code EOA; timelock handover never accepted). This is a reputational and security exposure, not a cosmetic one.
- **Router unverified on Blockscout** — users (and we) cannot confirm the deployed bytecode matches the audited source, on the very contract that moves their funds. Ironic given DogeSwap *demands* the venues it integrates verify on Blockscout.
- **False chain claims** in copy (PWR Chain, 10,000+ TPS, instant finality/withdrawals).
- **The success moment doesn't link to Blockscout** (UX-2) — the highest-trust touchpoint has no one-click "see it on-chain," even though the `txUrl()` helper already exists.
- **Stale audit docs** claiming Permit2 is absent when it is live.

The good news: every one of these is a known, bounded fix, and the *engineering substance* underneath (token decimals, venue identity, fee oracle, fee math) checked out clean on-chain.

### DogeOS-Nativeness — A−
Native SDK as the primary wallet layer; exactly our six faucet tokens as curated defaults with provenance tags (all six verified on-chain: code present, symbol/name/decimals = 18 across the board); the DOGE-denominated data/finality fee computed via the Scroll-derived `L1GasPriceOracle` and folded into net-route scoring (most generic aggregators score on `gas * gasPrice` only and would misrank routes on our chain); Blockscout as the canonical explorer; and genuinely delightful native branding ("much swap. very done.", gold-Ð favicon, doge mascot). The only thing keeping this from an A is the false chain copy and the cosmetic chain-name macron drift — both of which make a native app look like it was authored from secondhand notes.

### Mobile — B−
The app is mobile-built by construction, not merely responsive: a distinct mobile shell with a frosted sticky header, fixed bottom tab bar, bottom-sheet modals with drag-to-dismiss, safe-area insets for notches, `inputMode="decimal"`, and haptics. The architecture is right. The grade is held back entirely by UX-1: the dominant DogeOS mobile path (MyDoge via WalletConnect) is disabled in prod for want of a clientId. Fix that one config value and mobile jumps to a B+/A−.

---

## 3. Competitive Positioning

**Honest take: the engineering is best-in-class for an early chain; the strategic wedge ("aggregator-only across 3 venues") is the weakest part of the product for the chain DogeOS is *right now*.** Two facts, both confirmed live, decide this.

**The aggregable surface is a petting zoo.** Three active venues, only **two routable pairs** (WDOGE/USDC, WDOGE/USDT). The MuchFi V2 USDC/WDOGE pool holds **~3 USDC and ~8 WDOGE** total reserves — a 100-token sell drains it (returns ~26% of fair value). Three of the six listed tokens (LBTC, WETH, USD1) have **no pool at all** and dead-end in the selector. The single stable↔stable trade users most expect, **USDC → USDT, returns `no-route`** live, because one-hop candidates are emitted only as read-only previews and never selected as executable.

**Today's aggregation "win" is largely a testnet artifact.** The three venues are not arbitraged, so they price the *same pair* up to **~2x apart** (1 USDC → 0.728 / 0.692 / 0.349 WDOGE on MuchFi V3 / Barkswap / MuchFi V2). Aggregation looks like a slam dunk (best route +5% vs second venue, +100% vs worst) — but that is "we found the clone that's mispriced in your favor," not a structural efficiency gain. On mainnet, arbitrage compresses cross-venue prices toward parity and the remaining value of aggregation is **depth-aware split routing on deep pools** — which today's single-digit-token reserves cannot exercise at meaningful size.

**Vs MuchFi / Barkswap directly:** MuchFi already runs a production UI *and* owns its pools; an Aerodrome-fork Barkswap (the strategy doc still models it as plain Algebra — stale) will own a UI plus an emissions/gauge flywheel that keeps LPs and traders in-app. A neutral router with no liquidity, no token, and no emissions has **no structural lock-in**. Its only organic moats are execution quality (which converges as the chain matures) and UX (which competitors can copy).

**Vs broader aggregators (1inch / Jupiter / Matcha / CoW):** those list thousands of tokens and route stable↔stable trivially, and ship limit orders, gasless/Fusion, DCA, portfolio, and cross-chain as *baseline*. DogeSwap's V1 doc explicitly defers all of those. As a *default trading surface* the gap is large; as a *safety-first testnet router* the deferral is defensible.

**Where the real moat is.** Not "we route across 3 clones better than you can by hand." It is **"we are the default DogeOS swap surface"** — backed by three things a single first-party DEX cannot replicate:
1. **Distribution** — being the DogeOS-official / featured neutral router. This is precisely the lever DogeOS controls and the strongest reason the strategy works *if* we back it.
2. **The L1↔L2 bridge-in → swap flow** — uniquely DogeOS, leverages the SDK already integrated, and solves the consumer cold-start ("I have DOGE on L1, now what").
3. **Limit orders + portfolio on the first-party router + an indexer** — product surfaces a generic aggregator can't offer on DogeOS, with the first-party `DogeSwapRouter` as the natural settlement venue.

The first-party `DogeSwapRouter` (atomic split settlement, single-Permit2-approval, enforced deadline/min-out, movement-only command whitelist, 53 Foundry tests) is a genuine differentiator no generic aggregator brings to a thin chain — but at quote time the live default routes single-venue swaps direct to MuchFi's router (`executionMode: None`), so the safety story is currently invisible in the quote the user evaluates. Surface it.

---

## 4. What Would Make This the Default DogeOS Swap Surface (Prioritized)

1. **Make one-hop-through-WDOGE executable so USDC↔USDT works** (and hide/flag the three tokens with no liquidity). The first-party router already does atomic multi-leg settlement — wire one-hop legs into it like splits. *This is the #1 product blocker to "default surface": a swap app that can execute only 2 pairs and shows 3 untradeable tokens dead-ends the exact users DogeOS most wants to convert.*
2. **Provision the prod SDK `clientId`** so mobile MyDoge / embedded onboarding works. Highest-leverage onboarding fix; it is one environment value (runtime-injected, no rebuild).
3. **Ship the bridge-in → swap flow.** Uniquely DogeOS, removes the cold-start problem, and is a moat a single DEX can't easily match. Sequence this pre-mainnet.
4. **Add a faucet-first onboarding nudge** — an inline "Get testnet DOGE →" near the CTA and in the empty Tokens state, mirroring DogeOS's own faucet-first getting-started.
5. **Wire the success-screen Blockscout link and show the realized fill**, not the estimate — close the post-swap trust loop.
6. **Stand up a lightweight indexer (swap events → OHLC).** Shared dependency for charts-with-history (today's charts are synthetic, forward-built from quotes), portfolio P&L, limit-order triggers, and the route-win metrics the ops doc already wants. Treat it as core infra, not chart polish.
7. **On-chain limit orders settled by the first-party router** — a real, DogeOS-specific moat once the indexer exists.
8. **Break out the DogeOS data/finality fee in the UI** ("execution fee" + "data & finality fee (DogeOS)") — cheap, native-feature showcase that teaches users what makes DogeOS different.
9. **Refresh the venue strategy for the real mainnet set** (Rocketswap, DoggyFi, USDoge; Barkswap as ve(3,3)). Each new DEX makes the neutral-router pitch stronger *and* raises the bar for default status.

---

## 5. Reputational Risks to DogeOS (Must Change Before Featuring)

These are the items that, screenshotted or read by a partner/grant reviewer, reflect on **DogeOS**, not just DogeSwap.

| Risk | Why it's a DogeOS problem | Required change |
|---|---|---|
| **False chain claims** ("PWR Chain," "10,000+ TPS," "instant finality/withdrawals") | Once featured, these read as *official* DogeOS over-promises — exactly the kind that invite ridicule and erode developer trust. "PWR Chain" makes the team look like it doesn't know what chain it built on. | Replace with doc-accurate copy (~300 TPS; "settles to Dogecoin after ZK proof + L1 verification"; "withdrawals can take up to ~4h"); add a regression test pinning these strings to `networks.md`. **Blocker.** |
| **Single-EOA governance on a fund-moving router** | If we frame this as "audited / production-hardened," we vouch for a posture the chain state contradicts. One compromised key = one-step incident on a contract that moves user funds. | Complete `timelock.acceptOwnership()` and split the guardian to a distinct pause-only key — or drop the Timelock/Safe language. **Blocker.** |
| **Flagship contract unverified on Blockscout** | A featured app whose core contract can't be source-verified on *our own explorer* is a transparency failure we'd have to defend — and it undercuts DogeSwap's own "verify your contracts" pitch to other venues. | `--verify --verifier blockscout`; surface a "verified ✓" link in the UI. **Blocker.** |
| **Stale audit docs (Permit2 "ABSENT")** | A grant/partnership reviewer reading the audit package concludes a critical dependency is missing and the stack is "broken" per the doc's own wording, eroding confidence in otherwise-rigorous claims. | Update `KNOWN_ISSUES.md` / `DEPLOYMENT.md` with live evidence that Permit2 is deployed; sweep for other staleness. **Blocker.** |
| Mobile/embedded wallet disabled in prod | A DogeOS-featured swap where the dominant community device can't connect makes the chain's flagship SDK look non-functional. | Provision the prod `clientId`. Strongly recommended pre-feature. |
| Cosmetic chain-name / native-currency drift | A canonical app that writes "DogeOS Chikyu Testnet" (no macron) / "DogeOS DOGE" into wallets looks careless vs the official portal. | Align to "DogeOS Chikyū Testnet" / "DOGE." Cheap; do it. |
| No public license / repo; testnet-only framing | We can't point developers at it as a reference integration or grant it as open infra without a license; featuring must say "testnet preview," not imply production. | Add an OSI license + public repo if we want to feature it as a reference SDK integration; frame featuring as "testnet preview." |

**Note for fairness:** the WS-endpoint concern that appeared in earlier drafts is **withdrawn** — the endpoint is live (see §1). Do not raise it with the team as a defect.

---

## 6. Growth, Co-Marketing & Grant Levers DogeOS Can Pull

Sequenced so DogeOS funds *behavior we want* and only attaches its brand after the blockers clear.

**Grant levers (tie disbursement to the blockers — turns our money into the forcing function):**
- **Hardening grant**, milestone-gated on: (1) router verified on Blockscout, (2) timelock handover accepted + guardian split, (3) chain-copy corrected with a regression test, (4) audit docs refreshed. Small, fast, high-signal — it pays for exactly the four things standing between this and featureable.
- **"Default surface" grant**, milestone-gated on the §4 product work: executable USDC↔USDT, bridge-in → swap, and the indexer (the shared dependency for charts/portfolio/limit orders). This is the work that converts a neutral router into the canonical DogeOS swap entry point.
- **Reference-integration grant** contingent on an OSI license + public repo, so DogeSwap becomes the canonical "how to build a DogeOS-SDK dApp" example other teams copy.

**Co-marketing levers (post-blocker):**
- **Featured-dApp slot** in the testnet portal once §1–§3 conditions clear — the distribution moat that is DogeSwap's strongest defensibility argument.
- **Neutral-aggregator narrative post** pairing DogeSwap with MuchFi and Barkswap: "the router that lifts every DogeOS DEX." This is a story *only a neutral aggregator can tell*, and it makes DogeOS look like a coordinated ecosystem rather than a set of competing forks.
- **"DogeOS economics, made legible" piece** built around the data/finality fee breakdown (once surfaced) — uses DogeSwap to teach the chain's differentiator.

**Ecosystem-flywheel levers:**
- Position DogeSwap to new DEXes (Rocketswap, DoggyFi, USDoge) as **the neutral router they want to be listed on** — distribution they can't replicate — and let DogeOS broker those onboardings. Every new venue makes the aggregator more valuable and the chain look deeper.
- **Bridge-in → swap as the consumer on-ramp** for MyDoge users coming from Dogecoin L1: co-market it as the one-flow answer to "I have DOGE, how do I use DogeOS."

---

## Bottom Line

Back it — conditionally. The bones are exactly what should represent DogeOS: native SDK, official tokens, correct DOGE-fee accounting, Blockscout-first, neutral routing that lifts competing DEXes, and an honest trade UI. Every on-chain claim it makes about tokens, venues, pools, and fees is true. But do not attach the DogeOS brand until the false chain copy is corrected, the router's governance and verification match its own documentation, and the stale docs are refreshed. Those are days of work — and that short distance, against a genuinely native and well-architected app, is precisely why DogeSwap is worth backing.
