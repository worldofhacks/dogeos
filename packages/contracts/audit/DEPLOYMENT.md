# DogeOS Aggregation Router — Deployment Runbook (Phase 5)

**Target:** DogeOS testnet — RPC `https://rpc.testnet.dogeos.com`, chain id `6281971`.
**Script:** `script/DeployRouter.s.sol` (`forge` Script).
**Status:** fork-validated (no real broadcast performed in this repo — no funded key). This document
is the exact sequence the operator runs to broadcast.

The deploy is one broadcast that, in order:

1. Deterministically deploys **Permit2** to its canonical address (only if it is absent).
2. Deploys a **TimelockController** (proposer + executor + admin = `ROUTER_SAFE`).
3. Deploys the immutable **DogeSwapRouter** (owner temporarily = deployer, guardian = `ROUTER_GUARDIAN`).
4. **Caps** the router (`defaultMaxInputPerTx` + per-token WDOGE/USDC[/USDT]) and asserts `feeBps() == 0`
   so the router is **never live-and-uncapped**.
5. Deploys a **DogeSwapRegistry**, points it at the router, and transfers the registry to `ROUTER_SAFE`.
6. Transfers the router owner to the timelock (`Ownable2Step` → pending owner = timelock).

The **final handover** (`timelock.acceptOwnership()` on the router) is a post-deploy governance action
the Safe performs through the timelock — see section 5 below.

---

## CRITICAL — Permit2 determinism (read before deploying)

The router hardcodes the canonical Permit2 address `0x000000000022D473030F116dDEE9F6B43aC78BA3`
(`Constants.PERMIT2`). Permit2 is **ABSENT** on DogeOS testnet and **must** be deployed to exactly
that address, or the entire stack is broken.

Verified facts (re-derive them yourself with the commands in "Verification" below):

| Item | Value |
|------|-------|
| Arachnid CREATE2 proxy (present on DogeOS) | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Permit2 creation-code init-code hash (local build == canonical mainnet) | `0xe2be1e05eedf35dacd66c65c862f8150ff9ab4b6b24b9bbe62be71b6b16cf0f8` |
| Canonical Permit2 vanity **salt** | `0x0000000000000000000000000000000000000000d3af2663da51c10215000000` |
| Resulting address | `0x000000000022D473030F116dDEE9F6B43aC78BA3` ✓ |

> **Why not `salt = bytes32(0)`?** The canonical Permit2 was deployed with the vanity salt above,
> not salt 0. With our (correct, byte-for-byte canonical) creation code, **salt 0 yields a
> different, non-canonical address** (`0x3191Fc1E303EF4e12a7DE5f5d2e8d53A0660c5b9`). The script
> therefore uses the canonical salt and **asserts** `computed == canonical`, reverting the whole
> deploy on mismatch. Our local `lib/permit2` build is byte-identical to the canonical Permit2, so
> canonical salt + this creation code = the canonical address. **Fork-simulation confirmed this:**
> the script logged `Permit2 deployed (deterministic) at 0x000000000022D473030F116dDEE9F6B43aC78BA3`.

---

## Prerequisites

All commands assume Foundry on PATH:

```sh
export PATH="$HOME/.foundry/bin:$PATH"
```

### (a) Build the Permit2 artifact (uses Permit2's OWN config: solc 0.8.17 + via_ir)

The deploy script reads Permit2's creation bytecode from this artifact via
`vm.getCode("lib/permit2/out/Permit2.sol/Permit2.json")`, so it must exist first:

```sh
(cd packages/contracts/lib/permit2 && forge build)
# artifact: packages/contracts/lib/permit2/out/Permit2.sol/Permit2.json
```

### (b) Import the deployer key into Foundry's encrypted keystore + fund it

NEVER put a raw private key in any file. Import once into the encrypted keystore, then deploy with
`--account`:

```sh
cast wallet import dogeos-deployer --interactive   # paste the key once, set a password
# note the printed address -> this is $DEPLOYER_ADDRESS
```

Fund the deployer with testnet DOGE: <https://faucet.testnet.dogeos.com>

### (c) Configure env

```sh
cd packages/contracts
cp .env.example .env
# edit .env and fill in:
#   ROUTER_SAFE        = your Gnosis Safe (becomes timelock proposer/executor + registry owner)
#   ROUTER_GUARDIAN    = pause-only hot key (cannot unpause / set fee / set caps)
#   TIMELOCK_MIN_DELAY = e.g. 172800 (48h)
#   CAP_DEFAULT        = defaultMaxInputPerTx in smallest units (e.g. 100000e18)
#   (optional) CAP_WDOGE / CAP_USDC / CAP_USDT, and USDT if you have a VERIFIED address
#   DEPLOYER_ADDRESS   = the address printed by `cast wallet import` above
```

Hardcoded in the script (verified PRESENT on DogeOS testnet, see `audit/CHAIN_FACTS.md`):

| Constant | Address |
|----------|---------|
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` |
| MuchFi V2 router | `0xC653e745FC613a03D156DACB924AE8e9148B18dc` |
| MuchFi V3 router | `0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB` |
| Barkswap Algebra router | `0x77147f436cE9739D2A54Ffe428DBe02b90c0205e` |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` |

---

## 1–4. Fork-simulate first (no broadcast)

Always dry-run against the fork before broadcasting. Confirm it (i) simulates successfully and
(ii) logs `Permit2 ... 0x000000000022D473030F116dDEE9F6B43aC78BA3`:

```sh
cd packages/contracts
set -a && source .env && set +a   # load the env vars

forge script script/DeployRouter.s.sol \
  --fork-url https://rpc.testnet.dogeos.com \
  --sender "$DEPLOYER_ADDRESS"
```

