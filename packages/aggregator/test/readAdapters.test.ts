import { describe, expect, it } from "vitest";
import { TOKENS } from "../../dogeos-config/src/tokens";
import { buildFakeReader } from "./testReader";
import { estimateV2ExactIn, readMuchFiV2Pair } from "../src/adapters/muchfiV2";
import { readMuchFiV3Pool } from "../src/adapters/muchfiV3";
import { readBarkswapAlgebraPool } from "../src/adapters/barkswapAlgebra";

describe("read adapters", () => {
  it("reads MuchFi V2 pair reserves and computes exact-input constant-product quote", async () => {
    const pair = "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4";
    const reader = buildFakeReader({
      [`${pair}:token0:`]: TOKENS.USDC.address,
      [`${pair}:token1:`]: TOKENS.WDOGE.address,
      [`${pair}:getReserves:`]: [1_000_000n, 2_000_000n, 123n]
    });

    const state = await readMuchFiV2Pair(reader, pair);
    expect(state.token0).toBe(TOKENS.USDC.address);
    expect(state.token1).toBe(TOKENS.WDOGE.address);
    expect(state.reserve0).toBe(1_000_000n);
    expect(estimateV2ExactIn({ amountIn: 1000n, reserveIn: 1_000_000n, reserveOut: 2_000_000n })).toBe(1992n);
  });

  it("reads MuchFi V3 pool state without enabling execution", async () => {
    const pool = "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC";
    const reader = buildFakeReader({
      [`${pool}:token0:`]: TOKENS.USDC.address,
      [`${pool}:token1:`]: TOKENS.WDOGE.address,
      [`${pool}:fee:`]: 2500,
      [`${pool}:liquidity:`]: 42_000n,
      [`${pool}:slot0:`]: [1_000_000n, 123, 0, 0, 0, 0, true]
    });

    const state = await readMuchFiV3Pool(reader, pool);
    expect(state.fee).toBe(2500);
    expect(state.liquidity).toBe(42_000n);
    expect(state.sqrtPriceX96).toBe(1_000_000n);
  });

  it("reads Barkswap Algebra pool state through globalState", async () => {
    const pool = "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1";
    const reader = buildFakeReader({
      [`${pool}:token0:`]: TOKENS.USDC.address,
      [`${pool}:token1:`]: TOKENS.WDOGE.address,
      [`${pool}:fee:`]: 2500,
      [`${pool}:liquidity:`]: 99_000n,
      [`${pool}:globalState:`]: [2_000_000n, 456, 0, 0, 0, true]
    });

    const state = await readBarkswapAlgebraPool(reader, pool);
    expect(state.tick).toBe(456);
    expect(state.sqrtPriceX96).toBe(2_000_000n);
    expect(state.liquidity).toBe(99_000n);
  });
});
