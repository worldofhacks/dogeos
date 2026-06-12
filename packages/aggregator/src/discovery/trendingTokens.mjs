// trendingTokens.mjs — surface popular *unverified* tokens for the picker,
// beyond the curated official list. Sourced from the chain explorer
// (Blockscout) and filtered for the realities of a public token list:
//
//   • clone-spam removed: a symbol minted under many identical contracts (the
//     classic testnet airdrop-spam pattern) is dropped entirely.
//   • lending/debt artifacts removed (variableDebt*, aToken, interest-bearing).
//   • officials removed (already shown as verified).
//   • every survivor is checked for a LIVE POOL on our venues; tradeable ones
//     sort first. This is the strongest anti-scam signal a DEX has — a token
//     someone actually provided liquidity for — and matches "trending on the
//     venues we have".
//
// Everything here is marked `verified: false` so the UI can badge it clearly.

import { scanVenuePools } from "./poolScan.mjs";

const DEFAULT_LIMIT = 12;
const DEFAULT_CANDIDATE_SCAN = 18;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const CLONE_SPAM_THRESHOLD = 3; // a symbol under >=3 distinct contracts = spam

function normalizeAddress(value) {
  const normalized = String(value ?? "").toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : null;
}

function looksLikeLendingArtifact(symbol, name) {
  const text = `${symbol} ${name}`.toLowerCase();
  return /debt|interest.?bearing|\baave\b|^a[a-z]+ vault|supply receipt/.test(text);
}

function decimalsOf(item) {
  const value = Number(item.decimals);
  return Number.isInteger(value) && value >= 0 && value <= 36 ? value : null;
}

export function createTrendingTokensProvider({
  client,
  fetchFn = fetch,
  blockscoutBaseUrl,
  baseTokens = [],
  officialAddresses = [],
  limit = DEFAULT_LIMIT,
  candidateScanLimit = DEFAULT_CANDIDATE_SCAN,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  nowMs = () => Date.now(),
} = {}) {
  const officialSet = new Set(officialAddresses.map((a) => String(a).toLowerCase()));
  const baseAddresses = baseTokens.map((t) => t.address);
  let cache = { at: 0, data: null };
  let inflight = null;

  async function fetchBlockscoutTopTokens() {
    const url = `${blockscoutBaseUrl}/api/v2/tokens?type=ERC-20&sort=holders_count&order=desc`;
    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`Blockscout token list failed: ${response.status}`);
    const body = await response.json();
    return Array.isArray(body.items) ? body.items : [];
  }

  function shortlistCandidates(items) {
    // Count distinct contracts per symbol to detect clone spam.
    const contractsPerSymbol = new Map();
    for (const item of items) {
      const symbol = String(item.symbol ?? "").trim();
      const address = normalizeAddress(item.address ?? item.address_hash);
      if (!symbol || !address) continue;
      const set = contractsPerSymbol.get(symbol.toLowerCase()) ?? new Set();
      set.add(address);
      contractsPerSymbol.set(symbol.toLowerCase(), set);
    }

    const bySymbol = new Map();
    for (const item of items) {
      const address = normalizeAddress(item.address ?? item.address_hash);
      const symbol = String(item.symbol ?? "").trim();
      const name = String(item.name ?? "").trim();
      const decimals = decimalsOf(item);
      const holders = Number(item.holders_count ?? item.holders ?? 0);

      if (!address || !symbol || decimals === null) continue;
      if (officialSet.has(address)) continue;
      if ((contractsPerSymbol.get(symbol.toLowerCase())?.size ?? 0) >= CLONE_SPAM_THRESHOLD) continue;
      if (looksLikeLendingArtifact(symbol, name)) continue;

      const existing = bySymbol.get(symbol.toLowerCase());
      if (!existing || holders > existing.holders) {
        bySymbol.set(symbol.toLowerCase(), { address, symbol, name: name || symbol, decimals, holders });
      }
    }

    return [...bySymbol.values()]
      .sort((a, b) => b.holders - a.holders)
      .slice(0, candidateScanLimit);
  }

  async function build() {
    const items = await fetchBlockscoutTopTokens();
    const candidates = shortlistCandidates(items);

    const enriched = await Promise.all(
      candidates.map(async (candidate) => {
        let venues = [];
        if (client) {
          for (const base of baseAddresses) {
            if (base.toLowerCase() === candidate.address) continue;
            // eslint-disable-next-line no-await-in-loop
            const pools = await scanVenuePools({
              client,
              tokenA: candidate.address,
              tokenB: base,
            }).catch(() => []);
            venues = [...new Set([...venues, ...pools.map((p) => p.sourceId)])];
            if (venues.length) break; // one tradeable base is enough to flag it
          }
        }
        return {
          address: candidate.address,
          symbol: candidate.symbol,
          name: candidate.name,
          decimals: candidate.decimals,
          holders: candidate.holders,
          verified: false,
          trending: true,
          tradeable: venues.length > 0,
          venues,
        };
      }),
    );

    return enriched
      .sort((a, b) => Number(b.tradeable) - Number(a.tradeable) || b.holders - a.holders)
      .slice(0, limit);
  }

  return async function trendingTokens() {
    const now = nowMs();
    if (cache.data && now - cache.at <= cacheTtlMs) return cache.data;
    if (inflight) return inflight;
    inflight = build()
      .then((data) => {
        cache = { at: nowMs(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
    try {
      return await inflight;
    } catch {
      // On failure, serve stale cache if any, else empty — never break the picker.
      return cache.data ?? [];
    }
  };
}
