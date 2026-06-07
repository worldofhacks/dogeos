# Atomic Split And Multi-Hop Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe DogeOS aggregator execution router that can atomically execute split and multi-hop routes after direct venue execution is stable and the MyDoge/DogeOS integration model requires one aggregator spender or transaction target.

**Architecture:** The route engine produces split and multi-hop route plans with typed legs. A minimal audited Solidity executor accepts only typed adapter legs for verified DogeOS venue routers, pulls exact input from the user, performs exact approvals to venue routers, executes all legs atomically, enforces total minimum output, refunds dust, and reverts the full transaction if any leg fails.

**Tech Stack:** Foundry for Solidity contracts/tests, Node.js ESM route planning/API, explicit ABI encoding with `viem`, DogeOS RPC, DogeOS Blockscout verification, DogeOS data/finality fee estimator, Playwright rendered QA.

---

## Gap Analysis

| Area | Current state | Gap | Implementation task |
| --- | --- | --- | --- |
| Contract toolchain | The repo has no Solidity files, Foundry config, Hardhat config, or contract tests. | Atomic split/multi-hop needs an on-chain executor package, tests, deployment, and verification workflow. | Task 1 |
| Threat model | Current docs intentionally avoid custom router execution. | A single spender/target contract introduces approval risk, adapter risk, external call risk, reentrancy, pause/ownership, slippage, and partial-fill failure modes. | Task 2 |
| Route model | Direct routes are selected from flat candidates; one-hop candidates exist as read-only previews. | Atomic execution needs typed legs, split allocations, route groups, intermediate-token accounting, and total output enforcement. | Task 3 |
| Split optimizer | Direct route scoring exists. | Need split search that only proposes splits when net output improves after extra gas, data/finality fee, and failure-risk penalties. | Task 4 |
| Multi-hop optimizer | WDOGE one-hop preview exists for exact-input only. | Need executable multi-hop route plan generation with typed legs and amount propagation. | Task 5 |
| Executor contract | No aggregator execution router exists. | Need a minimal typed executor with no arbitrary calldata, no pool creation, no liquidity management, no DEX ownership, pause controls, and whitelisted routers. | Task 6 |
| Contract tests | No contract test harness exists. | Need mock ERC-20s and mock venue routers proving atomicity, slippage, approvals, failure reverts, refund behavior, and no arbitrary selector execution. | Task 7 |
| API calldata builder | `/swap` currently builds venue router calldata only. | Need executor calldata builder, route proof validation, spender switch from venue router to executor, and exact data/finality fee calculation for full executor calldata. | Task 8 |
| Verification/provenance | Source verification covers venue routers, quoters, factories, pools, and ABI artifacts. | Need executor bytecode, ABI, Blockscout verification, deployment metadata, owner/guardian/pause status, and version checks. | Task 9 |
| UI/native UX | Route scan can show read-only one-hop preview. | Need clear distinction between direct venue, atomic executor preview, and atomic executor executable route, including approval spender changes. | Task 10 |
| Deployment and audit | Current scripts verify sources, discover liquidity, and create ABI artifacts. | Need deployment runbook, testnet verification, audit checklist, kill switch operations, and MyDoge integration signoff before enabling executable split routes. | Task 11 |

## File Map

| File | Responsibility in this plan |
| --- | --- |
| `foundry.toml` | Foundry configuration for Solidity contract compilation and tests. |
| `contracts/src/DogeOsSwapExecutor.sol` | Minimal atomic exact-input executor for typed DogeOS venue legs. |
| `contracts/src/interfaces/IERC20Minimal.sol` | ERC-20 interface used by executor. |
| `contracts/src/libraries/SafeTransferLib.sol` | Minimal safe ERC-20 transfer/approve helper. |
| `contracts/test/DogeOsSwapExecutor.t.sol` | Contract unit tests for atomic split/multi-hop execution. |
| `contracts/test/mocks/MockERC20.sol` | ERC-20 mock for tests. |
| `contracts/test/mocks/MockVenueRouter.sol` | Router mock that can pass/fail and emulate V2/V3/Algebra output behavior. |
| `contracts/script/DeployDogeOsSwapExecutor.s.sol` | Testnet deployment script after security review. |
| `packages/aggregator/src/routes/legs.mjs` | Canonical JS route leg model and validation helpers. |
| `packages/aggregator/src/routes/split.mjs` | Split-route candidate generation and scoring. |
| `packages/aggregator/src/routes/multiHop.mjs` | Executable multi-hop exact-input plan generation. |
| `packages/aggregator/src/swap/executorAbi.mjs` | ABI and encoder for `DogeOsSwapExecutor.executeExactInput`. |
| `packages/aggregator/src/swap/executorCalldataBuilder.mjs` | Builds atomic executor calldata from verified route plans. |
| `packages/aggregator/src/swap/executorVerification.mjs` | Validates configured executor address, bytecode, ABI artifact, owner, pause state, and Blockscout links. |
| `packages/aggregator/src/sources/registry.mjs` | Adds executor configuration only after testnet deployment and verification. |
| `packages/api/src/handler.mjs` | Allows `/approval` and `/swap` to use executor spender/target only for verified atomic route plans. |
| `packages/api/src/live.mjs` | Wires executor verification and calldata builder behind configuration flags. |
| `apps/web/src/app.js` | Displays atomic executor route model, spender, warnings, and lifecycle states. |
| `docs/dogeos-atomic-executor-threat-model.md` | Contract and integration threat model. |
| `docs/dogeos-atomic-executor-runbook.md` | Deployment, verification, rollback, and MyDoge integration runbook. |

## Task 1: Add Solidity Toolchain Without Enabling Execution

**Files:**
- Create: `foundry.toml`
- Create: `contracts/src/.gitkeep`
- Create: `contracts/test/.gitkeep`
- Modify: `package.json`

- [ ] **Step 1: Confirm there is no existing contract package**

Run:

```bash
find . -maxdepth 3 \( -name 'foundry.toml' -o -name 'hardhat.config.*' -o -name '*.sol' \) -print
```

Expected:

```text
```

No output means the repo currently has no contract toolchain.

- [ ] **Step 2: Add Foundry config**

Create `foundry.toml`:

```toml
[profile.default]
src = "contracts/src"
test = "contracts/test"
script = "contracts/script"
out = "contracts/out"
libs = ["contracts/lib"]
solc_version = "0.8.26"
optimizer = true
optimizer_runs = 200
evm_version = "cancun"
fs_permissions = [{ access = "read", path = "./" }]
```

Create directories:

```bash
mkdir -p contracts/src contracts/test contracts/script contracts/lib
touch contracts/src/.gitkeep contracts/test/.gitkeep
```

- [ ] **Step 3: Add npm contract scripts**

Modify `package.json` scripts:

```json
{
  "test:contracts": "forge test -vvv",
  "build:contracts": "forge build"
}
```

Keep the existing `npm test` command as Node-only. Contract tests are run explicitly with `npm run test:contracts`.

- [ ] **Step 4: Verify Foundry availability**

Run:

```bash
forge --version
```

Expected:

```text
forge Version: ...
```

If `forge` is not installed, install Foundry before implementing contract tasks. Do not replace this plan with Hardhat unless the repository owner chooses that toolchain.

- [ ] **Step 5: Run empty build**

Run:

