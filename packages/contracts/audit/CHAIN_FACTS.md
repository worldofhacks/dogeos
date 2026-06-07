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

## 2. OP-Stack Confirmation (GasPriceOracle predeploy)

```
$ cast code 0x5300000000000000000000000000000000000002 --rpc-url https://rpc.testnet.dogeos.com | head -c 60
0x608060405234801561000f575f80fd5b50600436106101a1575f3560e0
```

Bytecode is present (non-empty `0x...`) at the canonical OP-Stack GasPriceOracle predeploy address. This confirms the chain is an OP-Stack (Bedrock) deployment.

---

## 3. EVM Version — Pre-Shanghai / Pre-Cancun

```
$ cast block latest --rpc-url https://rpc.testnet.dogeos.com --json \
    | grep -E 'withdrawalsRoot|excessBlobGas|blobGasUsed' \
    || echo "NO_SHANGHAI_OR_CANCUN_FIELDS"
NO_SHANGHAI_OR_CANCUN_FIELDS
```

The latest block header contains **no** `withdrawalsRoot` (Shanghai), `excessBlobGas`, or `blobGasUsed` (Cancun) fields.

**Conclusion:**
- `evm_version = "paris"` in foundry.toml
- `PUSH0` opcode is **forbidden** (introduced in Shanghai/EIP-3855)
- Transient storage (`TLOAD`/`TSTORE`) is **forbidden** (introduced in Cancun/EIP-1153)
- ReentrancyGuard must use **storage-based** locking (not transient-storage variant)

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
| Chain type                        | OP-Stack (Bedrock), confirmed via predeploy               |
| EVM version                       | paris (pre-Shanghai, pre-Cancun)                          |
| PUSH0 allowed                     | NO                                                        |
| Transient storage allowed         | NO                                                        |
| ReentrancyGuard style             | Storage-based (NOT OZ v5 transient variant)               |
| Permit2 on-chain                  | ABSENT — must deploy via Arachnid CREATE2 proxy in Phase 5 |
| MuchFi V2 router present          | YES (0xC653e745FC613a03D156DACB924AE8e9148B18dc)          |
| MuchFi V3 router present          | YES (0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB)          |
| Barkswap router present           | YES (0x77147f436cE9739D2A54Ffe428DBe02b90c0205e)          |
| WDOGE present                     | YES (0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE)          |
