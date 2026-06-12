# DogeSwap Experience Audit — 2026-06-12

A two-track audit of **DogeSwap**, a non-custodial DEX aggregator on the **DogeOS Chikyū Testnet** (chainId **6281971**, `0x5fdaf3`, RPC `https://rpc.testnet.dogeos.com`).

## Scope

The production app on `main`: the `DogeSwapRouter` swap engine and registry, the aggregator quote/routing/calldata layer, the chain-correctness config and DogeOS fee model, the `@dogeos/dogeos-sdk` wallet integration, the HTTP backend, and the end-user UX — plus DogeOS ecosystem fit, competitive positioning, and the **featuring go/no-go decision**.

## Method

Multi-agent review: a **senior DogeOS protocol engineer** track (security/correctness) and a **head of ecosystem** track (UX, competitive/ecosystem fit, featuring), with **live on-chain verification** of every config claim (chain identity, tokens, venues, pools, fee oracle, Permit2, and full router governance state) via `cast` and a real RFC6455 WebSocket handshake against the live testnet. Findings reflect post-verification severities; one prior finding (a "dead WS endpoint") was overturned by ground truth and withdrawn.

## Headline

- **Engineering:** swap engine well-built and DogeOS-correct; **NOT mainnet-ready** — governance is the hard blocker (single EOA owns everything, timelock delay bypassable). Findings: 2 Critical, 4 High, 12 Medium, 14 Low, 7 Info (39 total).
- **Ecosystem:** **CONDITIONAL GO** — the most credible DogeOS-native dApp reviewed, but do not feature today: false chain copy, trust posture weaker than its docs, and an unverified flagship contract.

## File Map

| File | Contents |
|---|---|
| [`EXECUTIVE-SUMMARY.md`](./EXECUTIVE-SUMMARY.md) | TL;DR, top-5 must-fix, severity counts, strengths, go/no-go |
| [`report-engineer.md`](./report-engineer.md) | Engineering / security / correctness report |
| [`report-ecosystem.md`](./report-ecosystem.md) | UX, competitive & ecosystem fit, featuring decision |
| [`findings/contracts.md`](./findings/contracts.md) | DogeSwapRouter / Registry / deploy stack |
| [`findings/chain-correctness.md`](./findings/chain-correctness.md) | Config, RPC client, fee model |
| [`findings/aggregator.md`](./findings/aggregator.md) | Quote math, routing, calldata builder |
| [`findings/sdk.md`](./findings/sdk.md) | `@dogeos/dogeos-sdk` wallet integration |
| [`findings/backend.md`](./findings/backend.md) | HTTP API, hardening, ops |
| [`findings/ux.md`](./findings/ux.md) | Wallet, swap flow, success-screen UX |
| [`findings/ecosystem.md`](./findings/ecosystem.md) | DogeOS-native fit, chain claims, transparency |
| [`findings/competitive.md`](./findings/competitive.md) | Positioning vs MuchFi / Barkswap |
