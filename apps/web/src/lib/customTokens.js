// customTokens.js — user-imported tokens discovered by pasting a contract
// address. Persisted in localStorage so they survive reloads and are merged
// into the tradeable token list everywhere the official tokens are used.

const STORAGE_KEY = "doge.customTokens";
const EVENT = "doge:custom-tokens-updated";

function read() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export const CUSTOM_TOKENS_EVENT = EVENT;

export function getCustomTokens() {
  return read();
}

// Add (or refresh) a discovered token. Keyed by lowercased address; symbol/
// name/decimals come from the on-chain scan. `custom: true` marks it in the UI.
export function addCustomToken(token) {
  const address = String(token?.address ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) return read();
  const entry = {
    address,
    symbol: token.symbol ?? `${address.slice(0, 6)}…`,
    name: token.name ?? token.symbol ?? address,
    decimals: Number(token.decimals ?? 18),
    custom: true,
    provenance: token.provenance ?? "discovered-onchain",
  };
  const list = read().filter((t) => String(t.address).toLowerCase() !== address);
  list.push(entry);
  write(list);
  return list;
}

export function removeCustomToken(address) {
  const lower = String(address ?? "").toLowerCase();
  write(read().filter((t) => String(t.address).toLowerCase() !== lower));
}

// Merge official + custom tokens, de-duped by address (official wins so a
// pasted official token never shadows the curated metadata).
export function mergeTokens(officialTokens = [], customTokens = read()) {
  const byAddress = new Map();
  for (const token of customTokens) {
    byAddress.set(String(token.address).toLowerCase(), token);
  }
  for (const token of officialTokens) {
    byAddress.set(String(token.address).toLowerCase(), token);
  }
  return [...byAddress.values()];
}