```bash
npm run build:contracts
```

Expected:

```text
No files changed, compilation skipped
```

- [ ] **Step 6: Commit**

Run:

```bash
git add foundry.toml contracts/src/.gitkeep contracts/test/.gitkeep package.json
git commit -m "chore: add DogeOS executor contract toolchain"
```

## Task 2: Threat Model And Router Acceptance Gates

**Files:**
- Create: `docs/dogeos-atomic-executor-threat-model.md`
- Create: `docs/dogeos-atomic-executor-runbook.md`

- [ ] **Step 1: Write threat model**

Create `docs/dogeos-atomic-executor-threat-model.md`:

```markdown
# DogeOS Atomic Executor Threat Model

## Assets

- User ERC-20 balances approved to the executor.
- Intermediate tokens held by the executor during an atomic swap.
- Final output token delivered to the recipient.
- Executor router allowlist and pause state.
- Aggregator API route plans and calldata.

## Trust Boundaries

- Browser or native app to aggregator API.
- Aggregator API to DogeOS RPC.
- User wallet to executor contract.
- Executor contract to external venue routers.
- Executor contract to ERC-20 tokens.

## Allowed Execution

The executor may call only typed adapter flows for verified DogeOS venue routers. It must not accept arbitrary calldata from the user or API.

## Disallowed Execution

- Pool creation.
- Liquidity minting or burning.
- Arbitrary router selectors.
- Delegatecall.
- External calls to unapproved venue routers.
- Holding user funds after a successful transaction except dust that is immediately refunded.

## Main Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| User approves malicious spender | Executor address is verified on Blockscout and surfaced in UI/native API. |
| Arbitrary calldata drains funds | Executor uses typed legs and allowlisted routers only. |
| One failed leg leaves partial state | Full transaction reverts atomically. |
| Slippage on one leg drains route output | Per-leg minimum output and total minimum output are enforced. |
| Reentrancy through token or router | Executor uses nonReentrant guard and zeroes approvals after each leg. |
| Stale API route | Contract enforces deadline and API refreshes route before calldata. |
| Fee overhead erases split benefit | Route optimizer includes execution gas and DogeOS data/finality fee. |
| Admin abuse | Owner can pause and update allowlist; ownership and pause state are public and monitored. |
| MyDoge native integration points at stale executor | API exposes executor version, address, bytecode hash, and Blockscout URL. |

## Launch Gate

Executable atomic routes remain disabled until all contract tests pass, testnet deployment is verified on Blockscout, executor state is surfaced by `/verification`, and MyDoge/DogeOS stakeholders confirm the executor-spender integration model.
```

- [ ] **Step 2: Write runbook**

Create `docs/dogeos-atomic-executor-runbook.md`:

```markdown
# DogeOS Atomic Executor Runbook

## Pre-Deployment

1. `npm test`
2. `npm run build:web`
3. `npm run build:contracts`
4. `npm run test:contracts`
5. Verify active venue router addresses against `packages/aggregator/src/sources/registry.mjs`.
6. Confirm executor does not expose pool creation, liquidity management, or arbitrary calldata execution.

## Deployment

Deploy only to DogeOS Chikyu testnet first. Record:

- Executor address.
- Constructor router allowlist.
- Owner address.
- Guardian/pause authority.
- Bytecode hash.
- ABI hash.
- Blockscout contract URL.

## Post-Deployment Verification

1. Confirm bytecode exists through DogeOS RPC.
2. Confirm Blockscout contract page resolves.
3. Confirm allowlisted routers match active venue routers.
4. Confirm pause state is false.
5. Run a tiny testnet exact-input direct route through the executor.
6. Run a tiny split route through the executor.
7. Confirm receipts and balances through Blockscout.

## Rollback

1. Pause executor.
2. Disable `DOGEOS_EXECUTOR_ADDRESS` in API runtime configuration.
3. Revert UI to direct venue execution only.
4. Keep `/venues` and `/verification` showing executor disabled state.
```

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/dogeos-atomic-executor-threat-model.md docs/dogeos-atomic-executor-runbook.md
git commit -m "docs: define DogeOS atomic executor security gates"
```

## Task 3: Canonical Route Leg Model

**Files:**
- Create: `packages/aggregator/src/routes/legs.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Test: `packages/aggregator/test/routeLegs.test.mjs`

- [ ] **Step 1: Write leg validation tests**

Create `packages/aggregator/test/routeLegs.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRouteLeg, normalizeRoutePlan } from "../src/routes/legs.mjs";

const usdc = "0x1111111111111111111111111111111111111111";
const wdoge = "0x2222222222222222222222222222222222222222";
const usdt = "0x3333333333333333333333333333333333333333";
const router = "0x4444444444444444444444444444444444444444";

test("normalizeRouteLeg creates a typed direct venue leg", () => {
  assert.deepEqual(
    normalizeRouteLeg({
      adapterType: "v2",
      sourceId: "muchfi-v2",
      router,
      sellToken: usdc,
      buyToken: wdoge,
      amountIn: "1000",
      minAmountOut: "900",
      path: [usdc, wdoge],
    }),
    {
      adapterType: "v2",
      sourceId: "muchfi-v2",
      router,
      sellToken: usdc,
      buyToken: wdoge,
      amountIn: 1000n,
      minAmountOut: 900n,
      path: [usdc, wdoge],
      feeTier: null,
      deployer: null,
    },
  );
});

test("normalizeRoutePlan validates multi-hop token continuity", () => {
  const plan = normalizeRoutePlan({
    executionModel: "atomicExecutorPreview",
    routeType: "multiHop",
    sellToken: usdc,
    buyToken: usdt,
    amountIn: "1000",
    minAmountOut: "800",
    legs: [
      { adapterType: "v2", sourceId: "muchfi-v2", router, sellToken: usdc, buyToken: wdoge, amountIn: "1000", minAmountOut: "900", path: [usdc, wdoge] },
      { adapterType: "v2", sourceId: "muchfi-v2", router, sellToken: wdoge, buyToken: usdt, amountIn: "900", minAmountOut: "800", path: [wdoge, usdt] },
    ],
  });

  assert.equal(plan.routeType, "multiHop");
  assert.equal(plan.legs.length, 2);
});

test("normalizeRoutePlan rejects broken multi-hop continuity", () => {
  assert.throws(
    () =>
      normalizeRoutePlan({
        executionModel: "atomicExecutorPreview",
        routeType: "multiHop",
        sellToken: usdc,
        buyToken: usdt,
        amountIn: "1000",
        minAmountOut: "800",
        legs: [
          { adapterType: "v2", sourceId: "muchfi-v2", router, sellToken: usdc, buyToken: wdoge, amountIn: "1000", minAmountOut: "900", path: [usdc, wdoge] },
          { adapterType: "v2", sourceId: "muchfi-v2", router, sellToken: usdc, buyToken: usdt, amountIn: "900", minAmountOut: "800", path: [usdc, usdt] },
        ],
      }),
    /multi-hop leg 1 sellToken must match previous buyToken/i,
  );
});
```

- [ ] **Step 2: Run tests and confirm missing module failure**

Run:

```bash
node --test packages/aggregator/test/routeLegs.test.mjs
```

Expected:

```text
Cannot find module '../src/routes/legs.mjs'
```

- [ ] **Step 3: Implement leg model**

