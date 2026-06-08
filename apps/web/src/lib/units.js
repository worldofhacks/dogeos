// units.js — framework-agnostic token math + input parsing.
// Extracted from app.js (decimalToUnits / unitsToDecimal / the [0-9.] input
// rule) so React components and hooks can share the exact same on-chain math the
// legacy DOM app used. No DOM, no React — pure functions over strings/BigInt.

/* ---------- amount input parsing (the swap input accepts [0-9.] only) ---------- */
// Mirror app.js's `e.target.value.replace(/[^0-9.]/g, '')`, but also collapse to a
// single decimal point so "1.2.3" can't sneak past decimalToUnits.
export function sanitizeAmountInput(raw) {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  // keep the first dot, strip any later ones
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

/* ---------- decimal <-> base units (BigInt) ---------- */
// "1.25", 18 -> "1250000000000000000". Throws for non-positive / malformed input.
export function decimalToUnits(value, decimals) {
  const raw = String(value ?? "").trim();
  if (!/^\d+(\.\d*)?$/.test(raw)) {
    throw new Error("Amount must be a positive decimal.");
  }

  const [whole, fraction = ""] = raw.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const units = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(paddedFraction || "0");

  if (units <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }

  return units.toString();
}

// "1250000000000000000", 18 -> "1.25" (trailing zeros trimmed, capped at `precision`).
export function unitsToDecimal(value, decimals, precision = 6) {
  if (value === undefined || value === null || value === "") return "-";
  const units = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = units % base;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, precision);
  const trimmedFraction = fractionText.replace(/0+$/, "");

  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

// base-units BigInt -> JS number (for slider math / display only; not for execution).
export function unitsToNumber(value, decimals) {
  if (value === undefined || value === null || value === "") return 0;
  try {
    const n = Number(unitsToDecimal(value, decimals, Math.min(decimals, 12)));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/* ---------- token lookup (over the /tokens catalog shape) ---------- */
export function tokenByAddress(tokens, address) {
  const normalized = String(address ?? "").toLowerCase();
  return tokens.find((token) => String(token.address).toLowerCase() === normalized) ?? null;
}

export function tokenBySymbol(tokens, symbol) {
  return tokens.find((token) => token.symbol === symbol) ?? null;
}

/* ---------- ERC-20 balanceOf ABI codec (extracted from app.js) ---------- */
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

export function normalizeHexAddress(value, fieldName = "address") {
  const address = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return address;
}

export function encodeErc20BalanceOf(owner) {
  const word = normalizeHexAddress(owner, "owner").slice(2).padStart(64, "0");
  return `${ERC20_BALANCE_OF_SELECTOR}${word}`;
}

export function decodeUint256Result(value, fieldName = "result") {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a uint256 ABI result.`);
  }
  return BigInt(normalized).toString();
}

// Stable key for the per-token balance map (lowercased address).
export function walletBalanceKey(tokenAddress) {
  return normalizeHexAddress(tokenAddress, "token");
}
