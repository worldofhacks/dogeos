# Reproducibility — DogeSwapRouter

Everything needed to byte-for-byte reproduce the build, tests, and security tooling.
All commands run from `packages/contracts/` with Foundry on PATH
(`export PATH="$HOME/.foundry/bin:$PATH"`).

---

## Compiler & build settings (`foundry.toml`)

| Setting | Value |
|---------|-------|
| `solc` | `0.8.30` |
| `evm_version` | `prague` (DogeOS is Prague-compatible — `CHAIN_FACTS.md §3`) |
| `optimizer` | `true` |
| `optimizer_runs` | `1_000_000` |
| `via_ir` | **off** (not set; default false) |
| `bytecode_hash` | `none` (deterministic metadata) |

Installed solc: `0.8.30+commit.73712a01` (verified via `solc --version`; Foundry resolves the
same `0.8.30` via its solc manager).

---

## Toolchain versions

| Tool | Version | Notes |
|------|---------|-------|
| forge / cast | `1.7.1` (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`, build 2026-05-08) | `forge --version` |
| Slither | `0.11.5` | `slither --version` |
| Echidna | `2.3.2` | `echidna --version` |
| Medusa | `1.5.1` | `medusa --version` |

---

## Dependencies (pinned versions)

| Dependency | Version | Remapping | Source of truth |
|------------|---------|-----------|-----------------|
| forge-std | `1.9.7` | `forge-std/=lib/forge-std/src/` | `lib/forge-std/package.json` |
| openzeppelin-contracts | `5.6.1` (2026-02-27) | `openzeppelin/=lib/openzeppelin-contracts/contracts/` | `lib/openzeppelin-contracts/package.json` + `CHANGELOG.md` |
| permit2 (`@uniswap/permit2`) | `1.0.0` | `permit2/=lib/permit2/` | `lib/permit2/package.json` |

> **Note on commit hashes.** The dependencies in `lib/` were vendored directly into the parent
> repository (they are **not** git submodules and carry no embedded `.git` / pin), so
> `git -C lib/<dep> rev-parse HEAD` resolves the *parent* repo's HEAD, not the upstream
> dependency commit — it does not yield a meaningful per-dependency hash. The authoritative pins
> are therefore the **versions above**, read from each dependency's own manifest. Before mainnet
> deploy, re-vendor these as pinned git submodules (e.g. `forge install <org>/<repo>@<tag>`) so
> the exact upstream commit SHAs are recorded in `.gitmodules`. The canonical published commits
> for these tagged releases are:
> - openzeppelin-contracts `v5.6.1`
> - forge-std `v1.9.7`
> - permit2 `v1.0.0` (canonical audited Permit2; deployed deterministically via CREATE2)

Key dependency facts:
- OZ `ReentrancyGuardTransient` (EIP-1153) is present and used by the reentrancy guard
  (`lib/openzeppelin-contracts/contracts/utils/ReentrancyGuardTransient.sol`).
- `Ownable2Step`, `Pausable`, `SafeERC20`, `IERC20` from OpenZeppelin.
- `IAllowanceTransfer` / `IEIP712` from permit2; tests deploy a real Permit2 via permit2's
  `DeployPermit2` helper.

---

## Source scope & SLOC

`find src -name '*.sol' | xargs wc -l`:

```
 217 src/DogeSwapRouter.sol
  14 src/libraries/Constants.sol
  15 src/libraries/Commands.sol
  10 src/interfaces/IWETH9.sol
  20 src/interfaces/IAlgebraSwapRouter.sol
  12 src/interfaces/IUniswapV2Router.sol
  19 src/interfaces/IUniswapV3SwapRouter.sol
 307 total
```

The core contract is **217 lines** (raw, including NatSpec); total in-scope `src/` is **307
lines**. (Raw `wc -l`, not nSLOC; the contract is intentionally terse — many statements per line.)

**Deployed bytecode size** (`forge build --sizes`): runtime **11,831 B**, initcode **12,363 B** —
runtime margin **12,745 B** under the 24,576-byte EIP-170 limit.

---

## Exact commands to reproduce

### Build
```sh
export PATH="$HOME/.foundry/bin:$PATH"
forge build
forge build --sizes        # confirm runtime size < 24,576 B
```

### Tests (39 passing; invariants at 256×100 = 25,600 calls each)
```sh
forge test
forge test -vvv            # verbose
forge test --match-contract RouterInvariantsTest   # I1–I8 suite
```

### Slither (static analysis — config `slither.config.json`, `fail_on: high`)
```sh
slither . 2>&1 | tee ../../slither-run.txt
# Scope: src/DogeSwapRouter.sol; filter_paths = lib|test|script;
# exclude_dependencies = true. Exits 0; triage in audit/SLITHER_TRIAGE.md.
```

### Echidna (assertion fuzzing — config `echidna.yaml`, testLimit 50,000)
```sh
echidna test/echidna/EchidnaRouter.sol \
  --contract EchidnaRouter \
  --config echidna.yaml
```

### Medusa (assertion fuzzing — config `medusa.json`, testLimit 100,000, 8 workers)
```sh
medusa fuzz --config medusa.json
# targets EchidnaRouter (assertion mode), crytic-compile via --foundry-compile-all
```

### Chain-fact evidence (already recorded in `audit/CHAIN_FACTS.md`)
```sh
cast chain-id --rpc-url https://rpc.testnet.dogeos.com               # 6281971
cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url https://rpc.testnet.dogeos.com  # Permit2 (0x = absent)
```

---

## Determinism notes
- `bytecode_hash = "none"` strips nondeterministic metadata so identical source + settings yield
  identical bytecode.
- `evm_version = "prague"` is required: the contract relies on EIP-1153 transient storage
  (`ReentrancyGuardTransient`) and PUSH0, both probe-confirmed on DogeOS (`CHAIN_FACTS.md §3`).
- Pin solc to exactly `0.8.30` and `optimizer_runs = 1_000_000` to match the deployed artifact.
