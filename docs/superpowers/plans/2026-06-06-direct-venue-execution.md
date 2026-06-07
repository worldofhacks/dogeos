# Direct Venue Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a DogeOS-native direct venue execution aggregator that reliably quotes, approves, simulates, builds, sends, confirms, and documents swaps through verified external DogeOS DEX routers.

**Architecture:** The app executes one selected active route through the verified external venue router returned by `/swap`. `/quote` provides live route candidates and telemetry, `/approval` plans exact ERC-20 allowance to the venue router spender, and `/swap` refreshes the selected quote before building sender-aware calldata, simulation, gas, balance, and DogeOS data/finality evidence.

**Tech Stack:** Node.js ESM, built-in `node:test`, DogeOS RPC, DogeOS Blockscout, DogeOS SDK, browser EIP-1193 providers, Vite, Playwright rendered QA.

---

## Gap Analysis

| Area | Current state | Gap | Implementation task |
| --- | --- | --- | --- |
| GitHub state | Branch is synced with GitHub, but local worktree has uncommitted wallet, execution, intelligence, chain-status, and UI changes. | DogeOS reviewers cannot see the latest verified local work. | Task 1 |
| API execution contract | `/quote`, `/approval`, and `/swap` exist and direct venue execution works in tests. | Native-app integration needs an explicit execution envelope that says spender, transaction target, execution model, route status, router, source, and Blockscout links. | Task 2 |
| Approval proof | ERC-20 allowance planning exists and uses exact amount. | Approval response should include spender provenance and optional RPC simulation/gas proof before the UI asks the wallet to sign. | Task 3 |
| Wallet provider isolation | Local changes already improve MyDoge/MetaMask/Rainbow selection. | Need final tests and rendered diagnostics proving the selected wallet provider is preserved through approval and swap. | Task 4 |
| Direct route warnings | Route scan shows route state, gas, data/finality, and provenance. | Price impact, shallow liquidity, stale quote, source-filter, and read-only warnings need a single normalized warning model for direct venues. | Task 5 |
| Source filters | API accepts include/exclude source arrays. | UI/native integration needs source filter state reflected in route provenance and request payloads. | Task 6 |
| Transaction lifecycle | UI has transaction flow and receipt polling behavior in local changes. | Final pass needs deterministic success/failure notifications, balance refresh only after receipt or real balance change, and Blockscout receipt links. | Task 7 |
| Activity | `/activity` reads DogeOS Blockscout. | Activity needs wallet-specific empty/error/loading states and recent confirmed swap insertion without fake history. | Task 8 |
| Native integration documentation | Architecture docs exist. | MyDoge/native consumers need a concise integration contract for direct venue execution. | Task 9 |
| Release evidence | Focused and full tests have passed locally. | The branch needs a repeatable command checklist and a GitHub-ready summary. | Task 10 |

## File Map

| File | Responsibility in this plan |
| --- | --- |
| `packages/api/src/handler.mjs` | Adds direct execution envelope metadata to `/approval` and `/swap` responses. |
| `packages/api/src/live.mjs` | Keeps live provider wiring for DogeOS RPC, fee oracle, quote providers, approval planner, swap verifier, and balance verifier. |
| `packages/aggregator/src/swap/erc20Approval.mjs` | Extends exact approval planning with optional approval transaction verification helpers. |
| `packages/aggregator/src/swap/verifyApprovalTx.mjs` | New focused approval simulation/gas verification module. |
| `packages/aggregator/src/swap/buildSwapTx.mjs` | Keeps direct venue transaction binding strict and explicit. |
| `packages/aggregator/src/quoteWarnings.mjs` | New normalized warning builder for price impact, stale quote, liquidity, read-only, source filtering, and DogeOS fee warnings. |
| `packages/aggregator/src/index.mjs` | Exports new approval verifier and warning helpers. |
| `apps/web/src/injected-wallet.js` | Maintains EIP-6963 provider selection and prevents provider drift. |
| `apps/web/src/sdk-wallet-provider.jsx` | Maintains DogeOS SDK wallet modal and selected wallet source integration. |
| `apps/web/src/sdk-chain-switch.js` | Keeps DogeOS chain switching and add-chain fallback isolated from wallet choice. |
| `apps/web/src/app.js` | Renders source filters, route warnings, approval proof, direct execution envelope, receipt notifications, and balance refresh state. |
| `apps/web/src/index.html` | Adds source filter controls and warning/proof containers where needed. |
| `apps/web/src/styles.css` | Styles source filters, warning chips, and direct execution proof states. |
| `packages/api/test/handler.test.mjs` | API contract tests for direct execution envelope, approval proof, and non-executable route rejection. |
| `packages/aggregator/test/*.test.mjs` | Unit tests for approval verification and warning normalization. |
| `packages/web/test/*.test.mjs` | Static app tests for wallet choice, source filters, warnings, lifecycle, balances, and activity. |
| `docs/mydoge-native-direct-execution.md` | New native integration contract for direct venue execution. |
| `docs/dogeos-direct-venue-readiness.md` | New readiness summary for GitHub/DogeOS review. |

## Task 1: Publishable Baseline And Worktree Hygiene

**Files:**
- Modify: no source code in this task unless tests expose a regression
- Create: `docs/dogeos-direct-venue-readiness.md`

- [ ] **Step 1: Snapshot local state**

Run:

```bash
git status -sb
git diff --stat
git ls-files --others --exclude-standard
```

Expected:

```text
## codex/dogeos-aggregator-revamp...origin/codex/dogeos-aggregator-revamp
 M ...
?? ...
```

