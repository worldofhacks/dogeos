# DogeOS Chikyu Testnet

## Network

| Field | Value |
| --- | --- |
| RPC | `https://rpc.testnet.dogeos.com` |
| WS RPC | `wss://ws.rpc.testnet.dogeos.com` |
| Chain ID | `6281971` |
| Symbol | `DOGE` |
| Block explorer | `https://blockscout.testnet.dogeos.com` |

Validation snapshot, 2026-05-02:

| Check | Result |
| --- | --- |
| Official RPC `eth_chainId` | `0x5fdaf3` / `6281971` |
| Unifra public RPC `eth_chainId` | `0x5fdaf3` / `6281971` |
| Blockscout HTTP status | `200` |
| Faucet HTTP status | `200` |
| Dev portal HTTP status | `200` |
| SDK docs HTTP status | `200` |
| Wallet SDK demo HTTP status | `200` |
| L2scan root HTTP status | `404` during validation; keep as provided link, but use Blockscout as validation source until confirmed. |

## Developer Resources

| Resource | URL |
| --- | --- |
| Docs | `https://docs.dogeos.com` |
| Faucet | `https://faucet.testnet.dogeos.com` |
| Dev portal | `https://portal.testnet.dogeos.com` |
| Unifra RPC | `https://dogeos-testnet-public.unifra.io/` |
| L2scan Explorer | `https://dogeos-testnet.l2scan.co/` |
| Unifra Private API Keys | `https://console.unifra.io/` |

## Wallet SDK

The DogeOS Wallet SDK is the official React library for building on DogeOS. It enables social login and supports major browser wallets.

The SDK docs confirm DogeOS Chikyū Testnet as an EVM network with chain ID `6281971`, native currency `DOGE`, RPC `https://rpc.testnet.dogeos.com`, and Blockscout explorer `https://blockscout.testnet.dogeos.com`.

| Resource | URL |
| --- | --- |
| Demo | `https://dogeos-connect-kit-v3.vercel.app/` |
| Docs | `https://docs.dogeos.com/en/sdk` |

## Official Testnet Tokens

These tokens are for DeFi builders and are accessible from the faucet.

On-chain validation at block `4620801`:

| Symbol | Address | On-chain name | Decimals | Bytecode |
| --- | --- | --- | --- | --- |
| WDOGE | `0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE` | `Wrapped Doge` | `18` | Present |
| LBTC | `0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E` | `Lombard Staked BTC` | `18` | Present |
| WETH | `0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000` | `Wrapped Ethereum` | `18` | Present |
| USD1 | `0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F` | `World Liberty Financial USD` | `18` | Present |
| USDC | `0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925` | `USD Coin` | `18` | Present |
| USDT | `0xC81800b77D91391Ef03d7868cB81204E753093a9` | `Tether` | `18` | Present |
