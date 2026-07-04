import { listSources } from "../sources/registry.mjs";
import {
  DOGESWAP_ROUTER_EXECUTE_SELECTOR,
  buildDogeSwapSplitCalldata,
} from "./dogeSwapRouterCalldata.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTORS = Object.freeze({
  v2SwapExactTokensForTokens: "0x38ed1739",
  v2SwapTokensForExactTokens: "0x8803dbee",
  muchfiV3ExactInputSingle: "0x04e45aaf",
  muchfiV3ExactOutputSingle: "0x5023b4df",
  muchfiV3MulticallDeadline: "0x5ae401dc",
  barkswapAlgebraExactInputSingle: "0x1679c792",
  barkswapAlgebraExactOutputSingle: "0x1764babc",
});

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

function optionalRouteDataObject(routeData) {
  return routeData && typeof routeData === "object" && !Array.isArray(routeData)
    ? routeData
    : {};
}

function minAmountOutFor(quote) {
  return positiveUint(quote.minAmountOut ?? quote.minimumOutput, "minAmountOut");
}

function amountOutFor(quote) {
  return positiveUint(quote.amountOut, "amountOut");
}

function maxAmountInFor(quote) {
  return positiveUint(quote.maxAmountIn ?? quote.maximumInput, "maxAmountIn");
}

function pathFor(quote) {
  const path = quote.path ?? [quote.sellToken, quote.buyToken];
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error("V2 calldata path must contain at least two token addresses.");
  }
  return path.map((address, index) => encodeAddress(address, `path[${index}]`));
}

function feeTierFor(quote) {
  const routeData = optionalRouteDataObject(quote.routeData);
  const feeTier = quote.feeTier ?? routeData.feeTier ?? BigInt(quote.feeBps) * 100n;
  const normalized = BigInt(feeTier);
  if (normalized <= 0n || normalized > 16_777_215n) {
    throw new Error("feeTier must fit uint24 and be greater than zero.");
  }
  return normalized;
}

function algebraDeployerFor(source, quote) {
  const routeData = optionalRouteDataObject(quote.routeData);
  return (
    quote.deployer ??
    routeData.deployer ??
    source.routerPoolDeployer ??
    source.quoterPoolDeployer ??
    ZERO_ADDRESS
  );
}

export function buildV2SwapExactTokensForTokensCalldata(quote) {
  const amountIn = positiveUint(quote.amountIn, "amountIn");
  const minAmountOut = minAmountOutFor(quote);
  const path = pathFor(quote);

  return `${SELECTORS.v2SwapExactTokensForTokens}${encodeUint(amountIn, "amountIn")}${encodeUint(minAmountOut, "minAmountOut")}${encodeUint(160n, "path offset")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(quote.deadline, "deadline")}${encodeUint(BigInt(path.length), "path length")}${path.join("")}`;
}

export function buildV2SwapTokensForExactTokensCalldata(quote) {
  const amountOut = amountOutFor(quote);
  const maxAmountIn = maxAmountInFor(quote);
  const path = pathFor(quote);

  return `${SELECTORS.v2SwapTokensForExactTokens}${encodeUint(amountOut, "amountOut")}${encodeUint(maxAmountIn, "maxAmountIn")}${encodeUint(160n, "path offset")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(quote.deadline, "deadline")}${encodeUint(BigInt(path.length), "path length")}${path.join("")}`;
}

// MuchFi V3 is a SwapRouter02-style router: exactInputSingle/exactOutputSingle
// take NO deadline in their params (unlike V2 and Algebra). The enforceable
// expiry SwapRouter02 provides is multicall(uint256 deadline, bytes[] data),
// which reverts the whole batch when block.timestamp > deadline. The deployed
// router (0x54f7…C1CB) carries the 0x5ae401dc selector in its on-chain
// bytecode (checked 2026-07-04 via Blockscout eth_getCode; the V1-style
// deadline-in-params selectors 0x414bf389/0xdb3e2198 are absent), so direct V3
// swaps wrap the unchanged inner swap calldata in a single-element multicall.
// Without this, a V3 direct swap stuck in the mempool has unbounded inclusion
// time with only minAmountOut/maxAmountIn protection (issue #16).
function wrapInMuchFiV3MulticallDeadline(quote, innerCalldata) {
  const deadline = positiveUint(quote.deadline, "deadline");
  const inner = innerCalldata.slice(2);
  const innerByteLength = BigInt(inner.length / 2);
  const paddedInner = inner.padEnd(Math.ceil(inner.length / 64) * 64, "0");

  return `${SELECTORS.muchfiV3MulticallDeadline}${encodeUint(deadline, "deadline")}${encodeUint(64n, "data offset")}${encodeUint(1n, "data count")}${encodeUint(32n, "element offset")}${encodeUint(innerByteLength, "element length")}${paddedInner}`;
}

