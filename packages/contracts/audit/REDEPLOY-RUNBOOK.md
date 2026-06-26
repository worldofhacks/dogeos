# Redeploy + governance handover runbook — DogeSwapRouter

**Why:** the live router `0xa3158549f38400F355aDf20C92DA1769620Aa35A` is the **pre-hardening**
build (verified 2026-06-26: its bytecode lacks the `InvalidRecipient`/`InvalidFeeRecipient`
selectors) and is **immutable**, so the only way to ship the H1–H11 hardening is a fresh deploy +
cutover. The same action also closes the open governance gap (the EOA
`0xE659A8d3745b1355CA47B3d92925997Ef93a2873` currently owns **both** the live router and the live
registry `0xC596…1215`; the router's `acceptOwnership()` to timelock
`0xf3410B762Db55aA3CBAfaa5707899b3d3A7F1773` was never executed).

This runbook is the end-to-end sequence. Deploy mechanics are in [`DEPLOYMENT.md`](./DEPLOYMENT.md);
this adds the governance handover, the **cutover sequencing**, and verification. No on-chain action
is automated here — every governance step is a deliberate Safe/timelock transaction.

> **Golden rule (cutover safety):** the new router **ships PAUSED** and stays paused until governance
> unpauses it *after* the ownership handover (hours-to-days, gated by `TIMELOCK_MIN_DELAY`). Do **NOT**
> point `DOGESWAP_ROUTER_ADDRESS` at the new router until it is unpaused — a paused router reverts
> every `execute()` (`whenNotPaused`), which would break ~100% of UI swaps. The old router keeps
> serving traffic until the very last cutover step. This means **`deploy-router.sh`'s automatic env
> repoint + restart must be skipped/deferred** for a cutover (it is meant for a fresh bring-up).

---

## 0. Pre-flight

```bash
source ~/.nvm/nvm.sh && nvm use 22 && export PATH="$HOME/.foundry/bin:$PATH"
cd /home/actlabs/dogeswap-staging/packages/contracts   # the deploy checkout
forge test            # MUST be 60 passed / 0 failed (incl. 6 invariants @ 25,600 calls, H10/H11 tests)
```

Set **real** governance keys in `~/dogeswap-deploy/router.env` (do NOT ship the testnet stand-in
where `ROUTER_SAFE == deployer`):

| env var | value |
|---|---|
| `ROUTER_SAFE` | the project Gnosis **Safe** (becomes timelock proposer/executor **and** registry owner) |
| `ROUTER_GUARDIAN` | a **distinct** pause-only hot key — **must NOT equal** `ROUTER_SAFE` or the EOA (this is the guardian split) |
| `TIMELOCK_MIN_DELAY` | seconds (recommend 24–48h for any "hardened-governance" claim) |
| `CAP_DEFAULT` / `CAP_WDOGE` / `CAP_USDC` / `CAP_USDT` | per-token notional caps |

Fund the deployer with a little testnet DOGE (`cast balance --rpc-url https://rpc.testnet.dogeos.com <deployer>`).

---

## 1. Deploy the hardened router (ships PAUSED)

Run the forge script directly (so the env is **not** auto-repointed — see the golden rule):

```bash
cd /home/actlabs/dogeswap-staging/packages/contracts
PK=$(cat ~/dogeswap-deploy/deployer.key); set -a; . ~/dogeswap-deploy/router.env; set +a
forge script script/DeployRouter.s.sol --rpc-url https://rpc.testnet.dogeos.com \
  --private-key "$PK" --broadcast --slow | tee /tmp/router-redeploy.log
```

The single broadcast (per `DeployRouter.s.sol`): deterministic Permit2 (no-op — already live) →
TimelockController (proposer/executor = Safe, **admin = address(0)**, H8) → router (deployer = temp
owner) → sets WDOGE/USDC/USDT **and NATIVE** caps (H9) → asserts `feeBps()==0` → **`router.pause()`**
(H7) → new registry pointed at the router and transferred to the Safe → `router.transferOwnership(timelock)`
(Ownable2Step — pending until accepted).

Record from the log: `NEW_ROUTER`, `NEW_REGISTRY`, `TIMELOCK`.

**Confirm the hardening is actually in the deployed bytecode** (this is the check the old router fails):

```bash
RPC=https://rpc.testnet.dogeos.com
cast code $NEW_ROUTER --rpc-url $RPC | grep -qi 9c8d2cd2 && echo "InvalidRecipient present (H2 ✓)"
cast code $NEW_ROUTER --rpc-url $RPC | grep -qi 768dc598 && echo "InvalidFeeRecipient present (H1 ✓)"
cast call $NEW_ROUTER "paused()(bool)" --rpc-url $RPC          # expect true
cast call $NEW_ROUTER "feeBps()(uint256)" --rpc-url $RPC       # expect 0
cast call $NEW_ROUTER "pendingOwner()(address)" --rpc-url $RPC # expect $TIMELOCK
```

---

