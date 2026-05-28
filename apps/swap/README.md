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
- Quote-only sources: MuchFi V3, Barkswap Algebra
- Project wallet shown by default: `0x00B6F77d55967669Ea37f47Fc469FF47782007E4`

Wallet connection uses `window.ethereum` when available and requests/switches to DogeOS Chikyu. The local server proxies `/rpc/dogeos` to the official Chikyu RPC so the header balance and block height can be read live without exposing private keys.

Quote and swap execution are state-machine driven until the router transaction builder is wired into the frontend.
