# DogeOS Testnet — Chain Facts Evidence

**Date recorded:** 2026-06-06
**RPC endpoint:** https://rpc.testnet.dogeos.com

---

## 1. Chain ID

```
$ cast chain-id --rpc-url https://rpc.testnet.dogeos.com
6281971
```

Hex: `0x5fdaf3` — confirmed DogeOS testnet.

---

## 2. Chain Type — Dogecoin zkEVM (NOT OP-Stack Bedrock)

```
$ cast code 0x5300000000000000000000000000000000000002 --rpc-url https://rpc.testnet.dogeos.com | head -c 60
0x608060405234801561000f575f80fd5b50600436106101a1575f3560e0
```

Bytecode is present at `0x5300...0002`. **CORRECTION:** Per the official DogeOS docs
(https://docs.dogeos.com/en/getting-started/overview and https://docs.dogeos.com/en/developers),
**DogeOS is a Dogecoin zkEVM**, NOT an OP-Stack (Bedrock) deployment. The `GasPriceOracle`
predeploy at `0x5300...0002` is a documented fee oracle — it is **not** proof of an OP-Stack
fork timeline. The earlier "OP-Stack (Bedrock), confirmed via predeploy" conclusion is
SUPERSEDED by the docs.

---

## 3. EVM Version — Prague-compatible (PUSH0 + EIP-1153 + MCOPY confirmed)

> **CORRECTION / SUPERSEDED.** The earlier "paris / pre-Shanghai / pre-Cancun /
> no PUSH0 / no transient storage" conclusion (which inferred the EVM target from
> the *absence* of `withdrawalsRoot`/`excessBlobGas`/`blobGasUsed` block-header
> fields) is **WRONG and SUPERSEDED**. Header-field absence is not a reliable EVM
> opcode-support signal on a zkEVM. The correct conclusion comes from (a) the
> official DogeOS docs and (b) a direct on-chain opcode probe.

**Docs alignment.** Per the official DogeOS developer docs
(https://docs.dogeos.com/en/developers/developer-quickstart and
https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences):
**use the `prague` EVM target and Solidity ≥ 0.8.30.**

**On-chain opcode probe (eth_call `--create`, 2026-06-06).** A throwaway init-code
blob exercising each opcode was deployed/called via `eth_call` against chain 6281971.
Results CONFIRM:

| Opcode                         | Introduced      | Probe result |
|--------------------------------|-----------------|--------------|
| `PUSH0` (0x5f)                 | Shanghai/EIP-3855 | OK         |
| `TSTORE` / `TLOAD`             | Cancun/EIP-1153 | OK           |
| `MCOPY` (0x5e)                 | Cancun/EIP-5656 | OK           |

→ Transient storage **is available**. PUSH0 **is available**.

**Conclusion (current):**
- `evm_version = "prague"` in foundry.toml
- `solc = "0.8.30"`
- `PUSH0` opcode is **allowed**
- Transient storage (`TLOAD`/`TSTORE`) is **allowed** (EIP-1153)
- ReentrancyGuard uses the **transient-storage** variant (`ReentrancyGuardTransient`)

---

## 3a. Precompile & Opcode Constraints (DogeOS-specific)

Per https://docs.dogeos.com/en/developers/ethereum-and-dogeos-differences, DogeOS
(as a zkEVM) does NOT support some mainnet precompiles/opcodes:

| Feature                                   | DogeOS support | Notes |
|-------------------------------------------|----------------|-------|
| `ecrecover` (0x01)                        | **AVAILABLE**  | EIP-712 / Permit2 signature recovery works |
| `RIPEMD-160` (0x03)                       | UNSUPPORTED    | |
| `blake2f` (0x09)                          | UNSUPPORTED    | |
| `point-evaluation` (0x0a, KZG)            | UNSUPPORTED    | |
| `modexp` (0x05)                           | LIMITED        | inputs must be ≤ 32 bytes |
| `SELFDESTRUCT`                            | DISABLED       | reverts |
| `BLOBHASH` / `BLOBBASEFEE` / EIP-4788     | UNAVAILABLE    | no blob/beacon-root support |

**Router impact:** `DogeOSAggregationRouter` uses **none** of the unsupported
precompiles/opcodes. It relies only on `ecrecover` (via Permit2 / EIP-712), which
IS available, so Permit2 signature flows are safe on DogeOS.

---

## 4. Permit2 Presence

```
$ cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url https://rpc.testnet.dogeos.com
0x
```

**Permit2 is ABSENT.** The canonical Permit2 address has no bytecode on DogeOS testnet.

**Action required in Phase 5:** Deploy Permit2 deterministically via the Arachnid `CREATE2` proxy (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) **before** deploying the aggregation router.

---

## 5. Venue Routers + WDOGE — Present

```
$ cast code 0xC653e745FC613a03D156DACB924AE8e9148B18dc --rpc-url https://rpc.testnet.dogeos.com | head -c 20
0x608060405260043610  # MuchFi V2

$ cast code 0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB --rpc-url https://rpc.testnet.dogeos.com | head -c 20
0x608060405260043610  # MuchFi V3

$ cast code 0x77147f436cE9739D2A54Ffe428DBe02b90c0205e --rpc-url https://rpc.testnet.dogeos.com | head -c 20
0x608060405260043610  # Barkswap

$ cast code 0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE --rpc-url https://rpc.testnet.dogeos.com | head -c 20
0x608060405260043610  # WDOGE
```

All four venue/token contracts are **present** with bytecode.

---

## 6. Toolchain Versions

```
forge Version: 1.7.1
Commit SHA:    4072e48705af9d93e3c0f6e29e93b5e9a40caed8
Build:         2026-05-08T07:54:31.470926000Z

cast Version:  1.7.1
Commit SHA:    4072e48705af9d93e3c0f6e29e93b5e9a40caed8
Build:         2026-05-08T07:54:31.470926000Z
```

---

## 7. Summary of Constraints

| Constraint                        | Value / Decision                                          |
|-----------------------------------|-----------------------------------------------------------|
| Chain ID                          | 6281971 (0x5fdaf3)                                        |
| Chain type                        | Dogecoin zkEVM (per docs; NOT OP-Stack Bedrock)           |
| EVM version                       | prague (PUSH0 + EIP-1153 + MCOPY confirmed on-chain)      |
| Solidity version                  | 0.8.30 (per DogeOS docs: ≥ 0.8.30)                        |
| PUSH0 allowed                     | YES (probe-confirmed)                                     |
| Transient storage allowed         | YES (EIP-1153 probe-confirmed)                            |
| ReentrancyGuard style             | Transient (OZ v5 ReentrancyGuardTransient)               |
| Precompiles unsupported           | RIPEMD-160, blake2f, point-eval; modexp ≤32B; SELFDESTRUCT off; no blobs — router uses none |
| Permit2 on-chain                  | ABSENT — must deploy via Arachnid CREATE2 proxy in Phase 5 |
| MuchFi V2 router present          | YES (0xC653e745FC613a03D156DACB924AE8e9148B18dc)          |
| MuchFi V3 router present          | YES (0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB)          |
| Barkswap router present           | YES (0x77147f436cE9739D2A54Ffe428DBe02b90c0205e)          |
| WDOGE present                     | YES (0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE)          |