Create `packages/aggregator/src/routes/legs.mjs`:

```js
const ADAPTER_TYPES = new Set(["v2", "muchfiV3", "barkswapAlgebra"]);
const ROUTE_TYPES = new Set(["direct", "multiHop", "split"]);
const EXECUTION_MODELS = new Set(["directVenue", "atomicExecutorPreview", "atomicExecutor"]);

function assertAddress(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""))) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return String(value);
}

function positiveBigInt(value, fieldName) {
  const normalized = BigInt(value);
  if (normalized <= 0n) throw new Error(`${fieldName} must be greater than zero.`);
  return normalized;
}

function normalizeAddressArray(value, fieldName) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${fieldName} must contain at least two addresses.`);
  }
  return value.map((address, index) => assertAddress(address, `${fieldName}[${index}]`));
}

export function normalizeRouteLeg(leg) {
  const adapterType = String(leg?.adapterType ?? "");
  if (!ADAPTER_TYPES.has(adapterType)) throw new Error(`Unsupported adapterType ${adapterType}.`);

  return {
    adapterType,
    sourceId: String(leg.sourceId ?? ""),
    router: assertAddress(leg.router, "leg.router"),
    sellToken: assertAddress(leg.sellToken, "leg.sellToken"),
    buyToken: assertAddress(leg.buyToken, "leg.buyToken"),
    amountIn: positiveBigInt(leg.amountIn, "leg.amountIn"),
    minAmountOut: positiveBigInt(leg.minAmountOut, "leg.minAmountOut"),
    path: leg.path ? normalizeAddressArray(leg.path, "leg.path") : [leg.sellToken, leg.buyToken],
    feeTier: leg.feeTier === undefined || leg.feeTier === null ? null : positiveBigInt(leg.feeTier, "leg.feeTier"),
    deployer: leg.deployer === undefined || leg.deployer === null ? null : assertAddress(leg.deployer, "leg.deployer"),
  };
}

function assertMultiHopContinuity(legs) {
  for (let index = 1; index < legs.length; index += 1) {
    if (legs[index].sellToken.toLowerCase() !== legs[index - 1].buyToken.toLowerCase()) {
      throw new Error(`multi-hop leg ${index} sellToken must match previous buyToken.`);
    }
  }
}

export function normalizeRoutePlan(plan) {
  const routeType = String(plan?.routeType ?? "");
  const executionModel = String(plan?.executionModel ?? "");
  if (!ROUTE_TYPES.has(routeType)) throw new Error(`Unsupported routeType ${routeType}.`);
  if (!EXECUTION_MODELS.has(executionModel)) throw new Error(`Unsupported executionModel ${executionModel}.`);

  const legs = (Array.isArray(plan.legs) ? plan.legs : []).map(normalizeRouteLeg);
  if (legs.length === 0) throw new Error("route plan requires at least one leg.");
  if (routeType === "multiHop") assertMultiHopContinuity(legs);

  return {
    executionModel,
    routeType,
    sellToken: assertAddress(plan.sellToken, "plan.sellToken"),
    buyToken: assertAddress(plan.buyToken, "plan.buyToken"),
    amountIn: positiveBigInt(plan.amountIn, "plan.amountIn"),
    minAmountOut: positiveBigInt(plan.minAmountOut, "plan.minAmountOut"),
    legs,
  };
}
```

Export from `packages/aggregator/src/index.mjs`:

```js
export { normalizeRouteLeg, normalizeRoutePlan } from "./routes/legs.mjs";
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test packages/aggregator/test/routeLegs.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/routes/legs.mjs packages/aggregator/src/index.mjs packages/aggregator/test/routeLegs.test.mjs
git commit -m "feat: add atomic route leg model"
```

## Task 4: Split Route Optimizer As Readiness Intelligence

**Files:**
- Create: `packages/aggregator/src/routes/split.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Test: `packages/aggregator/test/splitRoutes.test.mjs`

- [ ] **Step 1: Write split optimizer tests**

Create `packages/aggregator/test/splitRoutes.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { buildSplitRouteCandidates } from "../src/routes/split.mjs";

function route(sourceId, amountIn, amountOut, gasUnits = 120000n) {
  return {
    status: "active",
    routeType: "direct",
    quoteMode: "exactInput",
    sourceId,
    sellToken: "0x1111111111111111111111111111111111111111",
    buyToken: "0x2222222222222222222222222222222222222222",
    amountIn,
    amountOut,
    minAmountOut: amountOut - 1n,
    gasUnits,
    dataFinalityFeeWei: 100n,
    quoteTimestampMs: 1000,
    ttlMs: 10000,
  };
}

test("buildSplitRouteCandidates returns read-only split intelligence with typed legs", () => {
  const candidates = buildSplitRouteCandidates({
    routesByAllocation: [
      [route("muchfi-v2", 700n, 760n), route("barkswap-algebra", 300n, 330n)],
    ],
    totalAmountIn: 1000n,
    minNetImprovementBps: 1n,
    bestDirectAmountOut: 1000n,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "readOnly");
  assert.equal(candidates[0].reason, "split-execution-preview");
  assert.equal(candidates[0].amountOut, 1090n);
  assert.equal(candidates[0].legs.length, 2);
});

test("buildSplitRouteCandidates rejects splits that do not improve direct route output", () => {
  const candidates = buildSplitRouteCandidates({
    routesByAllocation: [
      [route("muchfi-v2", 500n, 500n), route("barkswap-algebra", 500n, 499n)],
    ],
    totalAmountIn: 1000n,
    minNetImprovementBps: 1n,
    bestDirectAmountOut: 1000n,
  });

  assert.equal(candidates.length, 0);
});
```

- [ ] **Step 2: Run tests and confirm missing module failure**

Run:

```bash
node --test packages/aggregator/test/splitRoutes.test.mjs
```

Expected:

```text
Cannot find module '../src/routes/split.mjs'
```

- [ ] **Step 3: Implement split route builder**

Create `packages/aggregator/src/routes/split.mjs`:

```js
function total(routes, key) {
  return routes.reduce((sum, route) => sum + BigInt(route[key] ?? 0n), 0n);
}

function improvementBps({ amountOut, bestDirectAmountOut }) {
  if (bestDirectAmountOut <= 0n || amountOut <= bestDirectAmountOut) return 0n;
  return ((amountOut - bestDirectAmountOut) * 10_000n) / bestDirectAmountOut;
}

function splitLeg(route) {
  return {
    adapterType:
      route.protocolType === "algebra"
        ? "barkswapAlgebra"
        : route.protocolType === "v3"
          ? "muchfiV3"
          : "v2",
    sourceId: route.sourceId,
    router: route.router,
    sellToken: route.sellToken,
    buyToken: route.buyToken,
    amountIn: route.amountIn,
    minAmountOut: route.minAmountOut ?? route.minimumOutput,
    path: route.path ?? [route.sellToken, route.buyToken],
    feeTier: route.feeTier ?? null,
    deployer: route.deployer ?? null,
  };
}

export function buildSplitRouteCandidates({
  routesByAllocation,
  totalAmountIn,
  bestDirectAmountOut,
  minNetImprovementBps = 25n,
}) {
  return routesByAllocation.flatMap((routes) => {
    const amountIn = total(routes, "amountIn");
    const amountOut = total(routes, "amountOut");
    if (amountIn !== totalAmountIn) return [];
    if (improvementBps({ amountOut, bestDirectAmountOut }) < minNetImprovementBps) return [];

    return [{
      status: "readOnly",
      reason: "split-execution-preview",
      routeType: "split",
      executionModel: "atomicExecutorPreview",
      sourceId: routes.map((route) => route.sourceId).join("+"),
      sellToken: routes[0].sellToken,
      buyToken: routes[0].buyToken,
      amountIn,
      amountOut,
      minAmountOut: total(routes, "minAmountOut"),
      gasUnits: total(routes, "gasUnits"),
      dataFinalityFeeWei: total(routes, "dataFinalityFeeWei"),
      quoteTimestampMs: Math.min(...routes.map((route) => Number(route.quoteTimestampMs))),
      ttlMs: Math.min(...routes.map((route) => Number(route.ttlMs))),
      legs: routes.map(splitLeg),
      warnings: [{
        code: "atomic-executor-required",
        severity: "info",
        message: "Split route requires verified atomic executor before wallet execution.",
      }],
    }];
  });
}
```

