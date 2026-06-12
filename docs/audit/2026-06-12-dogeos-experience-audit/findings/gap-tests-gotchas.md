# Gap closure: test-suite reality + remaining DogeOS gotchas

Date: 2026-06-12. Reviewer: DogeOS engineer / ecosystem reviewer.
Scope: two items the prior audit asserted from docs without running them.
All checks below are live reads in THIS checkout (`/home/actlabs/dogeswap-prod`),
Foundry `1.7.1` (`$HOME/.foundry/bin`), RPC `https://rpc.testnet.dogeos.com` (chainId `0x5fdaf3` = 6281971).

---

## PART 1 — Does the contract test suite build/run in THIS checkout?

### Verdict: NO. `forge build` and `forge test` both fail with a hard compile error. The "53 tests / Echidna / fork tests pass" claim cannot be reproduced here — it is unverifiable in the prod checkout as shipped.

### F1 (HIGH) — Solidity dependencies (`lib/`) are absent and unrecoverable in this checkout; the entire suite fails to compile

- `/home/actlabs/dogeswap-prod/packages/contracts/lib/` does **not exist** (`ls lib/` → "No such file or directory").
- `lib/` is git-ignored: `packages/contracts/.gitignore` lists `lib/`.
- There is **no `.gitmodules`** anywhere (`packages/contracts/.gitmodules` and repo-root `.gitmodules` both absent), so `forge install` / submodule restore has no source list to pull from. The deps cannot be re-fetched without manually re-adding remotes.
- `remappings.txt` expects three deps that don't exist here:
  `forge-std/=lib/forge-std/src/`, `permit2/=lib/permit2/`, `openzeppelin/=lib/openzeppelin-contracts/contracts/`.
- `forge build` (PATH=`$HOME/.foundry/bin`): **EXIT 1**, ~hundreds of
  `No such file or directory (os error 2)` for every `lib/...` import
  (`lib/forge-std/src/Test.sol`, `lib/openzeppelin-contracts/contracts/governance/TimelockController.sol`,
  `lib/permit2/src/interfaces/IAllowanceTransfer.sol`, etc.).
- `forge test --no-match-test fork -q`: **EXIT 1**, `Error: Compilation failed`.
- The deps DO exist in the sibling staging checkout
  (`/home/actlabs/dogeswap-staging/packages/contracts/lib/{forge-std,permit2,openzeppelin-contracts}`),
  which is how the suite was presumably last run — but they were never vendored or
  pinned into prod, so prod is not self-bootstrapping.

Impact: the audit's "tests pass" assertion is **not reproducible from the prod
tree**. A reviewer (or CI checking out prod) gets zero compiled tests. This is a
reproducibility/supply-chain gap, not a logic bug — once deps are present (e.g. as
in staging) the sources are expected to compile (solc 0.8.30, evm_version=prague).

Recommendation: add a `.gitmodules` (or Soldeer/`foundry.lock` pins with commit
SHAs) for forge-std / OZ v5.6.1 / Permit2, or vendor `lib/` and remove it from
`.gitignore`. Without that, "tests pass" is undefendable for prod.

### F2 (MEDIUM) — The test-count claims are inconsistent across docs and don't all match the code

Counted by `grep -rE "function (test|invariant)"` in THIS checkout:

| Source | Claimed count | |
|---|---|---|
| `packages/contracts/README.md` (Build & test) | **53** unit/adversarial/invariant | |
| `audit/REPRODUCIBILITY.md:96` | **39** passing | |
| `audit/CODE_MATURITY.md:14` | **39** Foundry tests | |
| `audit/SLITHER_TRIAGE.md:17` | **39** `forge test` cases | |

Actual functions present (non-fork): **52** `test_*`/`invariant_*` across
`DogeSwapRegistry.t.sol`(5), `DogeSwapRouter.t.sol`(6), `RouterEdges.t.sol`(8),
`RouterGovernance.t.sol`(8), `RouterInvariants.t.sol`(10), `RouterPermit2.t.sol`(6),
`RouterSwaps.integration.t.sol`(9); plus **1** fork test (`test_fork_v3_differential`
in `test/fork/RouterFork.t.sol`) = **53 functions total**.

