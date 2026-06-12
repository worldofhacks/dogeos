// api.js — typed helpers over the aggregator API (served by the vite proxy and
// packages/web/src/server.mjs). Extracted from app.js's fetchJson pattern.

export const DOGEOS_CHAIN_ID = 6_281_971;

// Canonical DogeOS testnet links (per docs.dogeos.com + testnet config). Used by
// the Activity (Blockscout links) and Settings (explorer/faucet) views. The
// chain-status payload also carries live copies of these.
export const DOGEOS_BLOCKSCOUT_URL = "https://blockscout.testnet.dogeos.com";
export const DOGEOS_FAUCET_URL = "https://faucet.testnet.dogeos.com";
export const DOGEOS_DOCS_URL = "https://docs.dogeos.com";

export async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error?.message ?? `Request failed: ${response.status}`);
  }

  return body;
}

function postJson(path, payload) {
  return fetchJson(path, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

/* ---------- GET endpoints ---------- */
export function getChainStatus() {
  return fetchJson("/chain-status");
}

export function getTokens() {
  return fetchJson("/tokens");
}

// Discover a pasted token: ERC-20 metadata + live pools across every venue.
// Returns { token, pools, routable, pairedWith }. Throws on a non-token / no
// pools, with the server's user-actionable message.
export function scanToken(address) {
  return fetchJson(`/token?address=${encodeURIComponent(address)}`);
}

export function getSources() {
  return fetchJson("/sources");
}

export function getVenues() {
  return fetchJson("/venues");
}

export function getVerification() {
  return fetchJson("/verification");
}

export function getIntelligence() {
  return fetchJson("/intelligence");
}

export function getActivity(address, limit) {
  const params = new URLSearchParams();
  if (address) params.set("address", address);
  if (limit != null) params.set("limit", String(limit));
  const query = params.toString();
  return fetchJson(`/activity${query ? `?${query}` : ""}`);
}

/* ---------- POST endpoints ---------- */
export function postQuote(body) {
  return postJson("/quote", body);
}

export function postApproval(body) {
  return postJson("/approval", body);
}

export function postSwap(body) {
  return postJson("/swap", body);
}