Export from `packages/aggregator/src/index.mjs`:

```js
export { buildSplitRouteCandidates } from "./routes/split.mjs";
```

- [ ] **Step 4: Run split tests**

Run:

```bash
node --test packages/aggregator/test/splitRoutes.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/routes/split.mjs packages/aggregator/src/index.mjs packages/aggregator/test/splitRoutes.test.mjs
git commit -m "feat: add split route intelligence"
```

## Task 5: Executable Multi-Hop Plan Generation

**Files:**
- Create: `packages/aggregator/src/routes/multiHop.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Test: `packages/aggregator/test/multiHopRoutes.test.mjs`

- [ ] **Step 1: Write multi-hop tests**

Create `packages/aggregator/test/multiHopRoutes.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { composeAtomicMultiHopCandidate } from "../src/routes/multiHop.mjs";

const usdc = "0x1111111111111111111111111111111111111111";
const wdoge = "0x2222222222222222222222222222222222222222";
const usdt = "0x3333333333333333333333333333333333333333";
const router = "0x4444444444444444444444444444444444444444";

function leg(sourceId, sellToken, buyToken, amountIn, amountOut) {
  return {
    status: "active",
    protocolType: "v2",
    sourceId,
    router,
    sellToken,
    buyToken,
    amountIn,
    amountOut,
    minAmountOut: amountOut - 1n,
    gasUnits: 120000n,
    dataFinalityFeeWei: 100n,
    quoteTimestampMs: 1000,
    ttlMs: 10000,
  };
}

test("composeAtomicMultiHopCandidate creates atomic executor preview from continuous legs", () => {
  const candidate = composeAtomicMultiHopCandidate({
    legs: [
      leg("muchfi-v2", usdc, wdoge, 1000n, 900n),
      leg("muchfi-v2", wdoge, usdt, 900n, 800n),
    ],
  });

  assert.equal(candidate.status, "readOnly");
  assert.equal(candidate.routeType, "multiHop");
  assert.equal(candidate.executionModel, "atomicExecutorPreview");
  assert.equal(candidate.amountIn, 1000n);
  assert.equal(candidate.amountOut, 800n);
  assert.equal(candidate.legs.length, 2);
});

test("composeAtomicMultiHopCandidate rejects discontinuous legs", () => {
  assert.throws(
    () =>
      composeAtomicMultiHopCandidate({
        legs: [
          leg("muchfi-v2", usdc, wdoge, 1000n, 900n),
          leg("muchfi-v2", usdc, usdt, 900n, 800n),
        ],
      }),
    /sellToken must match previous buyToken/i,
  );
});
```

- [ ] **Step 2: Run tests and confirm missing module failure**

Run:

```bash
node --test packages/aggregator/test/multiHopRoutes.test.mjs
```

Expected:

```text
Cannot find module '../src/routes/multiHop.mjs'
```

- [ ] **Step 3: Implement multi-hop candidate composer**

Create `packages/aggregator/src/routes/multiHop.mjs`:

```js
function sum(legs, key) {
  return legs.reduce((total, leg) => total + BigInt(leg[key] ?? 0n), 0n);
}

function assertContinuity(legs) {
  for (let index = 1; index < legs.length; index += 1) {
    if (legs[index].sellToken.toLowerCase() !== legs[index - 1].buyToken.toLowerCase()) {
      throw new Error(`leg ${index} sellToken must match previous buyToken.`);
    }
    if (BigInt(legs[index].amountIn) !== BigInt(legs[index - 1].amountOut)) {
      throw new Error(`leg ${index} amountIn must match previous amountOut.`);
    }
  }
}

function adapterTypeFor(leg) {
  if (leg.protocolType === "algebra") return "barkswapAlgebra";
  if (leg.protocolType === "v3") return "muchfiV3";
  return "v2";
}

function typedLeg(leg) {
  return {
    adapterType: adapterTypeFor(leg),
    sourceId: leg.sourceId,
    router: leg.router,
    sellToken: leg.sellToken,
    buyToken: leg.buyToken,
    amountIn: leg.amountIn,
    minAmountOut: leg.minAmountOut ?? leg.minimumOutput,
    path: leg.path ?? [leg.sellToken, leg.buyToken],
    feeTier: leg.feeTier ?? null,
    deployer: leg.deployer ?? null,
  };
}

export function composeAtomicMultiHopCandidate({ legs }) {
  if (!Array.isArray(legs) || legs.length < 2) {
    throw new Error("multi-hop candidate requires at least two legs.");
  }
  assertContinuity(legs);

  const first = legs[0];
  const last = legs[legs.length - 1];
  return {
    status: "readOnly",
    reason: "multi-hop-execution-preview",
    routeType: "multiHop",
    executionModel: "atomicExecutorPreview",
    sourceId: legs.map((leg) => leg.sourceId).join("+"),
    sellToken: first.sellToken,
    buyToken: last.buyToken,
    amountIn: first.amountIn,
    amountOut: last.amountOut,
    minAmountOut: last.minAmountOut ?? last.minimumOutput,
    gasUnits: sum(legs, "gasUnits"),
    dataFinalityFeeWei: sum(legs, "dataFinalityFeeWei"),
    quoteTimestampMs: Math.min(...legs.map((leg) => Number(leg.quoteTimestampMs))),
    ttlMs: Math.min(...legs.map((leg) => Number(leg.ttlMs))),
    legs: legs.map(typedLeg),
    warnings: [{
      code: "atomic-executor-required",
      severity: "info",
      message: "Multi-hop route requires verified atomic executor before wallet execution.",
    }],
  };
}
```

Export from `packages/aggregator/src/index.mjs`:

```js
export { composeAtomicMultiHopCandidate } from "./routes/multiHop.mjs";
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test packages/aggregator/test/multiHopRoutes.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/routes/multiHop.mjs packages/aggregator/src/index.mjs packages/aggregator/test/multiHopRoutes.test.mjs
git commit -m "feat: add atomic multi-hop route plans"
```

## Task 6: Minimal Typed Executor Contract

**Files:**
- Create: `contracts/src/interfaces/IERC20Minimal.sol`
- Create: `contracts/src/libraries/SafeTransferLib.sol`
- Create: `contracts/src/DogeOsSwapExecutor.sol`

- [ ] **Step 1: Create minimal ERC-20 interface**

Create `contracts/src/interfaces/IERC20Minimal.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}
```

- [ ] **Step 2: Create safe transfer library**

Create `contracts/src/libraries/SafeTransferLib.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