Record any untracked files that belong to this aggregator work. Do not delete or revert unrelated files.

- [ ] **Step 2: Create readiness summary**

Create `docs/dogeos-direct-venue-readiness.md` with this structure:

```markdown
# DogeOS Direct Venue Aggregator Readiness

## Execution Model

The aggregator executes direct swaps through verified external DogeOS venue routers. The current direct execution model does not deploy a custom DEX, pool factory, pool manager, or owned liquidity venue.

## DogeOS Chain

- Chain: DogeOS Chikyu Testnet
- Chain ID: 6281971 / 0x5fdaf3
- Native gas token: DOGE
- RPC: https://rpc.testnet.dogeos.com
- Blockscout: https://blockscout.testnet.dogeos.com
- Faucet: https://faucet.testnet.dogeos.com
- L1 gas price oracle: 0x5300000000000000000000000000000000000002

## Active Executable Venues

- MuchFi V2: direct V2 router execution after live quote refresh, simulation, gas estimate, and balance preflight.
- MuchFi V3: direct V3 router execution after live quote refresh, simulation, gas estimate, and balance preflight.
- Barkswap Algebra: direct Algebra router execution after live quote refresh, simulation, gas estimate, and balance preflight.

## Non-Executable Intelligence

One-hop, split-route, watchlist, and rejected venues may appear as route intelligence or venue evidence, but they are not executable unless `/quote` returns an active direct route and `/swap` returns a verified wallet transaction.

## Verification Commands

```bash
node --test packages/api/test/handler.test.mjs
node --test packages/web/test/server.test.mjs packages/web/test/viteConfig.test.mjs packages/web/test/staticApp.test.mjs
npm test
npm run build:web
curl -sS --max-time 12 http://127.0.0.1:8788/chain-status
```
```

- [ ] **Step 3: Run focused API/web tests**

Run:

```bash
node --test packages/api/test/handler.test.mjs
node --test packages/web/test/server.test.mjs packages/web/test/viteConfig.test.mjs packages/web/test/staticApp.test.mjs
```

Expected:

```text
# pass 25
# fail 0
# pass 49
# fail 0
```

- [ ] **Step 4: Run full test and production build**

Run:

```bash
npm test
npm run build:web
```

Expected:

```text
# pass 289
# fail 0
✓ built
```

The build can emit known dependency warnings from wallet SDK packages. Runtime app console errors are not acceptable.

- [ ] **Step 5: Commit verified baseline**

Run:

```bash
git add apps/web/src/app.js apps/web/src/index.html apps/web/src/injected-wallet.js apps/web/src/sdk-browser-globals.js apps/web/src/sdk-chain-switch.js apps/web/src/sdk-wallet-provider.jsx apps/web/src/sdk-wallet.jsx apps/web/src/styles.css package.json package-lock.json packages/aggregator/src/index.mjs packages/aggregator/src/sources/intelligence.mjs packages/aggregator/test/sourceIntelligence.test.mjs packages/api/src/handler.mjs packages/api/src/live.mjs packages/api/test/handler.test.mjs packages/web/src/server.mjs packages/web/test/injectedWallet.test.mjs packages/web/test/sdkChainSwitch.test.mjs packages/web/test/server.test.mjs packages/web/test/staticApp.test.mjs packages/web/test/viteConfig.test.mjs scripts/verify-repository-scope.mjs scripts/__tests__/verify-repository-scope.test.mjs scripts/__tests__/web-swap-settings-markup.test.mjs vite.config.mjs docs/dogeos-direct-venue-readiness.md
git commit -m "feat: harden DogeOS direct venue aggregator"
```

Expected:

```text
[codex/dogeos-aggregator-revamp ...] feat: harden DogeOS direct venue aggregator
```

Do not include unrelated files if `git status --short` shows files outside this feature set.

## Task 2: Direct Execution Envelope For API And Native Consumers

**Files:**
- Modify: `packages/api/src/handler.mjs`
- Test: `packages/api/test/handler.test.mjs`

- [ ] **Step 1: Write failing API tests**

Add tests to `packages/api/test/handler.test.mjs`:

```js
test("POST /swap returns a direct venue execution envelope for native clients", async () => {
  const quote = activeQuote({
    sourceId: "muchfi-v2",
    router: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
  });
  const handle = createAggregatorApiHandler({
    nowMs: () => quote.quoteTimestampMs,
    calldataBuilder: () => "0x38ed1739",
    swapVerifier: async () => ({
      status: "simulated",
      estimatedGas: 120000n,
      gasLimit: 144000n,
      gasBufferBps: 12000n,
      blockTag: "latest",
      dataFinalityFeeWei: 456n,
    }),
  });

  const response = await handle(new Request("https://aggregator.local/swap", {
    method: "POST",
    body: JSON.stringify({
      sender: "0x1111111111111111111111111111111111111111",
      quote: {
        ...quote,
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1780000000,
      },
    }, jsonReplacer),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.execution, {
    model: "directVenue",
    executable: true,
    spender: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
    transactionTarget: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
    sourceId: "muchfi-v2",
    routeType: "direct",
    chainId: 6281971,
    blockscoutTransactionBaseUrl: "https://blockscout.testnet.dogeos.com/tx/",
  });
});

test("POST /swap refuses read-only one-hop previews as non-executable", async () => {
  const quote = activeQuote({
    sourceId: "muchfi-v2+muchfi-v3",
    status: "readOnly",
    reason: "one-hop-execution-preview",
    routeType: "oneHop",
  });
  const handle = createAggregatorApiHandler({
    calldataBuilder: () => "0x38ed1739",
  });

  const response = await handle(new Request("https://aggregator.local/swap", {
    method: "POST",
    body: JSON.stringify({
      sender: "0x1111111111111111111111111111111111111111",
      quote: {
        ...quote,
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1780000000,
      },
    }, jsonReplacer),
  }));
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.error.code, "swap-not-buildable");
  assert.match(body.error.message, /not active for execution/i);
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
node --test packages/api/test/handler.test.mjs
```

