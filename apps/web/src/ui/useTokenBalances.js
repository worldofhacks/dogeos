// useTokenBalances.js — read ERC-20 balances for the active token pair via the
// connected wallet's provider, ported from app.js's refreshSelectedWalletBalances
// / readWalletTokenBalance.
//
// The SDK wallet bridge exposes window.dogeosAggregatorWallet.getProvider(),
// matching how app.js reads balances. We do NOT modify any wallet file — we only
// read the provider it already publishes. Balances refresh whenever the owner
// address or the selected token set changes, guarded by a request sequence so a
// slow earlier read can't overwrite a newer one.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  decodeUint256Result,
  encodeErc20BalanceOf,
  walletBalanceKey,
} from "../lib/units.js";

function sdkProvider() {
  const wallet = typeof window !== "undefined" ? window.dogeosAggregatorWallet : null;
  return wallet?.getProvider?.() ?? null;
}

async function readBalance(provider, owner, token) {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token.address, data: encodeErc20BalanceOf(owner) }, "latest"],
  });
  return decodeUint256Result(result, `${token.symbol} balance`);
}

// `tokens` is the (de-duplicated) list to read — typically [sellToken, buyToken].
// Returns { balances: { [lcAddress]: unitsString }, errors, refresh, loading }.
export function useTokenBalances({ owner, chainId, tokens }) {
  const [balances, setBalances] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const seqRef = useRef(0);

  // De-dup the token set + build a stable key for the effect dependency.
  const unique = [];
  const seen = new Set();
  for (const token of tokens ?? []) {
    if (!token?.address) continue;
    let key;
    try {
      key = walletBalanceKey(token.address);
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(token);
  }
  const tokensKey = unique.map((t) => `${t.address}:${t.decimals}`).join(",");

  const refresh = useCallback(async () => {
    const provider = sdkProvider();
    if (!owner || !provider?.request || unique.length === 0) {
      seqRef.current += 1;
      setBalances({});
      setErrors({});
      setLoading(false);
      return;
    }

    const seq = ++seqRef.current;
    setLoading(true);

    const results = await Promise.all(
      unique.map(async (token) => {
        const key = walletBalanceKey(token.address);
        try {
          return { key, balance: await readBalance(provider, owner, token) };
        } catch (error) {
          return { key, error: error?.message ?? "Balance unavailable." };
        }
      }),
    );

    if (seq !== seqRef.current) return;

    const nextBalances = {};
    const nextErrors = {};
    for (const entry of results) {
      if (entry.error) nextErrors[entry.key] = entry.error;
      else nextBalances[entry.key] = entry.balance;
    }
    setBalances(nextBalances);
    setErrors(nextErrors);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, chainId, tokensKey]);

  // Refresh on owner / chain / token-set change.
  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balances, errors, loading, refresh };
}
