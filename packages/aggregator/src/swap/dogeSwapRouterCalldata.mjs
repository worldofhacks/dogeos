// dogeSwapRouterCalldata.mjs — calldata builder for the first-party
// DogeSwapRouter (packages/contracts/src/DogeSwapRouter.sol): an audited,
// movement-only command router that executes multi-venue SPLIT swaps
// atomically with enforced settlement (aggregate minOut checked on measured
// balance delta, leftovers refunded).
//
// Program shape for an exact-input split (mirrors the audited integration
// test test_split_v3_plus_v2):
//   commands = 0x01 (PERMIT2_TRANSFER_FROM)  pull total sellToken via Permit2
//            + one swap command per leg      explicit amountIn per leg,
//                                            except the LAST leg which uses
//                                            CONTRACT_BALANCE so rounding dust
//                                            is consumed
//   settlement = (buyToken, minAmountOut, recipient); per-leg minOut is 0 —
//   the router enforces the AGGREGATE floor and refunds unspent input.
//
// Encodings verified byte-for-byte against `cast calldata` fixtures in
// test/dogeSwapRouterCalldata.test.mjs.

export const DOGESWAP_ROUTER_EXECUTE_SELECTOR = "0xe56964c6"; // execute(bytes,bytes[],(address,uint256,address),uint256)
export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
export const CONTRACT_BALANCE = (1n << 256n) - 1n;

export const ROUTER_COMMANDS = Object.freeze({
  PERMIT2_TRANSFER_FROM: 0x01,
  V2_SWAP: 0x02,
  V3_SWAP: 0x03,
  ALGEBRA_SWAP: 0x04,
  WRAP_NATIVE: 0x05,
  UNWRAP_NATIVE: 0x06,
});

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WORD = 32n;

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function encodeAddress(value, fieldName) {
  return normalizeAddress(value, fieldName).slice(2).padStart(64, "0");
}

function encodeUint(value, fieldName) {
  const bigint = BigInt(value);
  if (bigint < 0n) {
    throw new Error(`${fieldName} must be zero or greater.`);
  }
  return bigint.toString(16).padStart(64, "0");
}

function positiveUint(value, fieldName) {
  const bigint = BigInt(value);
  if (bigint <= 0n) {
    throw new Error(`${fieldName} must be greater than zero.`);
  }
  return bigint;
}

// ABI tail for `bytes`: length word + data right-padded to a word boundary.
function encodeBytesTail(hexBytes) {
  const byteLength = BigInt(hexBytes.length / 2);
  const padded = hexBytes.length === 0 ? "" : hexBytes.padEnd(Math.ceil(hexBytes.length / 64) * 64, "0");
  return `${encodeUint(byteLength, "bytes length")}${padded}`;
}

// ---------------------------------------------------------------------------
// Per-command input encodings (each is the abi.encode(...) the router expects)
// ---------------------------------------------------------------------------

export function encodePermit2TransferFromInput({ token, amount }) {
  return `${encodeAddress(token, "token")}${encodeUint(positiveUint(amount, "amount"), "amount")}`;
}

export function encodeV2SwapInput({ amountIn, minOut, path }) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error("V2 swap path must contain at least two token addresses.");
  }
  const encodedPath = path.map((address, index) => encodeAddress(address, `path[${index}]`));
  return (
    encodeUint(amountIn, "amountIn") +
    encodeUint(minOut ?? 0n, "minOut") +
    encodeUint(3n * WORD, "path offset") +
    encodeUint(BigInt(encodedPath.length), "path length") +
    encodedPath.join("")
  );
}

export function encodeV3SwapInput({ sellToken, buyToken, feeTier, amountIn, minOut }) {
  const normalizedFeeTier = positiveUint(feeTier, "feeTier");
  if (normalizedFeeTier > 16_777_215n) {
    throw new Error("feeTier must fit uint24.");
  }
  return (
    encodeAddress(sellToken, "sellToken") +
    encodeAddress(buyToken, "buyToken") +
    encodeUint(normalizedFeeTier, "feeTier") +
    encodeUint(amountIn, "amountIn") +
    encodeUint(minOut ?? 0n, "minOut")
  );
}

export function encodeAlgebraSwapInput({ sellToken, buyToken, deployer, amountIn, minOut }) {
  return (
    encodeAddress(sellToken, "sellToken") +
    encodeAddress(buyToken, "buyToken") +
    encodeAddress(deployer ?? ZERO_ADDRESS, "deployer") +
    encodeUint(amountIn, "amountIn") +
    encodeUint(minOut ?? 0n, "minOut")
  );
}

// ---------------------------------------------------------------------------
// execute(bytes commands, bytes[] inputs, Settlement s, uint256 deadline)
// ---------------------------------------------------------------------------

