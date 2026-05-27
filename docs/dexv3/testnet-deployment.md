# DogeOS Chikyu Testnet Deployment

Scope: deploy the V1 `DogeOSSwapRouter` and `DogeOSV2PairAdapter` separately. This does not enable external DEX execution adapters, does not deploy owned liquidity, and does not add Baseline/RFQ/split-routing modules.

## Local Secrets

Create a local `.env` in the V1 worktree:

```bash
cd /Users/quietguy/Documents/Dev/dogeos/.worktrees/dogeos-dex-v1-security
cp .env.example .env
```

Set these values locally:

```bash
DOGEOS_RPC_URL=https://rpc.testnet.dogeos.com
DOGEOS_BLOCKSCOUT_URL=https://blockscout.testnet.dogeos.com
DOGEOS_BLOCKSCOUT_API_KEY=optional_blockscout_api_key_if_required
DEPLOYER_PRIVATE_KEY=0x...
DEPLOYER_ADDRESS=0x...
ROUTER_OWNER_ADDRESS=0x...
WDOGE_ADDRESS=0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE
USDC_ADDRESS=0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925
DOGEOS_MUCHFI_V2_FACTORY_ADDRESS=0x7864071B532894216e3C045a74814EafEB92ae20
DOGEOS_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS=0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4
```

`ROUTER_OWNER_ADDRESS` can be omitted for testnet, in which case the deployer becomes the router owner. Use a fresh testnet-only key; do not use a key that has appeared in chat for mainnet or funded environments.

## Commands

Run the full local checks:

```bash
pnpm preflight:full
```

The full preflight runs unit tests, seeded AMM integration tests, DogeOS V2 adapter tests, placeholder scan, compile, coverage, router gas profiling, DogeOS fork adapter gas profiling, dependency audits, and DogeOS router deployment preflight. It does not broadcast.

Run deployment preflight:

```bash
pnpm deploy:preflight:router
```

Run the router gas profile independently:

```bash
pnpm gas:router
```

Run the DogeOS V2 adapter fork gas profile independently:

```bash
pnpm gas:dogeos-v2-adapter
```

The preflight writes `deployments/dogeos-chikyu/router-preflight-latest.json` with the exact chain, owner, WDOGE, nonce, predicted router address, gas estimate, and cost estimate.

Deploy only after reviewing that file:

```bash
CONFIRM_DOGEOS_TESTNET_DEPLOY=deploy-dogeos-router pnpm deploy:router
```

After deployment, verify using the deployment artifact or `DOGEOS_SWAP_ROUTER_ADDRESS`:

```bash
pnpm deploy:verify:router
pnpm deploy:verify-source:router
```

Deploy the MuchFi V2 direct-pair adapter only after router verification:

```bash
pnpm deploy:preflight:adapter
CONFIRM_DOGEOS_TESTNET_ADAPTER_DEPLOY=deploy-dogeos-v2-adapter pnpm deploy:adapter
pnpm deploy:verify:adapter
pnpm deploy:verify-source:adapter
```

The verification scripts can read `deployments/dogeos-chikyu/router-latest.json` and `deployments/dogeos-chikyu/adapter-latest.json`, so local `.env` does not need public deployment addresses immediately after broadcast.

Before enabling execution, run the allowlist preflight:

```bash
pnpm deploy:preflight:allowlist:adapter
```

Only after explicit approval, allowlist the adapter and then run route preflight:

```bash
CONFIRM_DOGEOS_TESTNET_ALLOWLIST=allowlist-dogeos-v2-adapter pnpm deploy:allowlist:adapter
pnpm deploy:preflight:route:v2
```

## Deployment Gates

- `.env` must stay untracked.
- Chain ID must be `6281971`.
- Solidity compiler must remain `0.8.30` with EVM target `prague`.
- WDOGE bytecode must exist at `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE`.
- Deployer address derived from the private key must match `DEPLOYER_ADDRESS` if that address is set.
- Deployer balance must cover the estimated deployment cost.
- Router and adapter deploy scripts do not allowlist any external adapter.
- Blockscout source verification must be run after deployment.
- Any post-deploy adapter allowlist transaction requires a separate preflight and explicit approval.
- `DogeOSV2PairAdapter` deployment and allowlisting are separate actions from router deployment.
- Route preflight intentionally refuses to run until the adapter is already allowlisted.