So README's "53" matches function count (incl. fork) but the three audit docs all
say "39", which matches neither. Either number could be defended depending on how
invariant/fork/skipped cases are counted, but they cannot all be right, and none
were re-derived from a real `forge test` summary here (because it doesn't compile).
Treat every "N tests pass" line as unverified until F1 is fixed.

### F3 (LOW) — Fork-test rationale is stale: it skips "because the fork lacks Permit2", but Permit2 is now live

`test/fork/RouterFork.t.sol` calls `vm.skip(true)` paths and the comment at
line ~51 says "the fork lacks Permit2 -> etch it at the canonical address"
(`deployPermit2()`). `audit/DEPLOYMENT.md:265` describes the fork test as
"PASS / clean SKIP" and `CODE_MATURITY.md:14` says live fork tests are "pending
Permit2 deployment on-chain". That premise is now false: canonical Permit2
`0x000000000022D473030F116dDEE9F6B43aC78BA3` is live
(`cast code` returns non-empty bytecode `0x604060808152...`). The fork test etches
its own Permit2 regardless, so it isn't broken — but the documented reason for
skipping live differential testing no longer holds and the fork suite has never
been exercised against the real on-chain Permit2.

---

## PART 2 — Remaining DogeOS gotchas re-verified against code

### G1 (PASS / INFO) — No SELFDESTRUCT / PREVRANDAO / blob / raw-precompile reliance in src or the OZ deps actually used

- `grep -rniE "selfdestruct|suicide"` over `packages/contracts/src/` and
  `apps/web/src/`: **0 hits**.
- `grep -rniE "prevrandao|block\.difficulty"` over `src/`: **0 hits**.
- `grep -rniE "blobhash|blobbasefee|blob_base_fee"` over `src/` + web: **0 hits**.
- `grep -rniE "ecrecover|modexp|kzg|blake2|bn256|ecadd|ecmul|ecpairing|pointEvaluation"`
  over `src/`: **0 hits** (router is movement-only; `Commands.sol:5` and
  `DogeSwapRouter.sol:25` document "no arbitrary CALL/DELEGATECALL").
- OZ deps that the contracts actually import (verified against the staging `lib`
  mirror, OZ **v5.6.1**): `governance/TimelockController.sol`, `access/Ownable2Step.sol`,
  `access/Ownable.sol`, `utils/Pausable.sol`, `utils/ReentrancyGuardTransient.sol`,
  `token/ERC20/utils/SafeERC20.sol`, `token/ERC20/IERC20.sol` — **none** contain
  `selfdestruct|prevrandao|block.difficulty|blobhash|blobbasefee`. Permit2 `src/`
  likewise clean.
- Note (not a defect): the router relies on **EIP-1153 transient storage**
  (`ReentrancyGuardTransient` → TSTORE/TLOAD; `DogeSwapRouter.sol:6,34`). That is a
  Cancun+/Prague opcode; `foundry.toml` sets `evm_version = "prague"` and the
  source comment cites an on-chain probe. This is the one chain-dependent EVM
  feature in the router and is consistent with DogeOS being Prague — fine, but it
  is the assumption to keep an eye on if DogeOS ever downgrades the EVM target.

### G2 (LOW) — RPC URL trailing-slash inconsistency between the two config sources (both ship; both work)

- `packages/config/src/chains.mjs:10`: `rpcUrls: ["https://rpc.testnet.dogeos.com"]`
  — **no** trailing slash. (Backend/API tree.)
- `apps/web/src/sdkConfig.js:8`:
  `rpcUrls: { default: { http: ["https://rpc.testnet.dogeos.com/"] } }`
  — **with** trailing slash. (Production frontend tree.)
- Both forms are present in the shipped bundle: `apps/web/dist/assets/*.js` contain
  one `rpc.testnet.dogeos.com"` and one `rpc.testnet.dogeos.com/`.
- Functionally harmless: a live POST `eth_chainId` to **both** URLs returns
  `{"result":"0x5fdaf3"}`. So this is a consistency/cleanliness issue, not an outage.
- Which tree is production: confirmed `apps/web/src` is the shipped frontend. The
  systemd unit runs `packages/web/src/server.mjs`
  (`WorkingDirectory=/home/actlabs/dogeswap-prod`,
  `ExecStart=... packages/web/src/server.mjs`); that server serves
  `apps/web/dist/` when `index.html` exists there
  (`server.mjs:18-19,43-44`: `DEFAULT_DIST_ROOT = ../../../apps/web/dist/`),
  and `apps/web/dist/index.html` is present (rebuilt 2026-06-12 20:23). So
  `packages/web` is only the static-file + API host; the actual UI is the built
  `apps/web/src` React app. The trailing-slash form in `sdkConfig.js` is the one
  end users hit.

Recommendation: pick one canonical form (DogeOS docs use no trailing slash) and
align both files so SDK/RPC keys and any URL-based caching/allowlists match.

### G3 (MEDIUM) — `documentedMaxReorgDepth = 17` is dead config: it never gates confirmations anywhere

- Defined once: `packages/config/src/chains.mjs:20` (`documentedMaxReorgDepth: 17`).
- Every consumer only **echoes it back** as a display field, never acts on it:
  - `packages/api/src/handler.mjs:92` and `packages/api/src/live.mjs:113` copy it
    verbatim into the `/info`-style chain-meta response object.
  - `packages/api/test/handler.test.mjs:91,110` and
    `packages/config/test/dogeosConfig.test.mjs:22` only assert it equals 17.
- There is **no** confirmation-depth / finality gating anywhere. The frontend's
  receipt waiter `apps/web/src/lib/execute.js:264-289 waitForTransactionReceipt`
  returns on the **first** `eth_getTransactionReceipt` that comes back
  (`if (receipt) { ...; return receipt; }`) — it does not wait N blocks, does not
  re-poll for depth, and never reads `documentedMaxReorgDepth`. `grep -rn
  "documentedMaxReorgDepth"` over all `.mjs/.js/.jsx` returns only the definition,
  the two API echoes, and the two test asserts — zero call sites that gate logic.

Impact: the value is purely informational. The audit/threat-model docs
(`audit/THREAT_MODEL.md:127` "Reorgs (DogeOS max depth 17)", spec line 186,
`docs/adapter-verification.md:106`) imply an "off-chain confirmation-depth policy"
that **does not exist in code** — a swap is treated as final the instant a receipt
appears, which on a chain that documents a 17-block reorg depth means the UI can
show "settled" for a tx that a reorg could still drop. The on-chain router is
reorg-agnostic by design (deadline-bound, holds ~zero balance), so funds aren't at
risk on-chain; the gap is UX/indexing-side optimistic finality.

Recommendation: either (a) implement the documented policy — have
`waitForTransactionReceipt` / the success UI wait until `currentBlock -
receipt.blockNumber >= documentedMaxReorgDepth` (or a chosen smaller threshold)
before declaring "settled", or (b) drop the "confirmation-depth policy" language
from the threat model and label the field as advisory only. Right now docs and code
disagree.

---

## Confirmed facts (live)

- Foundry `1.7.1` present at `$HOME/.foundry/bin`; `forge build` / `forge test`
  both EXIT 1 (compile failure) in `packages/contracts` due to missing `lib/`.
- `packages/contracts/lib/` absent; git-ignored; no `.gitmodules` to restore it.
- Deps exist in `dogeswap-staging` checkout (OZ v5.6.1) but not vendored in prod.
- Actual test functions in checkout: 52 non-fork + 1 fork = 53; docs variously
  say 39 (REPRODUCIBILITY/CODE_MATURITY/SLITHER_TRIAGE) and 53 (README).
- src + used OZ deps + Permit2: zero selfdestruct / prevrandao / blob / precompile.
  Router relies on EIP-1153 transient storage (Prague) — expected, documented.
- RPC URL: `chains.mjs:10` no slash vs `sdkConfig.js:8` trailing slash; both live-OK.
- `apps/web/src` is the served frontend (dist served by `packages/web/src/server.mjs`).
- `documentedMaxReorgDepth=17` only defined/echoed/asserted — never gates any
  confirmation; `execute.js` returns on first receipt.
- Ground truth re-verified live: router `0xa315...A35A` owner==guardian==
  `0xE659...2873` (EOA, `cast code` == `0x`); Permit2 `0x0000...78BA3` has bytecode.
