import { listSources } from "../sources/registry.mjs";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SELECTORS = Object.freeze({
  v2SwapExactTokensForTokens: "0x38ed1739",
  v2SwapTokensForExactTokens: "0x8803dbee",
  muchfiV3ExactInputSingle: "0x04e45aaf",
  muchfiV3ExactOutputSingle: "0x5023b4df",
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

export function buildMuchFiV3ExactInputSingleCalldata(quote) {
  const amountIn = positiveUint(quote.amountIn, "amountIn");
  const minAmountOut = minAmountOutFor(quote);

  return `${SELECTORS.muchfiV3ExactInputSingle}${encodeAddress(quote.sellToken, "sellToken")}${encodeAddress(quote.buyToken, "buyToken")}${encodeUint(feeTierFor(quote), "feeTier")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(amountIn, "amountIn")}${encodeUint(minAmountOut, "minAmountOut")}${encodeUint(0n, "sqrtPriceLimitX96")}`;
}

export function buildMuchFiV3ExactOutputSingleCalldata(quote) {
  const amountOut = amountOutFor(quote);
  const maxAmountIn = maxAmountInFor(quote);

  return `${SELECTORS.muchfiV3ExactOutputSingle}${encodeAddress(quote.sellToken, "sellToken")}${encodeAddress(quote.buyToken, "buyToken")}${encodeUint(feeTierFor(quote), "feeTier")}${encodeAddress(quote.recipient, "recipient")}${encodeUint(amountOut, "amountOut")}${encodeUint(maxAmountIn, "maxAmountIn")}${encodeUint(0n, "sqrtPriceLimitX96")}`;
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
      ];
    }

    if (source.sourceId === "muchfi-v3" && source.protocolType === "v3") {
      return [
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactInput",
          selector: SELECTORS.muchfiV3ExactInputSingle,
          buildCalldata: buildMuchFiV3ExactInputSingleCalldata,
        },
        {
          sourceId: source.sourceId,
          protocolType: source.protocolType,
          quoteMode: "exactOutput",
          selector: SELECTORS.muchfiV3ExactOutputSingle,
          buildCalldata: buildMuchFiV3ExactOutputSingleCalldata,
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
      ];
    }

    return [];
  });
}
