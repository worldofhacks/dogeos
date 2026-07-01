import {
  quoteAlgebraExactOutputFromQuoter,
  quoteAlgebraExactInputFromQuoter,
  quoteV3ExactOutputFromQuoter,
  quoteV3ExactInputFromQuoter,
} from "../adapters/concentratedLiquidity.mjs";
import { listSources } from "../../sources/registry.mjs";
import { filterSourcesByRequest, filterSourcesByTokenPair } from "../../sources/sourceFilters.mjs";
import { resolveDataFinalityFeeWei } from "../../fees/dataFinalityFee.mjs";
import { DEFAULT_SOURCE_TIMEOUT_MS, runSourceQuote } from "../sourceQuoteRunner.mjs";

const GAS_UNITS_BY_PROTOCOL = Object.freeze({
  v3: 165_000n,
  algebra: 180_000n,
});

function quoteAdapterFor(protocolType, quoteMode) {
  if (protocolType === "v3") {
    return quoteMode === "exactOutput" ? quoteV3ExactOutputFromQuoter : quoteV3ExactInputFromQuoter;
  }
  if (protocolType === "algebra") {
    return quoteMode === "exactOutput"
      ? quoteAlgebraExactOutputFromQuoter
      : quoteAlgebraExactInputFromQuoter;
  }
  return null;
}

export function createVerifiedConcentratedLiquidityQuoteCandidateProvider({
  chainId,
  sources = listSources(),
  nowMs = () => Date.now(),
  blockNumberProvider,
  quoterOutputProvider,
  gasUnitsByProtocol = GAS_UNITS_BY_PROTOCOL,
  dataFinalityFeeWei = 0n,
  ttlMs = 5_000,
  sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  onSourceError,
} = {}) {
  return async function concentratedLiquidityQuoteCandidateProvider(input) {
    if (typeof quoterOutputProvider !== "function") return [];

    const quoteMode = input.quoteMode === "exactOutput" ? "exactOutput" : "exactInput";
    const eligibleSources = filterSourcesByTokenPair(filterSourcesByRequest(sources, input), input)
      .map((source) => ({
        source,
        quoteAdapter: quoteAdapterFor(source.protocolType, quoteMode),
      }))
      .filter(({ source, quoteAdapter }) => quoteAdapter && source.status !== "disabled");
    if (eligibleSources.length === 0) return [];

    const blockNumber =
      typeof blockNumberProvider === "function" ? await blockNumberProvider(input) : undefined;
    const sourceResults = await Promise.all(eligibleSources.map(({ source, quoteAdapter }) => {
      return runSourceQuote({
        source,
        input,
        timeoutMs: sourceTimeoutMs,
        onSourceError,
        task: async () => {
          const quoterOutput = await quoterOutputProvider({
            ...input,
            source,
            blockNumber,
          });

          if (!quoterOutput) return [];

          const routeDataFinalityFeeWei =
            quoterOutput.dataFinalityFeeWei === undefined
              ? await resolveDataFinalityFeeWei(dataFinalityFeeWei, {
                  ...input,
                  chainId,
                  blockNumber,
                  sourceId: source.sourceId,
                  protocolType: source.protocolType,
                  poolAddress: quoterOutput.poolAddress,
                  amountIn:
                    quoteMode === "exactOutput" ? quoterOutput.quotedAmountIn : input.amountIn,
                })
              : await resolveDataFinalityFeeWei(quoterOutput.dataFinalityFeeWei);

          return [
            quoteAdapter({
              sourceId: source.sourceId,
              chainId,
              router: source.router,
              poolAddress: quoterOutput.poolAddress,
              token0: quoterOutput.token0,
              token1: quoterOutput.token1,
              sellToken: input.sellToken,
              buyToken: input.buyToken,
              amountIn: input.amountIn,
              amountOut: input.amountOut,
              quotedAmountIn: quoterOutput.quotedAmountIn,
              quotedAmountOut: quoterOutput.quotedAmountOut,
              feeBps: quoterOutput.feeBps,
              sqrtPriceX96: quoterOutput.sqrtPriceX96,
              liquidity: quoterOutput.liquidity,
              quoterProvenance: quoterOutput.quoterProvenance,
              sourceStatus: source.status,
              gasUnits: quoterOutput.gasUnits ?? gasUnitsByProtocol[source.protocolType],
              dataFinalityFeeWei: routeDataFinalityFeeWei,
              blockNumber,
              quoteTimestampMs: nowMs(),
              ttlMs: quoterOutput.ttlMs ?? ttlMs,
            }),
          ];
        },
      });
    }));

    return sourceResults.flat();
  };
}
