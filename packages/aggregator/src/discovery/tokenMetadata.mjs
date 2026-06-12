// tokenMetadata.mjs — read ERC-20 metadata (symbol/name/decimals) for an
// arbitrary pasted contract address. Handles both the standard string-return
// ERC-20 and the legacy bytes32-return variant (e.g. early MKR-style tokens),
// and validates the address actually hosts contract code.

const SYMBOL_SELECTOR = "0x95d89b41";
const NAME_SELECTOR = "0x06fdde03";
const DECIMALS_SELECTOR = "0x313ce567";

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function hexToUtf8(hex) {
  const bytes = [];
  for (let i = 0; i + 2 <= hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code === 0) break;
    bytes.push(code);
  }
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: false }).decode(Uint8Array.from(bytes));
  } catch {
    decoded = String.fromCharCode(...bytes);
  }
  // Keep printable characters (drop control chars by code point), trim ends.
  let out = "";
  for (const ch of decoded) {
    const code = ch.codePointAt(0);
    if (code >= 32 && code !== 127) out += ch;
  }
  return out.trim();
}

// Decode an ABI string return (offset, length, bytes) OR a bytes32 fixed
// return. Returns "" on anything unparseable rather than throwing — a token
// with a junk symbol is still tradeable.
function decodeStringResult(result) {
  const hex = String(result ?? "0x").slice(2);
  if (hex.length === 0) return "";

  // Dynamic string: [offset(32)][length(32)][data...]
  if (hex.length >= 128) {
    const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
    if (offset === 32) {
      const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
      if (length > 0 && length <= 256 && hex.length >= 128 + length * 2) {
        return hexToUtf8(hex.slice(128, 128 + length * 2));
      }
    }
  }

  // bytes32 fixed: a single right-padded word of ASCII.
  if (hex.length === 64) {
    return hexToUtf8(hex);
  }

  return "";
}

function decodeDecimals(result) {
  const hex = String(result ?? "0x").slice(2);
  if (hex.length === 0) return null;
  const value = Number(BigInt(`0x${hex}`));
  // ERC-20 decimals is uint8; reject implausible values.
  if (!Number.isInteger(value) || value < 0 || value > 36) return null;
  return value;
}

export function createTokenMetadataReader({ client, blockTag = "latest" } = {}) {
  if (!client?.call) {
    throw new Error("Token metadata reading requires an RPC call client.");
  }

  return async function readTokenMetadata(address) {
    const tokenAddress = normalizeAddress(address, "token address");

    // Must be a contract — an EOA or empty address is not a token.
    const code = await client.getCode(tokenAddress, blockTag);
    if (!code || code === "0x") {
      throw new Error("No contract code at that address.");
    }

    const [symbolResult, nameResult, decimalsResult] = await Promise.all([
      client.call({ to: tokenAddress, data: SYMBOL_SELECTOR }, blockTag).catch(() => "0x"),
      client.call({ to: tokenAddress, data: NAME_SELECTOR }, blockTag).catch(() => "0x"),
      client.call({ to: tokenAddress, data: DECIMALS_SELECTOR }, blockTag).catch(() => "0x"),
    ]);

    const decimals = decodeDecimals(decimalsResult);
    if (decimals === null) {
      // decimals() is mandatory for a usable ERC-20; without it amounts are
      // ambiguous, so refuse rather than guess.
      throw new Error("Address does not expose a valid ERC-20 decimals().");
    }

    const symbol = decodeStringResult(symbolResult) || `${tokenAddress.slice(0, 6)}…`;
    const name = decodeStringResult(nameResult) || symbol;

    return {
      address: tokenAddress,
      symbol: symbol.slice(0, 24),
      name: name.slice(0, 64),
      decimals,
      provenance: "discovered-onchain",
    };
  };
}