Expected (addresses for timelock/router/registry will differ — they are CREATE-nonce dependent):

```
Permit2 deployed (deterministic) at 0x000000000022D473030F116dDEE9F6B43aC78BA3
==== DogeOS Aggregation Router deployment ====
...
router.feeBps()            0
```

---

## 5. Broadcast (the real deploy)

> Only run after the dry-run above is clean AND the Permit2 line shows the canonical address.

```sh
cd packages/contracts
set -a && source .env && set +a

forge script script/DeployRouter.s.sol \
  --rpc-url https://rpc.testnet.dogeos.com \
  --broadcast \
  --verify \
  --verifier blockscout \
  --verifier-url https://blockscout.testnet.dogeos.com/api/ \
  --account dogeos-deployer \
  --sender "$DEPLOYER_ADDRESS"
```

Record the four addresses the script logs:

| Contract | Address | Notes |
|----------|---------|-------|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | canonical (deterministic) |
| TimelockController | `__________` | proposer/executor/admin = ROUTER_SAFE |
| DogeSwapRouter | `__________` | pending owner = timelock; feeBps=0; capped |
| DogeSwapRegistry | `__________` | pending owner = ROUTER_SAFE |

---

## 6. Post-deploy governance (manual, via the Safe)

After broadcast, **two ownership acceptances** remain. Both are `Ownable2Step.acceptOwnership()`.

### 6a. Router owner → TimelockController

The router's pending owner is the timelock. The timelock must call `acceptOwnership()` on the
router, scheduled + executed by the Safe (proposer/executor) respecting `TIMELOCK_MIN_DELAY`.

Compute the calldata once:

```sh
ACCEPT=$(cast calldata "acceptOwnership()")
ROUTER=<DogeSwapRouter address>
TIMELOCK=<TimelockController address>
DELAY=<TIMELOCK_MIN_DELAY, e.g. 172800>
```

From the **Safe** (proposer), schedule:

```sh
# timelock.schedule(target=router, value=0, data=acceptOwnership, predecessor=0, salt=0, delay)
cast send "$TIMELOCK" \
  "schedule(address,uint256,bytes,bytes32,bytes32,uint256)" \
  "$ROUTER" 0 "$ACCEPT" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  "$DELAY" \
  --rpc-url https://rpc.testnet.dogeos.com --account <safe-signer-or-Safe-tx>
```

Wait `DELAY` seconds, then from the **Safe** (executor), execute:

```sh
# timelock.execute(target=router, value=0, data=acceptOwnership, predecessor=0, salt=0)
cast send "$TIMELOCK" \
  "execute(address,uint256,bytes,bytes32,bytes32)" \
  "$ROUTER" 0 "$ACCEPT" \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  --rpc-url https://rpc.testnet.dogeos.com --account <safe-signer-or-Safe-tx>
```

Confirm: `cast call $ROUTER "owner()(address)"` returns the timelock address.

> In production these two Safe transactions are proposed/signed/executed through the Safe UI or
> Safe transaction service rather than a raw EOA. The function signatures above are identical.

### 6b. DogeSwapRegistry owner → Safe

The registry's pending owner is `ROUTER_SAFE`. The Safe accepts directly (no timelock):

```sh
cast send <DogeSwapRegistry address> "acceptOwnership()" \
  --rpc-url https://rpc.testnet.dogeos.com --account <safe-signer-or-Safe-tx>
```

Confirm: `cast call <registry> "owner()(address)"` returns `ROUTER_SAFE`.

---

## 7. Evidence — fill in after broadcast

| Field | Value |
|-------|-------|
| Deploy tx hash | `__________` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| TimelockController | `__________` |
| DogeSwapRouter | `__________` |
| DogeSwapRegistry | `__________` |
| ROUTER_SAFE | `__________` |
| ROUTER_GUARDIAN | `__________` |
| TIMELOCK_MIN_DELAY | `__________` |
| defaultMaxInputPerTx (CAP_DEFAULT) | `__________` |
| router.feeBps() | `0` |
| Router acceptOwnership schedule tx | `__________` |
| Router acceptOwnership execute tx | `__________` |
| Registry acceptOwnership tx | `__________` |
| Evidence swap tx hash (e.g. WDOGE→USDC via router) | `__________` |

---

## Verification commands (re-derive the determinism claims)

```sh
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts/lib/permit2

# init-code hash of the locally built Permit2 (must equal the canonical mainnet hash):
BYTECODE=$(jq -r '.bytecode.object' out/Permit2.sol/Permit2.json)
cast keccak "$BYTECODE"
#   -> 0xe2be1e05eedf35dacd66c65c862f8150ff9ab4b6b24b9bbe62be71b6b16cf0f8

# CREATE2 address with the canonical vanity salt (must equal the canonical Permit2 address):
cast create2 \
  --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C \
  --salt 0x0000000000000000000000000000000000000000d3af2663da51c10215000000 \
  --init-code-hash 0xe2be1e05eedf35dacd66c65c862f8150ff9ab4b6b24b9bbe62be71b6b16cf0f8
#   -> 0x000000000022D473030F116dDEE9F6B43aC78BA3
```

## Validation tests (run before deploying)

```sh
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts
forge test --match-contract "DogeSwapRegistryTest|RouterGovernanceTest"          # PASS
forge test --match-contract RouterForkTest --fork-url https://rpc.testnet.dogeos.com -vv  # PASS / clean SKIP
forge test                                                                      # full suite, no regressions
```