library SafeTransferLib {
    error TransferFailed();
    error TransferFromFailed();
    error ApproveFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0xa9059cbb, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x23b872dd, from, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFromFailed();
        }
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(0x095ea7b3, spender, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ApproveFailed();
        }
    }
}
```

- [ ] **Step 3: Create typed executor contract**

Create `contracts/src/DogeOsSwapExecutor.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20Minimal} from "./interfaces/IERC20Minimal.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

contract DogeOsSwapExecutor {
    using SafeTransferLib for address;

    enum AdapterType {
        V2,
        MuchFiV3,
        BarkswapAlgebra
    }

    struct Leg {
        AdapterType adapterType;
        address router;
        address sellToken;
        address buyToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address[] path;
        uint24 feeTier;
        address deployer;
    }

    struct ExactInputPlan {
        address sellToken;
        address buyToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        Leg[] legs;
    }

    error NotOwner();
    error Paused();
    error Expired();
    error InvalidLeg();
    error RouterNotAllowed(address router);
    error InsufficientOutput(uint256 actual, uint256 required);
    error Reentrant();

    address public owner;
    bool public paused;
    uint256 private locked;
    mapping(address => bool) public allowedRouter;

    event OwnerUpdated(address indexed owner);
    event PausedUpdated(bool paused);
    event RouterAllowed(address indexed router, bool allowed);
    event ExactInputExecuted(address indexed sender, address indexed recipient, address sellToken, address buyToken, uint256 amountIn, uint256 amountOut);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked == 1) revert Reentrant();
        locked = 1;
        _;
        locked = 0;
    }

    constructor(address[] memory routers, address initialOwner) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        emit OwnerUpdated(owner);
        for (uint256 index = 0; index < routers.length; index++) {
            allowedRouter[routers[index]] = true;
            emit RouterAllowed(routers[index], true);
        }
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PausedUpdated(nextPaused);
    }

    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        allowedRouter[router] = allowed;
        emit RouterAllowed(router, allowed);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        owner = nextOwner;
        emit OwnerUpdated(nextOwner);
    }

    function executeExactInput(ExactInputPlan calldata plan) external nonReentrant returns (uint256 amountOut) {
        if (paused) revert Paused();
        if (block.timestamp > plan.deadline) revert Expired();
        if (plan.legs.length == 0) revert InvalidLeg();

        uint256 outputBefore = IERC20Minimal(plan.buyToken).balanceOf(address(this));
        plan.sellToken.safeTransferFrom(msg.sender, address(this), plan.amountIn);

        for (uint256 index = 0; index < plan.legs.length; index++) {
            _executeLeg(plan.legs[index]);
        }

        amountOut = IERC20Minimal(plan.buyToken).balanceOf(address(this)) - outputBefore;
        if (amountOut < plan.minAmountOut) revert InsufficientOutput(amountOut, plan.minAmountOut);

        plan.buyToken.safeTransfer(plan.recipient, amountOut);
        _refundDust(plan.sellToken, msg.sender);

        emit ExactInputExecuted(msg.sender, plan.recipient, plan.sellToken, plan.buyToken, plan.amountIn, amountOut);
    }

    function _executeLeg(Leg calldata leg) internal {
        if (!allowedRouter[leg.router]) revert RouterNotAllowed(leg.router);
        if (leg.amountIn == 0 || leg.minAmountOut == 0) revert InvalidLeg();

        leg.sellToken.safeApprove(leg.router, 0);
        leg.sellToken.safeApprove(leg.router, leg.amountIn);

        if (leg.adapterType == AdapterType.V2) {
            _callV2(leg);
        } else if (leg.adapterType == AdapterType.MuchFiV3) {
            _callMuchFiV3(leg);
        } else if (leg.adapterType == AdapterType.BarkswapAlgebra) {
            _callBarkswapAlgebra(leg);
        } else {
            revert InvalidLeg();
        }

        leg.sellToken.safeApprove(leg.router, 0);
    }

    function _callV2(Leg calldata leg) internal {
        if (leg.path.length < 2) revert InvalidLeg();
        (bool success, bytes memory data) = leg.router.call(
            abi.encodeWithSelector(
                0x38ed1739,
                leg.amountIn,
                leg.minAmountOut,
                leg.path,
                address(this),
                block.timestamp
            )
        );
        if (!success) assembly { revert(add(data, 32), mload(data)) }
    }

    function _callMuchFiV3(Leg calldata leg) internal {
        (bool success, bytes memory data) = leg.router.call(
            abi.encodeWithSelector(
                0x04e45aaf,
                leg.sellToken,
                leg.buyToken,
                leg.feeTier,
                address(this),
                leg.amountIn,
                leg.minAmountOut,
                uint160(0)
            )
        );
        if (!success) assembly { revert(add(data, 32), mload(data)) }
    }

    function _callBarkswapAlgebra(Leg calldata leg) internal {
        (bool success, bytes memory data) = leg.router.call(
            abi.encodeWithSelector(
                0x1679c792,
                leg.sellToken,
                leg.buyToken,
                leg.deployer,
                address(this),
                block.timestamp,
                leg.amountIn,
                leg.minAmountOut,
                uint160(0)
            )
        );
        if (!success) assembly { revert(add(data, 32), mload(data)) }
    }

    function _refundDust(address token, address recipient) internal {
        uint256 balance = IERC20Minimal(token).balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(recipient, balance);
        }
    }
}
```

- [ ] **Step 4: Build contracts**

Run:

```bash
npm run build:contracts
```

Expected:

```text
Compiler run successful
```

- [ ] **Step 5: Commit**

Run:

```bash
git add contracts/src/interfaces/IERC20Minimal.sol contracts/src/libraries/SafeTransferLib.sol contracts/src/DogeOsSwapExecutor.sol
git commit -m "feat: add DogeOS atomic swap executor"
```

## Task 7: Contract Tests For Atomic Safety

**Files:**
- Create: `contracts/test/mocks/MockERC20.sol`
- Create: `contracts/test/mocks/MockVenueRouter.sol`
- Create: `contracts/test/DogeOsSwapExecutor.t.sol`

- [ ] **Step 1: Create token mock**

Create `contracts/test/mocks/MockERC20.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
```

- [ ] **Step 2: Create venue router mock**

Create `contracts/test/mocks/MockVenueRouter.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./MockERC20.sol";

contract MockVenueRouter {
    bool public shouldRevert;
    uint256 public outputAmount;

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setOutputAmount(uint256 value) external {
        outputAmount = value;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minAmountOut, address[] calldata path, address to, uint256) external returns (uint256[] memory amounts) {
        require(!shouldRevert, "ROUTER_REVERT");
        require(path.length >= 2, "PATH");
        require(outputAmount >= minAmountOut, "MIN_OUT");
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(path[path.length - 1]).mint(to, outputAmount);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = outputAmount;
    }
}
```

- [ ] **Step 3: Create executor tests**

Create `contracts/test/DogeOsSwapExecutor.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/DogeOsSwapExecutor.sol";
import "./mocks/MockERC20.sol";
import "./mocks/MockVenueRouter.sol";