Expected:

```text
not ok ... POST /swap returns a direct venue execution envelope for native clients
```

- [ ] **Step 3: Implement execution envelope**

In `packages/api/src/handler.mjs`, add:

```js
function directExecutionEnvelope({ quote, transaction }) {
  return {
    model: "directVenue",
    executable: quote.status === "active",
    spender: quote.router,
    transactionTarget: transaction.to,
    sourceId: quote.sourceId,
    routeType: quote.routeType ?? "direct",
    chainId: DOGEOS_CHAIN.id,
    blockscoutTransactionBaseUrl: `${DOGEOS_CHAIN.blockscoutBaseUrl}/tx/`,
  };
}
```

Then include it in the `/swap` response:

```js
return jsonResponse({
  quote,
  execution: directExecutionEnvelope({ quote, transaction: tx }),
  transaction: {
    ...walletTransaction,
    gas: verification.gasLimit,
  },
  verification: {
    ...verification,
    ...(balance ? { balance } : {}),
  },
});
```

When `swapVerifier` is not configured, include the same `execution` object in the non-verified response.

- [ ] **Step 4: Run tests and confirm pass**

Run:

```bash
node --test packages/api/test/handler.test.mjs
```

Expected:

```text
# pass 27
# fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/api/src/handler.mjs packages/api/test/handler.test.mjs
git commit -m "feat: expose direct venue execution envelope"
```

## Task 3: Approval Simulation And Spender Provenance

**Files:**
- Create: `packages/aggregator/src/swap/verifyApprovalTx.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Modify: `packages/api/src/handler.mjs`
- Test: `packages/aggregator/test/approvalVerification.test.mjs`
- Test: `packages/api/test/handler.test.mjs`

- [ ] **Step 1: Write approval verification unit tests**

Create `packages/aggregator/test/approvalVerification.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { verifyApprovalTransaction } from "../src/swap/verifyApprovalTx.mjs";

