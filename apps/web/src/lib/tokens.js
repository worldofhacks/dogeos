// tokens.js — decorate the REAL /tokens catalog with display metadata.
//
// The backend /tokens response gives { symbol, name, address, decimals,
// provenance } — no glyph/color/verified flag. The design's TokenIcon needs a
// glyph + color, and the picker shows a verified badge. We derive those from the
// same symbol maps app.js used, and treat the documented `provenance` as the
// verification signal (every official DogeOS token is faucet+RPC validated).

const TOKEN_GLYPHS = {
  DOGE: "Ð",
  WDOGE: "Ð",
  USDC: "$",
  USDT: "$",
  USD1: "$",
  WETH: "Ξ",
  LBTC: "₿",
};

const TOKEN_COLORS = {
  DOGE: "#c2a633",
  WDOGE: "#e0b84a",
  USDC: "#2775ca",
  USDT: "#26a17b",
  USD1: "#b5891d",
  WETH: "#627eea",
  LBTC: "#f7931a",
};

export function tokenGlyph(token) {
  return TOKEN_GLYPHS[token?.symbol] ?? token?.symbol?.slice(0, 1) ?? "?";
}

export function tokenColor(token) {
  return TOKEN_COLORS[token?.symbol] ?? "#8a8779";
}

// Official DogeOS tokens carry a `provenance` of "dogeos-faucet-rpc-validated".
// Anything with that provenance (or an explicit `verified: true`) is verified.
export function tokenVerified(token) {
  if (token?.verified === false) return false;
  if (token?.verified === true) return true;
  return typeof token?.provenance === "string" && token.provenance.length > 0;
}

// Shape an API token for primitives.jsx's TokenIcon ({ color, glyph, sym }).
export function decorateToken(token) {
  if (!token) return null;
  return {
    ...token,
    sym: token.symbol,
    color: tokenColor(token),
    glyph: tokenGlyph(token),
    verified: tokenVerified(token),
    logo: token.logo ?? token.iconUrl ?? token.icon_url ?? null,
  };
}

export function tokenSearchText(token) {
  return `${token.symbol} ${token.name ?? ""} ${token.address}`.toLowerCase();
}

export function filterTokens(tokens, query) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) return tokens;
  return tokens.filter((token) => tokenSearchText(token).includes(normalized));
}

export function compactAddress(address) {
  if (!address) return "-";
  if (address === "native") return "native";
  if (address.length <= 11) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