export function encodeDogeSwapRouterExecute({ commands, inputs, settlement, deadline }) {
  if (!Array.isArray(commands) || commands.length === 0 || commands.length !== inputs.length) {
    throw new Error("commands and inputs must be equal-length non-empty arrays.");
  }

  const commandsHex = commands
    .map((command) => {
      const byte = Number(command);
      if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
        throw new Error("Each command must be a single byte.");
      }
      return byte.toString(16).padStart(2, "0");
    })
    .join("");

  // Head: commands offset, inputs offset, Settlement inline (static tuple),
  // deadline — 6 words.
  const headWords = 6n;
  const commandsTail = encodeBytesTail(commandsHex);
  const commandsOffset = headWords * WORD;
  const inputsOffset = commandsOffset + BigInt(commandsTail.length / 2);

  // bytes[] tail: length word, per-element offsets (relative to the word
  // after the length), then each element as a bytes tail.
  const elementTails = inputs.map((inputHex, index) => {
    if (!/^([0-9a-f]{64})+$/.test(inputHex)) {
      throw new Error(`inputs[${index}] must be whole ABI words of lowercase hex.`);
    }
    return encodeBytesTail(inputHex);
  });
  let elementOffset = BigInt(inputs.length) * WORD;
  const elementOffsets = elementTails.map((tail) => {
    const offset = elementOffset;
    elementOffset += BigInt(tail.length / 2);
    return encodeUint(offset, "input element offset");
  });
  const inputsTail =
    encodeUint(BigInt(inputs.length), "inputs length") + elementOffsets.join("") + elementTails.join("");

  return (
    DOGESWAP_ROUTER_EXECUTE_SELECTOR +
    encodeUint(commandsOffset, "commands offset") +
    encodeUint(inputsOffset, "inputs offset") +
    encodeAddress(settlement.buyToken, "settlement.buyToken") +
    encodeUint(settlement.minOut, "settlement.minOut") +
    encodeAddress(settlement.recipient, "settlement.recipient") +
    encodeUint(positiveUint(deadline, "deadline"), "deadline") +
    commandsTail +
    inputsTail
  );
}

// ---------------------------------------------------------------------------
// Split-quote program builder (consumed by the verified calldata registry)
// ---------------------------------------------------------------------------

function legSwapCommand(leg, { amountIn, sellToken, buyToken, source }) {
  if (leg.protocolType === "v2") {
    return {
      command: ROUTER_COMMANDS.V2_SWAP,
      input: encodeV2SwapInput({ amountIn, minOut: 0n, path: leg.path ?? [sellToken, buyToken] }),
    };
  }
  if (leg.protocolType === "v3") {
    return {
      command: ROUTER_COMMANDS.V3_SWAP,
      input: encodeV3SwapInput({
        sellToken,
        buyToken,
        feeTier: leg.feeTier ?? BigInt(leg.feeBps) * 100n,
        amountIn,
        minOut: 0n,
      }),
    };
  }
  if (leg.protocolType === "algebra") {
    return {
      command: ROUTER_COMMANDS.ALGEBRA_SWAP,
      input: encodeAlgebraSwapInput({
        sellToken,
        buyToken,
        deployer: leg.deployer ?? source?.routerPoolDeployer ?? ZERO_ADDRESS,
        amountIn,
        minOut: 0n,
      }),
    };
  }
  throw new Error(`Unsupported split leg protocol ${leg.protocolType}.`);
}

export function buildDogeSwapSplitCalldata(source, quote) {
  const legs = Array.isArray(quote.legs) ? quote.legs : [];
  if (legs.length < 1) {
    throw new Error("Split quote requires at least one leg.");
  }

  const totalAmountIn = positiveUint(quote.amountIn, "amountIn");
  const minAmountOut = positiveUint(quote.minAmountOut ?? quote.minimumOutput, "minAmountOut");
  const sellToken = normalizeAddress(quote.sellToken, "sellToken");
  const buyToken = normalizeAddress(quote.buyToken, "buyToken");

  const commands = [ROUTER_COMMANDS.PERMIT2_TRANSFER_FROM];
  const inputs = [encodePermit2TransferFromInput({ token: sellToken, amount: totalAmountIn })];

  let spent = 0n;
  legs.forEach((leg, index) => {
    const isLast = index === legs.length - 1;
    const explicit = positiveUint(leg.amountIn, `legs[${index}].amountIn`);
    if (!isLast) spent += explicit;
    // The last leg spends the remaining ledger delta so per-leg rounding can
    // never strand input in the router (mirrors test_split_v3_plus_v2).
    const amountIn = isLast ? CONTRACT_BALANCE : explicit;
    if (!isLast && spent >= totalAmountIn) {
      throw new Error("Split legs overspend the total input.");
    }
    const { command, input } = legSwapCommand(leg, { amountIn, sellToken, buyToken, source });
    commands.push(command);
    inputs.push(input);
  });

  return encodeDogeSwapRouterExecute({
    commands,
    inputs,
    settlement: {
      buyToken,
      minOut: minAmountOut,
      recipient: normalizeAddress(quote.recipient, "recipient"),
    },
    deadline: quote.deadline,
  });
}