contract DogeOsSwapExecutorTest is Test {
    DogeOsSwapExecutor executor;
    MockERC20 usdc;
    MockERC20 wdoge;
    MockERC20 usdt;
    MockVenueRouter routerA;
    MockVenueRouter routerB;
    address user = address(0xA11CE);

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC");
        wdoge = new MockERC20("WDOGE", "WDOGE");
        usdt = new MockERC20("USDT", "USDT");
        routerA = new MockVenueRouter();
        routerB = new MockVenueRouter();

        address[] memory routers = new address[](2);
        routers[0] = address(routerA);
        routers[1] = address(routerB);
        executor = new DogeOsSwapExecutor(routers, address(this));

        usdc.mint(user, 1_000 ether);
        vm.prank(user);
        usdc.approve(address(executor), type(uint256).max);
    }

    function testExecutesAtomicMultiHopExactInput() public {
        routerA.setOutputAmount(900 ether);
        routerB.setOutputAmount(850 ether);

        DogeOsSwapExecutor.Leg[] memory legs = new DogeOsSwapExecutor.Leg[](2);
        address[] memory pathA = new address[](2);
        pathA[0] = address(usdc);
        pathA[1] = address(wdoge);
        address[] memory pathB = new address[](2);
        pathB[0] = address(wdoge);
        pathB[1] = address(usdt);

        legs[0] = DogeOsSwapExecutor.Leg(DogeOsSwapExecutor.AdapterType.V2, address(routerA), address(usdc), address(wdoge), 1_000 ether, 900 ether, pathA, 0, address(0));
        legs[1] = DogeOsSwapExecutor.Leg(DogeOsSwapExecutor.AdapterType.V2, address(routerB), address(wdoge), address(usdt), 900 ether, 850 ether, pathB, 0, address(0));

        DogeOsSwapExecutor.ExactInputPlan memory plan = DogeOsSwapExecutor.ExactInputPlan(address(usdc), address(usdt), 1_000 ether, 850 ether, user, block.timestamp + 1, legs);

        vm.prank(user);
        uint256 output = executor.executeExactInput(plan);

        assertEq(output, 850 ether);
        assertEq(usdt.balanceOf(user), 850 ether);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }

    function testRevertsAtomicallyWhenSecondLegFails() public {
        routerA.setOutputAmount(900 ether);
        routerB.setShouldRevert(true);

        DogeOsSwapExecutor.Leg[] memory legs = new DogeOsSwapExecutor.Leg[](2);
        address[] memory pathA = new address[](2);
        pathA[0] = address(usdc);
        pathA[1] = address(wdoge);
        address[] memory pathB = new address[](2);
        pathB[0] = address(wdoge);
        pathB[1] = address(usdt);

        legs[0] = DogeOsSwapExecutor.Leg(DogeOsSwapExecutor.AdapterType.V2, address(routerA), address(usdc), address(wdoge), 1_000 ether, 900 ether, pathA, 0, address(0));
        legs[1] = DogeOsSwapExecutor.Leg(DogeOsSwapExecutor.AdapterType.V2, address(routerB), address(wdoge), address(usdt), 900 ether, 850 ether, pathB, 0, address(0));
        DogeOsSwapExecutor.ExactInputPlan memory plan = DogeOsSwapExecutor.ExactInputPlan(address(usdc), address(usdt), 1_000 ether, 850 ether, user, block.timestamp + 1, legs);

        vm.prank(user);
        vm.expectRevert();
        executor.executeExactInput(plan);

        assertEq(usdc.balanceOf(user), 1_000 ether);
        assertEq(usdt.balanceOf(user), 0);
    }
}
```

- [ ] **Step 4: Run contract tests**

Run:

```bash
npm run test:contracts
```

Expected:

```text
Ran 2 tests for contracts/test/DogeOsSwapExecutor.t.sol
Suite result: ok
```

- [ ] **Step 5: Commit**

Run:

```bash
git add contracts/test/mocks/MockERC20.sol contracts/test/mocks/MockVenueRouter.sol contracts/test/DogeOsSwapExecutor.t.sol
git commit -m "test: prove atomic executor safety basics"
```

## Task 8: Executor Calldata Builder And API Gating

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/aggregator/src/swap/executorAbi.mjs`
- Create: `packages/aggregator/src/swap/executorCalldataBuilder.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Modify: `packages/api/src/handler.mjs`
- Test: `packages/aggregator/test/executorCalldataBuilder.test.mjs`
- Test: `packages/api/test/handler.test.mjs`

- [ ] **Step 1: Add explicit ABI encoding dependency**

Run:

```bash
npm install viem
```

Expected:

```text
added ...
```

- [ ] **Step 2: Write calldata builder tests**

Create `packages/aggregator/test/executorCalldataBuilder.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutorExactInputCalldata } from "../src/swap/executorCalldataBuilder.mjs";