## 2. Governance handover (via the Safe) — the step never completed on the live router

Two `Ownable2Step.acceptOwnership()` acceptances + the guardian split. Full command detail in
[`DEPLOYMENT.md` §6](./DEPLOYMENT.md).

**2a. Router owner → TimelockController.** From the Safe (proposer), `timelock.schedule(...)` an
`acceptOwnership()` call targeting `NEW_ROUTER`; wait `TIMELOCK_MIN_DELAY`; from the Safe (executor),
`timelock.execute(...)` the same. Verify:

```bash
cast call $NEW_ROUTER "owner()(address)" --rpc-url $RPC   # expect $TIMELOCK (NOT the EOA, NOT the deployer)
```

**2b. Registry owner → Safe.** From the Safe, `acceptOwnership()` on `NEW_REGISTRY`:

```bash
cast call $NEW_REGISTRY "owner()(address)" --rpc-url $RPC  # expect $ROUTER_SAFE
```

**2c. Guardian split / admin hygiene.** Confirm the guardian is the distinct pause-only key and that
no delay-bypassing admin role lingers (H8 already deploys the timelock with `admin = address(0)`, so a
fresh deploy avoids the live router's "EOA holds DEFAULT_ADMIN_ROLE" problem — verify it):

```bash
cast call $NEW_ROUTER "guardian()(address)" --rpc-url $RPC   # expect ROUTER_GUARDIAN, != Safe, != EOA
DEFAULT_ADMIN=0x0000000000000000000000000000000000000000000000000000000000000000
cast call $TIMELOCK "hasRole(bytes32,address)(bool)" $DEFAULT_ADMIN $ROUTER_SAFE --rpc-url $RPC  # expect false
cast call $TIMELOCK "hasRole(bytes32,address)(bool)" $DEFAULT_ADMIN 0xE659A8d3745b1355CA47B3d92925997Ef93a2873 --rpc-url $RPC  # expect false
```

---

## 3. Unpause (governance) — only after 2a completes

The timelock now owns the router, and `unpause()` is owner-only. From the Safe, schedule + execute
`router.unpause()` through the timelock:

```bash
cast call $NEW_ROUTER "paused()(bool)" --rpc-url $RPC   # expect false after execution
```

---

## 4. Cutover (only now — router is hardened, owned-by-timelock, unpaused)

Point both web envs at the new router and restart. Server reads it at runtime — no rebuild:

```bash
for env in prod staging; do
  sed -i "s|^DOGESWAP_ROUTER_ADDRESS=.*|DOGESWAP_ROUTER_ADDRESS=$NEW_ROUTER|" /home/actlabs/dogeswap-$env/.env
  systemctl --user restart dogeswap-$env
done
```

(Optionally also commit the new `DOGESWAP_ROUTER_ADDRESS` if it is tracked, and bump the on-chain
`DogeSwapRegistry.setCurrentRouter` if/when any integrator starts reading it — today the app pins the
router via env, not the registry, so the registry is for external integrators.)

---

## 5. Post-cutover verification

```bash
# API resolves the new router + a real swap routes/executes through it:
curl -s http://127.0.0.1:8080/chain-status | python3 -c 'import sys,json;print(json.load(sys.stdin))'
curl -s -X POST http://127.0.0.1:8080/quote -H 'content-type: application/json' \
  -d '{"chainId":6281971,"sellToken":"0xd19d2ffb1c284668b7afe72cddae1baf3bc03925","buyToken":"0xf6bdb158a5ddf77f1b83bc9074f6a472c58d78ae","amountIn":"1000000","slippageBps":"50"}'
```

Then run one real small swap end-to-end in the UI and confirm it settles through `NEW_ROUTER`
(check the tx on Blockscout). Watch `journalctl --user -u dogeswap-prod -f` for errors.

**Rollback:** because the cutover is a one-line env change + restart, reverting is instant — set
`DOGESWAP_ROUTER_ADDRESS` back to the old `0xa315…Aa35A` and restart. (The old router keeps working;
it is simply un-hardened. Keep it as the fallback until the new router has soaked.)

---

## Checklist

- [ ] `forge test` = 60/0 on the deploy checkout
- [ ] `router.env`: real Safe, **distinct** guardian, sane `TIMELOCK_MIN_DELAY`
- [ ] Deploy broadcast OK; `NEW_ROUTER` has `InvalidRecipient`/`InvalidFeeRecipient` selectors, `paused()==true`, `feeBps()==0`, `pendingOwner()==TIMELOCK`
- [ ] 2a: `router.owner() == TIMELOCK` (EOA no longer owns)
- [ ] 2b: `registry.owner() == Safe`
- [ ] 2c: guardian split; no `DEFAULT_ADMIN_ROLE` on Safe/EOA
- [ ] 3: `router.paused() == false`
- [ ] 4: both envs repointed + restarted (NOT before unpause)
- [ ] 5: live `/quote` + one real UI swap settle through the new router; rollback path confirmed