export function buildMuchFiV3ExactInputSingleCalldata(quote) {
  const amountIn = positiveUint(quote.amountIn, "amountIn");
  const minAmountOut = minAmountOutFor(quote);

  return wrapInMuchFiV3MulticallDeadline(
    quote,
    `${SELECTORS.muchfiV3ExactInputSingle}${encodeAddress(quote.sellToken, "sellToken")}${encodeAddress(quote.buyToken, "buyToken")}${encodeUint(feeTierFor(quote), "feeTier")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(amountIn, "amountIn")}${encodeUint(minAmountOut, "minAmountOut")}${encodeUint(0n, "sqrtPriceLimitX96")}`,
  );
}

export function buildMuchFiV3ExactOutputSingleCalldata(quote) {
  const amountOut = amountOutFor(quote);
  const maxAmountIn = maxAmountInFor(quote);

  return wrapInMuchFiV3MulticallDeadline(
    quote,
    `${SELECTORS.muchfiV3ExactOutputSingle}${encodeAddress(quote.sellToken, "sellToken")}${encodeAddress(quote.buyToken, "buyToken")}${encodeUint(feeTierFor(quote), "feeTier")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(amountOut, "amountOut")}${encodeUint(maxAmountIn, "maxAmountIn")}${encodeUint(0n, "sqrtPriceLimitX96")}`,
  );
}

export function buildBarkswapAlgebraExactInputSingleCalldata(source, quote) {
  const amountIn = positiveUint(quote.amountIn, "amountIn");
  const minAmountOut = minAmountOutFor(quote);

  return `${SELECTORS.barkswapAlgebraExactInputSingle}${encodeAddress(quote.sellToken, "sellToken")}${encodeAddress(quote.buyToken, "buyToken")}${encodeAddress(algebraDeployerFor(source, quote), "deployer")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(quote.deadline, "deadline")}${encodeUint(amountIn, "amountIn")}${encodeUint(minAmountOut, "minAmountOut")}${encodeUint(0n, "limitSqrtPrice")}`;
}

export function buildBarkswapAlgebraExactOutputSingleCalldata(source, quote) {
  const amountOut = amountOutFor(quote);
  const maxAmountIn = maxAmountInFor(quote);

  return `${SELECTORS.barkswapAlgebraExactOutputSingle}${encodeAddress(quote.sellToken, "sellToken")}${encodeAddress(quote.buyToken, "buyToken")}${encodeAddress(algebraDeployerFor(source, quote), "deployer")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(quote.deadline, "deadline")}${encodeUint(amountOut, "amountOut")}${encodeUint(maxAmountIn, "maxAmountIn")}${encodeUint(0n, "limitSqrtPrice")}`;
}

// Router-execution variant for a venue: same verified venue quote, but the
// transaction is a single-leg DogeSwapRouter program (enforced settlement,
// enforced deadline, Permit2 single-approval). Selected by the calldata
// registry when the quote carries executionMode "dogeswap-router".
function routerExecutionBuilder(source) {
  return {
    sourceId: source.sourceId,
    protocolType: source.protocolType,
    quoteMode: "exactInput",
    executionMode: "dogeswap-router",
    selector: DOGESWAP_ROUTER_EXECUTE_SELECTOR,
    buildCalldata: (quote) => buildDogeSwapSplitCalldata(source, quote),
  };
}

export function createVenueCalldataBuilders({ sources = listSources() } = {}) {
  return sources.flatMap((source) => {
    if (source.sourceId === "muchfi-v2" && source.protocolType === "v2") {
      return [
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactInput",
          selector: SELECTORS.v2SwapExactTokensForTokens,
          buildCalldata: buildV2SwapExactTokensForTokensCalldata,
        },
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactOutput",
          selector: SELECTORS.v2SwapTokensForExactTokens,
          buildCalldata: buildV2SwapTokensForExactTokensCalldata,
        },
        routerExecutionBuilder(source),
      ];
    }

    if (source.sourceId === "muchfi-v3" && source.protocolType === "v3") {
      return [
        // Direct V3 calldata leads with the multicall(deadline, …) selector;
        // the verified swap selector sits inside the wrapped element.
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactInput",
          selector: SELECTORS.muchfiV3MulticallDeadline,
          buildCalldata: buildMuchFiV3ExactInputSingleCalldata,
        },
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactOutput",
          selector: SELECTORS.muchfiV3MulticallDeadline,
          buildCalldata: buildMuchFiV3ExactOutputSingleCalldata,
        },
        routerExecutionBuilder(source),
      ];
    }

    if (source.sourceId === "dogeswap-split" && source.protocolType === "aggregator") {
      return [
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactInput",
          selector: DOGESWAP_ROUTER_EXECUTE_SELECTOR,
          buildCalldata: (quote) => buildDogeSwapSplitCalldata(source, quote),
        },
      ];
    }

    if (source.sourceId === "barkswap-algebra" && source.protocolType === "algebra") {
      return [
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactInput",
          selector: SELECTORS.barkswapAlgebraExactInputSingle,
          buildCalldata: (quote) => buildBarkswapAlgebraExactInputSingleCalldata(source, quote),
        },
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactOutput",
          selector: SELECTORS.barkswapAlgebraExactOutputSingle,
          buildCalldata: (quote) => buildBarkswapAlgebraExactOutputSingleCalldata(source, quote),
        },
        routerExecutionBuilder(source),
      ];
    }

    return [];
  });
}