test("verifyApprovalTransaction simulates and estimates exact approval calldata", async () => {
  const calls = [];
  const transaction = {
    to: "0x2222222222222222222222222222222222222222",
    data: "0x095ea7b3".padEnd(138, "0"),
    value: 0n,
  };
  const result = await verifyApprovalTransaction({
    client: {
      call: async (request, blockTag) => {
        calls.push(["call", request, blockTag]);
        return "0x";
      },
      estimateGas: async (request) => {
        calls.push(["estimateGas", request]);
        return 50000n;
      },
    },
    transaction,
    sender: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(result.status, "simulated");
  assert.equal(result.estimatedGas, 50000n);
  assert.equal(result.gasLimit, 60000n);
  assert.deepEqual(calls.map(([kind]) => kind), ["call", "estimateGas"]);
});

test("verifyApprovalTransaction rejects malformed approval transaction target", async () => {
  await assert.rejects(
    () =>
      verifyApprovalTransaction({
        client: { call: async () => "0x", estimateGas: async () => 1n },
        transaction: { to: "bad", data: "0x095ea7b3", value: 0n },
        sender: "0x1111111111111111111111111111111111111111",
      }),
    /transaction.to must be a 20-byte hex address/,
  );
});
```

- [ ] **Step 2: Run test and confirm missing module failure**

Run:

```bash
node --test packages/aggregator/test/approvalVerification.test.mjs
```

Expected:

```text
Cannot find module '../src/swap/verifyApprovalTx.mjs'
```

- [ ] **Step 3: Implement approval verifier**

Create `packages/aggregator/src/swap/verifyApprovalTx.mjs`:

```js
function assertHexAddress(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
}

function assertHexData(value, fieldName) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be hex calldata.`);
  }
}

function normalizeGasBufferBps(value) {
  const normalized = BigInt(value);
  if (normalized < 10_000n) {
    throw new Error("gasBufferBps must be at least 10000.");
  }
  return normalized;
}

function bufferedGasLimit(estimatedGas, gasBufferBps) {
  return (estimatedGas * gasBufferBps + 9_999n) / 10_000n;
}

function approvalRequest({ transaction, sender }) {
  assertHexAddress(sender, "sender");
  assertHexAddress(transaction.to, "transaction.to");
  assertHexData(transaction.data, "transaction.data");
  if (BigInt(transaction.value ?? 0n) !== 0n) {
    throw new Error("approval transaction.value must be zero.");
  }
  return {
    from: sender,
    to: transaction.to,
    data: transaction.data,
    value: 0n,
  };
}

export async function verifyApprovalTransaction({
  client,
  transaction,
  sender,
  gasBufferBps = 12_000n,
  blockTag = "latest",
} = {}) {
  if (!client?.call || !client?.estimateGas) {
    throw new Error("Approval verification requires RPC call and estimateGas methods.");
  }
  const request = approvalRequest({ transaction, sender });
  const buffer = normalizeGasBufferBps(gasBufferBps);
  const simulationPromise = client.call(request, blockTag);
  const gasEstimatePromise = client.estimateGas(request);
  const [, estimatedGas] = await Promise.all([simulationPromise, gasEstimatePromise]);
  return {
    status: "simulated",
    estimatedGas,
    gasLimit: bufferedGasLimit(estimatedGas, buffer),
    gasBufferBps: buffer,
    blockTag,
  };
}
```

Export it from `packages/aggregator/src/index.mjs`:

```js
export { verifyApprovalTransaction } from "./swap/verifyApprovalTx.mjs";
```

- [ ] **Step 4: Wire optional approval verifier into API**

In `packages/api/src/handler.mjs`, add `approvalVerifier` to the handler options:

```js
  approvalVerifier,
```

After `const plan = await approvalPlanner(...)`, add:

```js
const verification =
  approvalVerifier && plan.approvalRequired
    ? await approvalVerifier({
        transaction: plan.transaction,
        quote,
        sender: owner,
      })
    : undefined;

return jsonResponse({
  ...plan,
  quote,
  spender: quote.router,
  execution: {
    model: "directVenue",
    spender: quote.router,
    transactionTarget: quote.router,
    sourceId: quote.sourceId,
    chainId: DOGEOS_CHAIN.id,
  },
  ...(verification ? { verification } : {}),
});
```

- [ ] **Step 5: Add API test for approval proof**

Add to `packages/api/test/handler.test.mjs`:

```js
test("POST /approval returns exact approval spender provenance and simulation proof", async () => {
  const quote = activeQuote({ sourceId: "muchfi-v2" });
  const handle = createAggregatorApiHandler({
    approvalPlanner: async ({ spender, amount }) => ({
      approvalRequired: true,
      allowance: 0n,
      transaction: {
        to: quote.sellToken,
        data: "0x095ea7b3",
        value: 0n,
      },
      spender,
      amount,
    }),
    approvalVerifier: async () => ({
      status: "simulated",
      estimatedGas: 50000n,
      gasLimit: 60000n,
      gasBufferBps: 12000n,
      blockTag: "latest",
    }),
  });

  const response = await handle(new Request("https://aggregator.local/approval", {
    method: "POST",
    body: JSON.stringify({
      owner: "0x1111111111111111111111111111111111111111",
      quote: {
        ...quote,
        recipient: "0x1111111111111111111111111111111111111111",
        deadline: 1780000000,
      },
    }, jsonReplacer),
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.approvalRequired, true);
  assert.equal(body.spender, quote.router);
  assert.equal(body.execution.model, "directVenue");
  assert.equal(body.verification.status, "simulated");
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test packages/aggregator/test/approvalVerification.test.mjs packages/api/test/handler.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 7: Commit**

Run:

```bash
git add packages/aggregator/src/swap/verifyApprovalTx.mjs packages/aggregator/src/index.mjs packages/aggregator/test/approvalVerification.test.mjs packages/api/src/handler.mjs packages/api/test/handler.test.mjs
git commit -m "feat: simulate direct venue approvals"
```

## Task 4: Wallet Provider Isolation Finalization

**Files:**
- Modify: `apps/web/src/injected-wallet.js`
- Modify: `apps/web/src/sdk-wallet-provider.jsx`
- Modify: `apps/web/src/sdk-chain-switch.js`
- Test: `packages/web/test/injectedWallet.test.mjs`
- Test: `packages/web/test/sdkChainSwitch.test.mjs`
- Test: `packages/web/test/staticApp.test.mjs`

- [ ] **Step 1: Add provider drift tests**

Add or confirm tests covering these exact cases:

```js
test("injected wallet bridge keeps MetaMask provider during swap even when Rainbow is announced later", async () => {
  const metamask = providerStub({ rdns: "io.metamask", name: "MetaMask" });
  const rainbow = providerStub({ rdns: "me.rainbow", name: "Rainbow" });
  const bridge = createInjectedWalletBridge({
    providers: [metamask, rainbow],
    selectedWalletKind: "metamask",
  });

  await bridge.connect();
  const provider = bridge.getProvider();

  assert.equal(provider, metamask);
});

test("injected wallet bridge reports MyDoge unavailable when neither SDK client id nor injected provider exists", async () => {
  const bridge = createInjectedWalletBridge({
    providers: [],
    selectedWalletKind: "mydoge",
    dogeosClientId: "",
  });

  await assert.rejects(
    () => bridge.connect(),
    /MyDoge Link requires a configured DogeOS SDK client ID or an injected MyDoge provider/i,
  );
});
```

Use the existing local helper names in `packages/web/test/injectedWallet.test.mjs`; if the helper names differ, add small focused helpers in that test file rather than changing production APIs just for tests.

- [ ] **Step 2: Run provider tests and confirm failures only for missing coverage**

Run:

```bash
node --test packages/web/test/injectedWallet.test.mjs packages/web/test/sdkChainSwitch.test.mjs
```

Expected before implementation:

```text
not ok ... keeps MetaMask provider during swap
```

If the tests already pass because current local work covers them, keep the tests and continue.

- [ ] **Step 3: Preserve selected provider object**

In `apps/web/src/injected-wallet.js`, ensure the selected provider is stored by wallet kind and reused:

```js
let selectedProvider = null;
let selectedWalletKind = "";

function setSelectedProvider(kind, provider) {
  selectedWalletKind = kind;
  selectedProvider = provider;
}

export function getSelectedProvider() {
  return selectedProvider;
}
```

Connection code must call `setSelectedProvider(requestedKind, provider)` after resolving EIP-6963 metadata. Swap send code must use `getSelectedProvider()` rather than `window.ethereum`.

- [ ] **Step 4: Harden app-side pre-send validation**

In `apps/web/src/app.js`, confirm the swap path checks:

```js
const providerChainId = await provider.request({ method: "eth_chainId" });
const providerAccounts = await provider.request({ method: "eth_accounts" });
const providerAccount = providerAccounts?.[0] ?? "";

if (normalizeChainId(providerChainId) !== DOGEOS_CHAIN_ID) {
  await ensureDogeOSChain();
}

if (!addressesMatch(providerAccount, state.walletAddress)) {
  throw new Error(
    `Connected wallet ${compactAddress(state.walletAddress)} does not match provider account ${compactAddress(providerAccount)}.`,
  );
}
```

- [ ] **Step 5: Run static wallet tests**

Run:

```bash
node --test packages/web/test/injectedWallet.test.mjs packages/web/test/sdkChainSwitch.test.mjs packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/src/injected-wallet.js apps/web/src/sdk-wallet-provider.jsx apps/web/src/sdk-chain-switch.js apps/web/src/app.js packages/web/test/injectedWallet.test.mjs packages/web/test/sdkChainSwitch.test.mjs packages/web/test/staticApp.test.mjs
git commit -m "fix: preserve selected DogeOS wallet provider"
```

## Task 5: Normalize Route Warnings For Direct Venues

**Files:**
- Create: `packages/aggregator/src/quoteWarnings.mjs`
- Modify: `packages/aggregator/src/quoteService.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Test: `packages/aggregator/test/quoteWarnings.test.mjs`
- Test: `packages/api/test/handler.test.mjs`

- [ ] **Step 1: Add warning tests**

Create `packages/aggregator/test/quoteWarnings.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { buildRouteWarnings } from "../src/quoteWarnings.mjs";

test("buildRouteWarnings marks shallow liquidity and high price impact", () => {
  const warnings = buildRouteWarnings({
    route: {
      status: "active",
      sourceId: "muchfi-v2",
      routeType: "direct",
      priceImpactBps: 450n,
      poolState: {
        reserveIn: 1000n,
        reserveOut: 1000n,
      },
      amountIn: 500n,
      dataFinalityFeeWei: 100n,
      gasUnits: 120000n,
    },
    sourceFilters: { includeSources: [], excludeSources: [] },
  });

  assert.deepEqual(warnings.map((warning) => warning.code), [
    "high-price-impact",
    "shallow-liquidity",
  ]);
});

test("buildRouteWarnings marks source filters and read-only previews", () => {
  const warnings = buildRouteWarnings({
    route: {
      status: "readOnly",
      sourceId: "muchfi-v2+muchfi-v3",
      reason: "one-hop-execution-preview",
      routeType: "oneHop",
      amountIn: 100n,
    },
    sourceFilters: { includeSources: ["muchfi-v2"], excludeSources: ["barkswap-algebra"] },
  });

  assert.deepEqual(warnings.map((warning) => warning.code), [
    "non-executable-preview",
    "source-filter-active",
  ]);
});
```

- [ ] **Step 2: Run warning tests and confirm missing module failure**

Run:

```bash
node --test packages/aggregator/test/quoteWarnings.test.mjs
```

Expected:

```text
Cannot find module '../src/quoteWarnings.mjs'
```

- [ ] **Step 3: Implement warning helper**

Create `packages/aggregator/src/quoteWarnings.mjs`:

```js
const HIGH_PRICE_IMPACT_BPS = 300n;
const SHALLOW_LIQUIDITY_SHARE_BPS = 2_500n;

function toBigIntOrZero(value) {
  if (value === undefined || value === null || value === "") return 0n;
  return BigInt(value);
}

function hasSourceFilter({ includeSources = [], excludeSources = [] } = {}) {
  return includeSources.length > 0 || excludeSources.length > 0;
}

function liquidityShareBps(route) {
  const reserveIn = toBigIntOrZero(route.poolState?.reserveIn ?? route.reserveIn);
  const amountIn = toBigIntOrZero(route.amountIn);
  if (reserveIn <= 0n || amountIn <= 0n) return 0n;
  return (amountIn * 10_000n) / reserveIn;
}

export function buildRouteWarnings({ route, sourceFilters = {} }) {
  if (!route) return [];

  const warnings = [];
  const impact = toBigIntOrZero(route.priceImpactBps);

  if (route.status !== "active" || route.reason === "one-hop-execution-preview") {
    warnings.push({
      code: "non-executable-preview",
      severity: "info",
      message: "This route is quote intelligence only and will not be sent to a wallet.",
    });
  }

  if (impact >= HIGH_PRICE_IMPACT_BPS) {
    warnings.push({
      code: "high-price-impact",
      severity: "warning",
      message: `Price impact is ${impact} bps. Review route liquidity before signing.`,
    });
  }

  if (liquidityShareBps(route) >= SHALLOW_LIQUIDITY_SHARE_BPS) {
    warnings.push({
      code: "shallow-liquidity",
      severity: "warning",
      message: "Trade size is large relative to the live pool state.",
    });
  }

  if (hasSourceFilter(sourceFilters)) {
    warnings.push({
      code: "source-filter-active",
      severity: "info",
      message: "Source filters are active; best route is limited by the selected venues.",
    });
  }

  return warnings;
}
```

- [ ] **Step 4: Attach warnings in quote response**

In `packages/aggregator/src/quoteService.mjs`, import the helper:

```js
import { buildRouteWarnings } from "./quoteWarnings.mjs";
```

When building `best` and `alternatives`, merge route warnings:

```js
function withNormalizedWarnings(route, sourceFilters) {
  if (!route) return route;
  const normalized = buildRouteWarnings({ route, sourceFilters });
  return {
    ...route,
    warnings: [...(route.warnings ?? []), ...normalized],
  };
}
```

Use it after `withExecutionBounds`:

```js
const sourceFilters = { includeSources, excludeSources };
const best = routed.best
  ? withNormalizedWarnings(withExecutionBounds(routed.best, slippage), sourceFilters)
  : null;
const alternatives = routed.alternatives.map((route) =>
  withNormalizedWarnings(withExecutionBounds(route, slippage), sourceFilters),
);
```

Export the helper from `packages/aggregator/src/index.mjs`:

```js
export { buildRouteWarnings } from "./quoteWarnings.mjs";
```

- [ ] **Step 5: Run quote and API tests**

Run:

```bash
node --test packages/aggregator/test/quoteWarnings.test.mjs packages/api/test/handler.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/aggregator/src/quoteWarnings.mjs packages/aggregator/src/quoteService.mjs packages/aggregator/src/index.mjs packages/aggregator/test/quoteWarnings.test.mjs packages/api/test/handler.test.mjs
git commit -m "feat: normalize DogeOS route warnings"
```

## Task 6: Source Filter UX For Direct Venues

**Files:**
- Modify: `apps/web/src/index.html`
- Modify: `apps/web/src/app.js`
- Modify: `apps/web/src/styles.css`
- Test: `packages/web/test/staticApp.test.mjs`

- [ ] **Step 1: Add static app test for source filters**

Add to `packages/web/test/staticApp.test.mjs`:

```js
test("static web app sends selected source filters with quote requests", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const quoteBodies = [];
  const harness = createStaticAppHarness({
    quoteHandler: async (request) => {
      quoteBodies.push(JSON.parse(request.body));
      return jsonResponse(defaultQuoteResponse());
    },
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);

  harness.element("source-filter-muchfi-v2").checked = false;
  harness.element("source-filter-muchfi-v2").dispatchEvent({ type: "change" });
  await drainMicrotasks(32);

  const latest = quoteBodies.at(-1);
  assert.deepEqual(latest.excludeSources, ["muchfi-v2"]);
  assert.match(harness.element("route-scan-status").textContent, /source filter/i);
});
```

- [ ] **Step 2: Run static test and confirm missing element failure**

Run:

```bash
node --test packages/web/test/staticApp.test.mjs
```

Expected:

```text
Cannot set properties of undefined ... source-filter-muchfi-v2
```

- [ ] **Step 3: Add source filter markup**

In `apps/web/src/index.html`, add compact source filters near route scan or settings:

```html
<fieldset class="source-filter-panel" id="source-filter-panel">
  <legend>Sources</legend>
  <label>
    <input type="checkbox" id="source-filter-muchfi-v2" data-source-filter="muchfi-v2" checked />
    <span>MuchFi V2</span>
  </label>
  <label>
    <input type="checkbox" id="source-filter-muchfi-v3" data-source-filter="muchfi-v3" checked />
    <span>MuchFi V3</span>
  </label>
  <label>
    <input type="checkbox" id="source-filter-barkswap-algebra" data-source-filter="barkswap-algebra" checked />
    <span>Barkswap</span>
  </label>
</fieldset>
```

- [ ] **Step 4: Wire filters into quote body**

In `apps/web/src/app.js`, add state:

```js
sourceFilters: {
  muchfi-v2: true,
  muchfi-v3: true,
  barkswap-algebra: true,
},
```

Add helpers:

```js
function selectedSourceFilters() {
  const entries = Object.entries(state.sourceFilters);
  return {
    includeSources: [],
    excludeSources: entries
      .filter(([, enabled]) => !enabled)
      .map(([sourceId]) => sourceId),
  };
}
```

When building `/quote` body, include:

```js
const sourceFilters = selectedSourceFilters();
body.includeSources = sourceFilters.includeSources;
body.excludeSources = sourceFilters.excludeSources;
```

Add listeners:

```js
document.querySelectorAll("[data-source-filter]").forEach((input) => {
  input.addEventListener("change", () => {
    state.sourceFilters[input.dataset.sourceFilter] = input.checked;
    scheduleExactInputQuoteRefresh();
  });
});
```

- [ ] **Step 5: Style compact filters**

In `apps/web/src/styles.css`, add:

```css
.source-filter-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border: 1px solid var(--te-hair);
  border-radius: var(--radius-sm);
  padding: 8px;
}

.source-filter-panel legend {
  padding: 0 4px;
  color: var(--te-muted);
  font-size: 10px;
  text-transform: uppercase;
}

.source-filter-panel label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
```

- [ ] **Step 6: Run static tests**

Run:

```bash
node --test packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/web/src/index.html apps/web/src/app.js apps/web/src/styles.css packages/web/test/staticApp.test.mjs
git commit -m "feat: add DogeOS source filter controls"
```

## Task 7: Transaction Lifecycle, Receipt, Balance, And Notifications

**Files:**
- Modify: `apps/web/src/app.js`
- Modify: `apps/web/src/index.html`
- Modify: `apps/web/src/styles.css`
- Test: `packages/web/test/staticApp.test.mjs`

- [ ] **Step 1: Add lifecycle test for confirmed direct venue swap**

Add to `packages/web/test/staticApp.test.mjs`:

```js
test("static web app shows direct venue receipt notification and refreshes balances after confirmation", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const providerCalls = [];
  const swapHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const harness = createStaticAppHarness();

  harness.context.window.dogeosAggregatorWallet = {
    getChainId: () => "0x5fdaf3",
    getProvider: () => ({
      request: async (request) => {
        providerCalls.push(request);
        if (request.method === "eth_chainId") return "0x5fdaf3";
        if (request.method === "eth_accounts") return ["0x1111111111111111111111111111111111111111"];
        if (request.method === "eth_sendTransaction") return swapHash;
        if (request.method === "eth_getTransactionReceipt") {
          return {
            status: "0x1",
            transactionHash: swapHash,
            blockNumber: "0x51a681",
          };
        }
        if (request.method === "eth_call") {
          return `0x${0n.toString(16).padStart(64, "0")}`;
        }
        throw new Error(`Unexpected wallet method ${request.method}`);
      },
    }),
    switchToDogeOS: async () => true,
  };

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);
  harness.windowDispatch(new harness.context.CustomEvent("dogeos:sdk-wallet-updated", {
    detail: {
      address: "0x1111111111111111111111111111111111111111",
      chainId: "0x5fdaf3",
      chainType: "evm",
      hasProvider: true,
      isConnected: true,
    },
  }));
  await drainMicrotasks(16);

  harness.element("swap-button").dispatchEvent({ type: "click" });
  await drainMicrotasks(64);

  assert.match(harness.element("trade-notification").textContent, /Swap confirmed/i);
  assert.match(harness.element("trade-notification").innerHTML, /blockscout.testnet.dogeos.com\/tx/);
  assert.equal(providerCalls.some((call) => call.method === "eth_getTransactionReceipt"), true);
});
```

- [ ] **Step 2: Ensure lifecycle implementation is deterministic**

In `apps/web/src/app.js`, direct send flow must update these states:

```js
setTxFlowStep("Approval", approvalRequired ? "pending" : "skipped");
setTxFlowStep("Simulation", "complete");
setTxFlowStep("Wallet signature", "pending");
setTxFlowStep("Receipt", "pending");
setTxFlowStep("Balance refresh", "pending");
```

After successful receipt:

```js
showTradeNotification({
  status: "success",
  title: "Swap confirmed",
  detail: `${compactHash(receipt.transactionHash)} included at block ${formatBlockNumber(receipt.blockNumber)}.`,
  href: `${BLOCKSCOUT_BASE_URL}/tx/${receipt.transactionHash}`,
});
await refreshSelectedWalletBalances();
setTxFlowStep("Balance refresh", "complete");
```

On failed receipt:

```js
showTradeNotification({
  status: "error",
  title: "Swap failed",
  detail: `${compactHash(receipt.transactionHash)} was included but returned status 0.`,
  href: `${BLOCKSCOUT_BASE_URL}/tx/${receipt.transactionHash}`,
});
```

- [ ] **Step 3: Run static lifecycle tests**

Run:

```bash
node --test packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/web/src/app.js apps/web/src/index.html apps/web/src/styles.css packages/web/test/staticApp.test.mjs
git commit -m "feat: finalize direct swap lifecycle feedback"
```

## Task 8: Wallet Activity And Blockscout Provenance

**Files:**
- Modify: `apps/web/src/app.js`
- Modify: `apps/web/src/index.html`
- Modify: `packages/api/test/handler.test.mjs`
- Modify: `packages/web/test/staticApp.test.mjs`

- [ ] **Step 1: Add activity states test**

Add to `packages/web/test/staticApp.test.mjs`:

```js
test("static web app shows connected wallet DogeOS Blockscout activity states", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness({
    activityHandler: () =>
      jsonResponse({
        chainId: 6281971,
        address: "0x1111111111111111111111111111111111111111",
        source: "blockscout",
        blockscoutUrl: "https://blockscout.testnet.dogeos.com/api/v2/addresses/0x1111111111111111111111111111111111111111/transactions",
        data: [
          {
            hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            block: 5432788,
            timestamp: "2026-06-06T18:15:52Z",
            status: "ok",
          },
        ],
      }),
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(16);
  harness.windowDispatch(new harness.context.CustomEvent("dogeos:sdk-wallet-updated", {
    detail: {
      address: "0x1111111111111111111111111111111111111111",
      chainId: "0x5fdaf3",
      chainType: "evm",
      hasProvider: true,
      isConnected: true,
    },
  }));
  harness.element("nav-activity").dispatchEvent({ type: "click" });
  await drainMicrotasks(32);

  assert.match(harness.element("activity-status").textContent, /Blockscout/i);
  assert.match(harness.element("activity-list").innerHTML, /0xaaaa/);
});
```

- [ ] **Step 2: Ensure activity UI is tied to connected wallet**

In `apps/web/src/app.js`, activity refresh must no-op without a connected wallet:

```js
if (!state.walletAddress) {
  state.chainActivity = [];
  state.chainActivityError = "";
  elements.activityStatus.textContent = "Connect a DogeOS wallet to load Blockscout activity.";
  renderActivity();
  return;
}
```

When loading:

```js
elements.activityStatus.textContent = `Loading DogeOS Blockscout activity for ${compactAddress(state.walletAddress)}.`;
```

On success:

```js
elements.activityStatus.textContent = `Blockscout activity for ${compactAddress(state.walletAddress)}`;
```

On error:

```js
elements.activityStatus.textContent = `Blockscout activity unavailable: ${message}`;
```

- [ ] **Step 3: Run activity tests**

Run:

```bash
node --test packages/api/test/handler.test.mjs packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/web/src/app.js apps/web/src/index.html packages/api/test/handler.test.mjs packages/web/test/staticApp.test.mjs
git commit -m "feat: surface DogeOS wallet activity"
```

## Task 9: MyDoge Native Direct Execution Integration Document

**Files:**
- Create: `docs/mydoge-native-direct-execution.md`

- [ ] **Step 1: Create integration document**

Create `docs/mydoge-native-direct-execution.md`:

```markdown
# MyDoge Native Direct Execution Integration

## Summary

The aggregator can provide MyDoge native clients with quotes, approval transactions, swap transactions, chain status, venue provenance, and Blockscout links without requiring a custom aggregator router contract.

## Execution Model

`model = directVenue`

The wallet signs transactions that target verified external DogeOS DEX routers. The spender for ERC-20 approval is the selected venue router. The aggregator refreshes the selected quote and simulates exact calldata before returning a transaction.

## Required Calls

1. `GET /chain-status`
2. `GET /tokens`
3. `GET /venues`
4. `POST /quote`
5. `POST /approval`
6. `POST /swap`
7. Client signs approval if `approvalRequired = true`
8. Client signs swap transaction
9. Client polls receipt through wallet RPC or receives app-level confirmation

## Quote Request

```json
{
  "chainId": 6281971,
  "quoteMode": "exactInput",
  "sellToken": "0x...",
  "buyToken": "0x...",
  "amountIn": "1000000000000000000",
  "slippageBps": "50",
  "includeSources": [],
  "excludeSources": []
}
```

## Approval Response

```json
{
  "approvalRequired": true,
  "spender": "0xVenueRouter",
  "execution": {
    "model": "directVenue",
    "spender": "0xVenueRouter",
    "transactionTarget": "0xVenueRouter",
    "sourceId": "muchfi-v2",
    "chainId": 6281971
  },
  "transaction": {
    "to": "0xSellToken",
    "data": "0x095ea7b3...",
    "value": "0",
    "gas": "60000"
  }
}
```

## Swap Response

```json
{
  "execution": {
    "model": "directVenue",
    "executable": true,
    "spender": "0xVenueRouter",
    "transactionTarget": "0xVenueRouter",
    "sourceId": "muchfi-v2",
    "routeType": "direct",
    "chainId": 6281971,
    "blockscoutTransactionBaseUrl": "https://blockscout.testnet.dogeos.com/tx/"
  },
  "transaction": {
    "from": "0xWallet",
    "to": "0xVenueRouter",
    "data": "0x...",
    "value": "0",
    "gas": "144000",
    "chainId": 6281971
  },
  "verification": {
    "status": "simulated",
    "estimatedGas": "120000",
    "gasLimit": "144000",
    "dataFinalityFeeWei": "456"
  }
}
```

## Non-Executable Routes

If a route is one-hop, split, watchlist, read-only, rejected, stale, or missing simulation proof, native clients must not send it to a wallet.
```

- [ ] **Step 2: Commit document**

Run:

```bash
git add docs/mydoge-native-direct-execution.md
git commit -m "docs: define MyDoge direct execution integration"
```

## Task 10: Final Verification, Rendered QA, And Push

**Files:**
- Modify: no source code unless verification exposes a regression

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test packages/aggregator/test/approvalVerification.test.mjs packages/aggregator/test/quoteWarnings.test.mjs
node --test packages/api/test/handler.test.mjs
node --test packages/web/test/injectedWallet.test.mjs packages/web/test/sdkChainSwitch.test.mjs packages/web/test/server.test.mjs packages/web/test/viteConfig.test.mjs packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 2: Run full repository verification**

Run:

```bash
npm test
npm run build:web
```

Expected:

```text
# fail 0
✓ built
```

- [ ] **Step 3: Start local web server**

Run:

```bash
npm run dev:web
```

Expected:

```text
Local: http://127.0.0.1:8788/
```

If port `8788` is already used by the current app server, reuse it.

- [ ] **Step 4: Verify live DogeOS status**

Run:

```bash
curl -sS --max-time 12 http://127.0.0.1:8788/chain-status
```

Expected JSON fields:

```json
{
  "chainId": 6281971,
  "data": {
    "status": "live",
    "chainMatches": true,
    "rpcUrl": "https://rpc.testnet.dogeos.com",
    "blockscoutBaseUrl": "https://blockscout.testnet.dogeos.com"
  }
}
```

- [ ] **Step 5: Run rendered browser QA**

Use Playwright to verify:

```js
async (page) => {
  await page.goto("http://127.0.0.1:8788/");
  await page.waitForSelector("#chain-live-label");
  await page.locator("#nav-settings").click();
  await page.waitForSelector("#chain-status-panel");
  return {
    title: await page.title(),
    chain: await page.locator("#chain-live-label").innerText(),
    status: await page.locator("#chain-status-panel").innerText(),
  };
}
```

Expected:

```text
title includes DogeOS Aggregator
chain includes BLOCK
status includes DogeOS Chikyu Testnet live
console errors: 0
```

- [ ] **Step 6: Push branch**

Run:

```bash
git status -sb
git push origin codex/dogeos-aggregator-revamp
```

Expected:

```text
To github.com:worldofhacks/dogeos.git
```

## Self-Review

- Every direct venue acceptance criterion has a task.
- The plan preserves direct external venue router execution and does not introduce an owned DEX or custom router.
- The API/native integration surface is explicit about spender, target, execution model, and non-executable route states.
- Wallet, approval, swap, receipt, balance, activity, source warning, and GitHub publication gaps are covered.
