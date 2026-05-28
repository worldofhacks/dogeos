# DogeOS Swap Frontend

This implements the Claude Design `Prototype.html` handoff as a local DogeOS Chikyu swap surface.

Run it with:

```bash
pnpm frontend:swap
```

The first screen is the swap app, not a landing page. The UI keeps the handoff's dark warm amber visual system, swap card, route intelligence panel, token selector, review modal, transaction states, mobile shell, and source status rows.

Design preview controls are hidden by default so the app opens as a product surface. Append `?preview=1` to show the state rail and tweak panel from the handoff.

Repo-grounded details:

- Chain: DogeOS Chikyu testnet, `6281971`
- RPC: `https://rpc.testnet.dogeos.com`
- Explorer: `https://blockscout.testnet.dogeos.com`
- Executable source: MuchFi V2
- Planned sources: MuchFi V3, Barkswap Algebra
- Read-only fallback wallet for disconnected quote context: `0x00B6F77d55967669Ea37f47Fc469FF47782007E4`

Wallet connection discovers injected EIP-1193 providers, EIP-6963 announced wallets, and MyDoge/DogeOS-style injected providers. Connect calls `eth_requestAccounts`, validates `eth_chainId`, and sends swap transactions through the selected provider. Disconnect clears local session state and calls provider `disconnect`, `close`, or `wallet_revokePermissions` when the wallet supports it. WalletConnect QR support needs a project id and is intentionally not bundled yet.

The local server proxies `/rpc/dogeos` to the official Chikyu RPC so balances and block height can be read live without exposing private keys.

Live quote and transaction calldata endpoints:

- `GET /api/config` exposes non-secret Chikyu token/source/deployment metadata.
- `GET /api/balances?address=0x...` reads native DOGE plus configured ERC-20 balances from Chikyu.
- `GET /api/quote?tokenIn=DOGE&tokenOut=USDC&amountIn=0.0001&recipient=0x...` reads MuchFi V2 pair state and adapter quotes from Chikyu, then returns router calldata for wallet execution when the route is executable.

Current execution support is limited to direct verified MuchFi V2 routes through the deployed router and adapter. MuchFi V2 two-hop routes such as `USDC -> WDOGE -> USDT` are returned as live quote-only alternatives until a multihop adapter/router path is deployed, allowlisted, preflighted, and canaried.