test("buildExecutorExactInputCalldata encodes executor exact-input plan", () => {
  const data = buildExecutorExactInputCalldata({
    sellToken: "0x1111111111111111111111111111111111111111",
    buyToken: "0x2222222222222222222222222222222222222222",
    amountIn: 1000n,
    minAmountOut: 900n,
    recipient: "0x3333333333333333333333333333333333333333",
    deadline: 1780000000n,
    legs: [
      {
        adapterType: "v2",
        router: "0x4444444444444444444444444444444444444444",
        sellToken: "0x1111111111111111111111111111111111111111",
        buyToken: "0x2222222222222222222222222222222222222222",
        amountIn: 1000n,
        minAmountOut: 900n,
        path: [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
        ],
        feeTier: null,
        deployer: null,
      },
    ],
  });

  assert.match(data, /^0x[0-9a-f]+$/i);
  assert.equal(data.slice(0, 10).length, 10);
});
```

- [ ] **Step 3: Implement executor ABI**

Create `packages/aggregator/src/swap/executorAbi.mjs`:

```js
export const DOGEOS_SWAP_EXECUTOR_ABI = [
  {
    type: "function",
    name: "executeExactInput",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "plan",
        type: "tuple",
        components: [
          { name: "sellToken", type: "address" },
          { name: "buyToken", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          {
            name: "legs",
            type: "tuple[]",
            components: [
              { name: "adapterType", type: "uint8" },
              { name: "router", type: "address" },
              { name: "sellToken", type: "address" },
              { name: "buyToken", type: "address" },
              { name: "amountIn", type: "uint256" },
              { name: "minAmountOut", type: "uint256" },
              { name: "path", type: "address[]" },
              { name: "feeTier", type: "uint24" },
              { name: "deployer", type: "address" },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];
```

- [ ] **Step 4: Implement executor calldata builder**

Create `packages/aggregator/src/swap/executorCalldataBuilder.mjs`:

```js
import { encodeFunctionData } from "viem";

import { DOGEOS_SWAP_EXECUTOR_ABI } from "./executorAbi.mjs";

const ADAPTER_ENUM = Object.freeze({
  v2: 0,
  muchfiV3: 1,
  barkswapAlgebra: 2,
});
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function encodedLeg(leg) {
  return {
    adapterType: ADAPTER_ENUM[leg.adapterType],
    router: leg.router,
    sellToken: leg.sellToken,
    buyToken: leg.buyToken,
    amountIn: BigInt(leg.amountIn),
    minAmountOut: BigInt(leg.minAmountOut),
    path: leg.path ?? [leg.sellToken, leg.buyToken],
    feeTier: BigInt(leg.feeTier ?? 0),
    deployer: leg.deployer ?? ZERO_ADDRESS,
  };
}

export function buildExecutorExactInputCalldata(plan) {
  return encodeFunctionData({
    abi: DOGEOS_SWAP_EXECUTOR_ABI,
    functionName: "executeExactInput",
    args: [
      {
        sellToken: plan.sellToken,
        buyToken: plan.buyToken,
        amountIn: BigInt(plan.amountIn),
        minAmountOut: BigInt(plan.minAmountOut),
        recipient: plan.recipient,
        deadline: BigInt(plan.deadline),
        legs: plan.legs.map(encodedLeg),
      },
    ],
  });
}
```

Export from `packages/aggregator/src/index.mjs`:

```js
export { DOGEOS_SWAP_EXECUTOR_ABI } from "./swap/executorAbi.mjs";
export { buildExecutorExactInputCalldata } from "./swap/executorCalldataBuilder.mjs";
```

- [ ] **Step 5: Gate executable atomic routes in API**

In `packages/api/src/handler.mjs`, add handler options:

```js
  executorAddress = "",
  executorCalldataBuilder,
  executorVerifier,
```

In `/swap`, before direct `buildSwapTx`, branch on `originalQuote.executionModel`:

```js
if (originalQuote.executionModel === "atomicExecutorPreview") {
  throw new Error("Atomic executor route is not executable until a verified executor address is configured.");
}

if (originalQuote.executionModel === "atomicExecutor") {
  if (!isHexAddress(executorAddress) || !executorCalldataBuilder || !executorVerifier) {
    throw new Error("Atomic executor is not configured for execution.");
  }
  await executorVerifier({ executorAddress, quote: originalQuote });
  const data = executorCalldataBuilder(originalQuote);
  const tx = {
    chainId: DOGEOS_CHAIN.id,
    to: executorAddress,
    data,
    value: 0n,
    sourceId: originalQuote.sourceId,
    routeBinding: {
      quoteMode: "exactInput",
      sellToken: originalQuote.sellToken,
      buyToken: originalQuote.buyToken,
      amountIn: originalQuote.amountIn,
      minAmountOut: originalQuote.minAmountOut,
      recipient: originalQuote.recipient,
      deadline: originalQuote.deadline,
    },
  };
  const verification = swapVerifier
    ? await swapVerifier({ transaction: tx, quote: originalQuote, sender })
    : undefined;
  return jsonResponse({
    quote: originalQuote,
    execution: {
      model: "atomicExecutor",
      executable: true,
      spender: executorAddress,
      transactionTarget: executorAddress,
      sourceId: originalQuote.sourceId,
      routeType: originalQuote.routeType,
      chainId: DOGEOS_CHAIN.id,
    },
    transaction: {
      ...tx,
      from: sender,
      ...(verification ? { gas: verification.gasLimit } : {}),
    },
    ...(verification ? { verification } : {}),
  });
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test packages/aggregator/test/executorCalldataBuilder.test.mjs packages/api/test/handler.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json packages/aggregator/src/swap/executorAbi.mjs packages/aggregator/src/swap/executorCalldataBuilder.mjs packages/aggregator/src/index.mjs packages/aggregator/test/executorCalldataBuilder.test.mjs packages/api/src/handler.mjs packages/api/test/handler.test.mjs
git commit -m "feat: gate atomic executor calldata"
```

## Task 9: Executor Verification And Provenance

**Files:**
- Create: `packages/aggregator/src/swap/executorVerification.mjs`
- Modify: `packages/aggregator/src/index.mjs`
- Modify: `packages/api/src/live.mjs`
- Test: `packages/aggregator/test/executorVerification.test.mjs`

- [ ] **Step 1: Write executor verification tests**

Create `packages/aggregator/test/executorVerification.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { verifyAtomicExecutorConfig } from "../src/swap/executorVerification.mjs";

test("verifyAtomicExecutorConfig requires bytecode, unpaused state, and allowed routers", async () => {
  const reads = [];
  const result = await verifyAtomicExecutorConfig({
    executorAddress: "0x1111111111111111111111111111111111111111",
    expectedRouters: ["0x2222222222222222222222222222222222222222"],
    client: {
      getCode: async () => "0x60016000",
      call: async ({ data }) => {
        reads.push(data);
        if (data.startsWith("0x5c975abb")) return `0x${0n.toString(16).padStart(64, "0")}`;
        return `0x${1n.toString(16).padStart(64, "0")}`;
      },
    },
  });

  assert.equal(result.status, "verified");
  assert.equal(result.allowedRouters.length, 1);
  assert.equal(reads.length, 2);
});
```

- [ ] **Step 2: Implement verification helper**

Create `packages/aggregator/src/swap/executorVerification.mjs`:

```js
const PAUSED_SELECTOR = "0x5c975abb";
const ALLOWED_ROUTER_SELECTOR = "0xa60dfe20";

function assertAddress(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(String(value ?? ""))) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return String(value);
}

function encodeAddress(address) {
  return assertAddress(address, "router").slice(2).padStart(64, "0");
}

function decodeBool(result, fieldName) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(result ?? ""))) {
    throw new Error(`${fieldName} must be a bool ABI result.`);
  }
  return BigInt(result) !== 0n;
}

export async function verifyAtomicExecutorConfig({ executorAddress, expectedRouters, client }) {
  const address = assertAddress(executorAddress, "executorAddress");
  if (!client?.getCode || !client?.call) {
    throw new Error("Executor verification requires getCode and call client methods.");
  }

  const code = await client.getCode(address);
  if (!code || code === "0x") throw new Error("Atomic executor has no bytecode.");

  const paused = decodeBool(
    await client.call({ to: address, data: PAUSED_SELECTOR }, "latest"),
    "paused",
  );
  if (paused) throw new Error("Atomic executor is paused.");

  const allowedRouters = [];
  for (const router of expectedRouters) {
    const allowed = decodeBool(
      await client.call({ to: address, data: `${ALLOWED_ROUTER_SELECTOR}${encodeAddress(router)}` }, "latest"),
      `allowedRouter(${router})`,
    );
    if (!allowed) throw new Error(`Atomic executor does not allow router ${router}.`);
    allowedRouters.push(router);
  }

  return {
    status: "verified",
    executorAddress: address,
    bytecodeSizeBytes: (code.length - 2) / 2,
    paused,
    allowedRouters,
  };
}
```

Export:

```js
export { verifyAtomicExecutorConfig } from "./swap/executorVerification.mjs";
```

- [ ] **Step 3: Wire live API verifier**

In `packages/api/src/live.mjs`, read executor address from env/runtime config and only pass `executorVerifier` when configured:

```js
const executorAddress = process.env.DOGEOS_EXECUTOR_ADDRESS ?? "";
```

Use `verifyAtomicExecutorConfig` with expected active source routers from the registry. Keep atomic routes non-executable when `executorAddress` is empty.

- [ ] **Step 4: Run verification tests**

Run:

```bash
node --test packages/aggregator/test/executorVerification.test.mjs packages/api/test/handler.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add packages/aggregator/src/swap/executorVerification.mjs packages/aggregator/src/index.mjs packages/aggregator/test/executorVerification.test.mjs packages/api/src/live.mjs packages/api/test/handler.test.mjs
git commit -m "feat: verify DogeOS atomic executor config"
```

## Task 10: Atomic Route UI And Native API States

**Files:**
- Modify: `apps/web/src/app.js`
- Modify: `apps/web/src/index.html`
- Modify: `apps/web/src/styles.css`
- Test: `packages/web/test/staticApp.test.mjs`
- Modify: `docs/mydoge-native-direct-execution.md`

- [ ] **Step 1: Add UI tests for atomic preview and executable states**

Add to `packages/web/test/staticApp.test.mjs`:

```js
test("static web app labels atomic split routes as preview unless executor is verified", async () => {
  const appJs = await readFile(resolve(appRoot, "app.js"), "utf8");
  const harness = createStaticAppHarness({
    quote: {
      status: "read-only",
      best: null,
      alternatives: [],
      rejected: [{
        status: "readOnly",
        reason: "split-execution-preview",
        routeType: "split",
        executionModel: "atomicExecutorPreview",
        sourceId: "muchfi-v2+barkswap-algebra",
        amountIn: "1000",
        amountOut: "1100",
        gasUnits: "260000",
        dataFinalityFeeWei: "1000",
        legs: [{ sourceId: "muchfi-v2" }, { sourceId: "barkswap-algebra" }],
      }],
      warnings: ["no-executable-route"],
    },
  });

  vm.runInNewContext(appJs, harness.context);
  await drainMicrotasks(32);

  assert.match(harness.element("route-scan-status").textContent, /preview/i);
  assert.match(harness.element("execution-surface-status").textContent, /atomic executor/i);
  assert.equal(harness.element("swap-button").disabled, true);
});
```

- [ ] **Step 2: Add UI labels**

In `apps/web/src/app.js`, update execution text:

```js
if (quote?.rejected?.some((route) => route.executionModel === "atomicExecutorPreview")) {
  return "Split or multi-hop route intelligence found. Wallet execution requires a verified DogeOS atomic executor.";
}

if (best?.executionModel === "atomicExecutor") {
  return `Atomic DogeOS executor route via ${routeSourceName(best)}. The executor is the approval spender and transaction target.`;
}
```

Route scan rows should show:

```js
const executionLabel =
  route.executionModel === "atomicExecutor"
    ? "atomic executable"
    : route.executionModel === "atomicExecutorPreview"
      ? "atomic preview"
      : "direct venue";
```

- [ ] **Step 3: Update native integration doc**

Append to `docs/mydoge-native-direct-execution.md`:

```markdown
## Atomic Executor Extension

When `execution.model = atomicExecutor`, the spender and transaction target are the verified aggregator executor address rather than a venue router. MyDoge native clients must treat `atomicExecutorPreview` routes as non-executable.
```

- [ ] **Step 4: Run static tests**

Run:

```bash
node --test packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/src/app.js apps/web/src/index.html apps/web/src/styles.css packages/web/test/staticApp.test.mjs docs/mydoge-native-direct-execution.md
git commit -m "feat: label atomic route execution states"
```

## Task 11: Deployment Script, Verification, And Enablement Gate

**Files:**
- Create: `contracts/script/DeployDogeOsSwapExecutor.s.sol`
- Modify: `docs/dogeos-atomic-executor-runbook.md`

- [ ] **Step 1: Create deployment script**

Create `contracts/script/DeployDogeOsSwapExecutor.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "../src/DogeOsSwapExecutor.sol";

contract DeployDogeOsSwapExecutor is Script {
    function run() external returns (DogeOsSwapExecutor executor) {
        address[] memory routers = new address[](3);
        routers[0] = vm.envAddress("DOGEOS_MUCHFI_V2_ROUTER");
        routers[1] = vm.envAddress("DOGEOS_MUCHFI_V3_ROUTER");
        routers[2] = vm.envAddress("DOGEOS_BARKSWAP_ALGEBRA_ROUTER");
        address owner = vm.envAddress("DOGEOS_EXECUTOR_OWNER");

        vm.startBroadcast();
        executor = new DogeOsSwapExecutor(routers, owner);
        vm.stopBroadcast();
    }
}
```

- [ ] **Step 2: Build deployment script**

Run:

```bash
npm run build:contracts
```

Expected:

```text
Compiler run successful
```

- [ ] **Step 3: Add runbook deployment command**

Append to `docs/dogeos-atomic-executor-runbook.md`:

```markdown
## Foundry Testnet Deployment Command

```bash
DOGEOS_MUCHFI_V2_ROUTER=0xC653e745FC613a03D156DACB924AE8e9148B18dc \
DOGEOS_MUCHFI_V3_ROUTER=0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB \
DOGEOS_BARKSWAP_ALGEBRA_ROUTER=0x77147f436cE9739D2A54Ffe428DBe02b90c0205e \
DOGEOS_EXECUTOR_OWNER=0xOwnerAddress \
forge script contracts/script/DeployDogeOsSwapExecutor.s.sol \
  --rpc-url https://rpc.testnet.dogeos.com \
  --broadcast
```

The owner address must be a controlled testnet governance or multisig address. Do not use a personal hot wallet for long-lived executor ownership.
```

- [ ] **Step 4: Final verification before enabling atomic execution**

Run:

```bash
npm test
npm run build:web
npm run build:contracts
npm run test:contracts
```

Expected:

```text
# fail 0
✓ built
Compiler run successful
Suite result: ok
```

- [ ] **Step 5: Commit**

Run:

```bash
git add contracts/script/DeployDogeOsSwapExecutor.s.sol docs/dogeos-atomic-executor-runbook.md
git commit -m "chore: add DogeOS executor deployment runbook"
```

## Task 12: Final Atomic Executor Acceptance Run

**Files:**
- Modify: no source code unless verification exposes a regression

- [ ] **Step 1: Verify direct venue execution still works**

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

- [ ] **Step 2: Verify contract suite**

Run:

```bash
npm run build:contracts
npm run test:contracts
```

Expected:

```text
Compiler run successful
Suite result: ok
```

- [ ] **Step 3: Verify atomic routes remain disabled without executor address**

Run API tests with no executor env:

```bash
unset DOGEOS_EXECUTOR_ADDRESS
node --test packages/api/test/handler.test.mjs packages/web/test/staticApp.test.mjs
```

Expected:

```text
# fail 0
```

Atomic preview routes must be visible as intelligence but not executable.

- [ ] **Step 4: Verify atomic executor after testnet deployment**

After deployment, run with executor env:

```bash
DOGEOS_EXECUTOR_ADDRESS=0xExecutorAddress \
node --test packages/api/test/handler.test.mjs packages/aggregator/test/executorVerification.test.mjs
```

Expected:

```text
# fail 0
```

- [ ] **Step 5: Push branch**

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

- The plan separates route intelligence from executable atomic routing.
- It introduces a Solidity executor only after direct venue execution is stable.
- The executor is not an owned DEX, factory, liquidity manager, or arbitrary calldata router.
- Split and multi-hop routes remain non-executable until contract bytecode, ABI, allowlisted routers, pause state, tests, and DogeOS Blockscout provenance are verified.
- MyDoge/native integration can consume direct venue execution first and upgrade to a single executor spender only after explicit enablement.
