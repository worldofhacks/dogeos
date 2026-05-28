import { createRequire } from "node:module";
import { Interface, ZeroAddress, parseUnits } from "ethers";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  DEFAULT_LIVE_QUOTE_CONFIG,
  buildLiveQuote,
  encodePairRouteData,
  estimateV2ExactIn,
  formatUnitsTrimmed
} = require("../lib/liveQuote.cjs");

const PAIR_IFACE = new Interface([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
]);

const ADAPTER_IFACE = new Interface([
  "function quoteExactInput(address pair,address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut)"
]);

const ROUTER_IFACE = new Interface([
  "function exactInput(address adapter,(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient,bytes routeData) params,uint256 deadline) payable returns (uint256 amountOut)"
]);

function buildRpcFetch(fixtures: Record<string, string>) {
  return async (_url: string, init: { body?: string }) => {
    const payload = JSON.parse(String(init.body));
    const calls = Array.isArray(payload) ? payload : [payload];
    const responses = calls.map((call) => {
      if (call.method === "eth_blockNumber") {
        return { jsonrpc: "2.0", id: call.id, result: "0x4f7da9" };
      }

      if (call.method !== "eth_call") {
        return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "unsupported" } };
      }

      const [{ to, data }] = call.params;
      const key = `${String(to).toLowerCase()}:${String(data).slice(0, 10)}`;
      const result = fixtures[key];
      if (!result) {
        return { jsonrpc: "2.0", id: call.id, error: { code: -32000, message: `missing fixture ${key}` } };
      }
      return { jsonrpc: "2.0", id: call.id, result };
    });

    return {
      ok: true,
      status: 200,
      async json() {
        return Array.isArray(payload) ? responses : responses[0];
      }
    };
  };
}

function selector(iface: Interface, name: string) {
  return iface.getFunction(name)?.selector;
}

describe("live frontend quote engine", () => {
  test("quotes a direct executable MuchFi V2 route from live-style adapter calls and returns router calldata", async () => {
    const amountIn = parseUnits("0.0001", 18);
    const quotedAmountOut = 16_075_550_163_793n;
    const pair = DEFAULT_LIVE_QUOTE_CONFIG.sources.muchfiV2.pairs[0];
    const adapter = DEFAULT_LIVE_QUOTE_CONFIG.deployments.adapterAddress;

    const fixtures = {
      [`${pair.toLowerCase()}:${selector(PAIR_IFACE, "token0")}`]: PAIR_IFACE.encodeFunctionResult("token0", [
        DEFAULT_LIVE_QUOTE_CONFIG.tokens.USDC.address
      ]),
      [`${pair.toLowerCase()}:${selector(PAIR_IFACE, "token1")}`]: PAIR_IFACE.encodeFunctionResult("token1", [
        DEFAULT_LIVE_QUOTE_CONFIG.tokens.WDOGE.address
      ]),
      [`${pair.toLowerCase()}:${selector(PAIR_IFACE, "getReserves")}`]: PAIR_IFACE.encodeFunctionResult("getReserves", [
        1_975_293_959_149_072_276n,
        12_250_604_364_282_262_700n,
        1_779_634_317
      ]),
      [`${adapter.toLowerCase()}:${selector(ADAPTER_IFACE, "quoteExactInput")}`]: ADAPTER_IFACE.encodeFunctionResult(
        "quoteExactInput",
        [quotedAmountOut]
      )
    };

    const quote = await buildLiveQuote({
      fetchImpl: buildRpcFetch(fixtures),
      tokenIn: "DOGE",
      tokenOut: "USDC",
      amountIn: "0.0001",
      recipient: "0x00B6F77d55967669Ea37f47Fc469FF47782007E4",
      nowSeconds: 1_779_883_000
    });

    expect(quote.blockNumber).toBe(5_209_513);
    expect(quote.routes).toHaveLength(1);
    expect(quote.routes[0]).toMatchObject({
      sourceId: "muchfi-v2",
      protocol: "v2",
      status: "live",
      executable: true,
      amountOut: quotedAmountOut.toString(),
      routeData: encodePairRouteData(pair)
    });
    expect(quote.routes[0].transaction).toMatchObject({
      to: DEFAULT_LIVE_QUOTE_CONFIG.deployments.routerAddress,
      value: amountIn.toString()
    });

    const decoded = ROUTER_IFACE.decodeFunctionData("exactInput", quote.routes[0].transaction.data);
    expect(decoded[0]).toBe(DEFAULT_LIVE_QUOTE_CONFIG.deployments.adapterAddress);
    expect(decoded[1].tokenIn).toBe(ZeroAddress);
    expect(decoded[1].tokenOut).toBe(DEFAULT_LIVE_QUOTE_CONFIG.tokens.USDC.address);
    expect(decoded[1].minAmountOut).toBe((quotedAmountOut * 9950n) / 10000n);
  });

  test("computes V2 exact-input math and compact unit formatting deterministically", () => {
    expect(estimateV2ExactIn({ amountIn: 1000n, reserveIn: 1_000_000n, reserveOut: 2_000_000n })).toBe(1992n);
    expect(formatUnitsTrimmed(16_075_550_163_793n, 18)).toBe("0.000016075550163793");
    expect(formatUnitsTrimmed(42_000_000_000_000_000_000n, 18)).toBe("42");
  });
});
