import assert from "node:assert/strict";
import test from "node:test";

import {
  createLiveConcentratedLiquidityQuoterOutputProvider,
} from "../src/discovery/concentratedLiquidityPools.mjs";

const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";
const muchfiQuoter = "0x5DE1Ea595653419f295511DEb781b98387a77cc2";
const muchfiPool = "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC";
const barkswapQuoter = "0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D";
const barkswapPool = "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return String(address).toLowerCase().slice(2).padStart(64, "0");
}

function encodedWords(values) {
  return `0x${values.map(word).join("")}`;
}

function encodedAddress(address) {
  return `0x${addressWord(address)}`;
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    async call({ to, data }, blockTag) {
      calls.push([to, data, blockTag]);
      const response = responses.get(`${to.toLowerCase()}:${data.toLowerCase()}`);
      if (!response) throw new Error(`missing response for ${to}:${data}`);
      return response;
    },
  };
}

test("live concentrated-liquidity provider calls MuchFi V3 quoter and pool state", async () => {
  const amountIn = 1_000_000_000_000_000_000n;
  const sqrtPriceX96 = 198_492_020_576_427_059_788_019_143_518n;
  const quotedAmountOut = 980_109_203_162_403_649n;
  const client = fakeClient(
    new Map([
      [`${muchfiPool.toLowerCase()}:0x0dfe1681`, encodedAddress(usdc)],
      [`${muchfiPool.toLowerCase()}:0xd21220a7`, encodedAddress(wdoge)],
      [`${muchfiPool.toLowerCase()}:0x3850c7bd`, encodedWords([sqrtPriceX96, 18_369n, 0n, 1n, 1n, 209_718_400n, 1n])],
      [`${muchfiPool.toLowerCase()}:0x1a686502`, encodedWords([463_818_676_025_040_102n])],
      [
        `${muchfiQuoter.toLowerCase()}:0xc6a5026a${addressWord(usdc)}${addressWord(wdoge)}${word(amountIn)}${word(2500n)}${word(0n)}`,
        encodedWords([quotedAmountOut, 31072605956553409479375850814n, 0n, 115_516n]),
      ],
    ]),
  );

  const provider = createLiveConcentratedLiquidityQuoterOutputProvider({ client });
  const output = await provider({
    source: {
      sourceId: "muchfi-v3",
      protocolType: "v3",
      quoter: muchfiQuoter,
      quoterAbiProvenance: "onchain-bytecode",
      pools: [
        {
          address: muchfiPool,
          token0: usdc,
          token1: wdoge,
          feeTier: 2500,
        },
      ],
    },
    sellToken: usdc,
    buyToken: wdoge,
    amountIn,
    blockNumber: 5_200_000n,
  });

  assert.equal(output.poolAddress, muchfiPool);
  assert.equal(output.quotedAmountOut, quotedAmountOut);
  assert.equal(output.sqrtPriceX96, sqrtPriceX96);
  assert.equal(output.feeBps, 25n);
  assert.equal(output.gasUnits, 115_516n);
  assert.equal(output.quoterProvenance, "onchain-bytecode");
  assert.equal(client.calls.every((call) => call[2] === "0x4f5880"), true);
});

test("live concentrated-liquidity provider can resolve a registry source by id", async () => {
  const amountIn = 1_000_000_000_000_000_000n;
  const quotedAmountOut = 980_109_203_162_403_649n;
  const client = fakeClient(
    new Map([
      [`${muchfiPool.toLowerCase()}:0x0dfe1681`, encodedAddress(usdc)],
      [`${muchfiPool.toLowerCase()}:0xd21220a7`, encodedAddress(wdoge)],
      [`${muchfiPool.toLowerCase()}:0x3850c7bd`, encodedWords([198_492_020_576_427_059_788_019_143_518n, 18_369n, 0n, 1n, 1n, 209_718_400n, 1n])],
      [`${muchfiPool.toLowerCase()}:0x1a686502`, encodedWords([463_818_676_025_040_102n])],
      [
        `${muchfiQuoter.toLowerCase()}:0xc6a5026a${addressWord(usdc)}${addressWord(wdoge)}${word(amountIn)}${word(2500n)}${word(0n)}`,
        encodedWords([quotedAmountOut, 31072605956553409479375850814n, 0n, 115_516n]),
      ],
    ]),
  );

  const provider = createLiveConcentratedLiquidityQuoterOutputProvider({
    client,
    sources: [
      {
        sourceId: "muchfi-v3",
        protocolType: "v3",
        quoter: muchfiQuoter,
        quoterAbiProvenance: "onchain-bytecode",
        pools: [
          {
            address: muchfiPool,
            token0: usdc,
            token1: wdoge,
            feeTier: 2500,
          },
        ],
      },
    ],
  });
  const output = await provider({
    sourceId: "muchfi-v3",
    sellToken: usdc,
    buyToken: wdoge,
    amountIn,
  });

  assert.equal(output.poolAddress, muchfiPool);
  assert.equal(output.quotedAmountOut, quotedAmountOut);
});

test("live concentrated-liquidity provider calls MuchFi V3 exact-output quoter", async () => {
  const amountOut = 980_109_203_162_403_649n;
  const quotedAmountIn = 1_000_000_000_000_000_000n;
  const sqrtPriceX96 = 198_492_020_576_427_059_788_019_143_518n;
  const client = fakeClient(
    new Map([
      [`${muchfiPool.toLowerCase()}:0x0dfe1681`, encodedAddress(usdc)],
      [`${muchfiPool.toLowerCase()}:0xd21220a7`, encodedAddress(wdoge)],
      [`${muchfiPool.toLowerCase()}:0x3850c7bd`, encodedWords([sqrtPriceX96, 18_369n, 0n, 1n, 1n, 209_718_400n, 1n])],
      [`${muchfiPool.toLowerCase()}:0x1a686502`, encodedWords([463_818_676_025_040_102n])],
      [
        `${muchfiQuoter.toLowerCase()}:0xbd21704a${addressWord(usdc)}${addressWord(wdoge)}${word(amountOut)}${word(2500n)}${word(0n)}`,
        encodedWords([quotedAmountIn, 31072605956553409479375850814n, 0n, 115_516n]),
      ],
    ]),
  );

  const provider = createLiveConcentratedLiquidityQuoterOutputProvider({ client });
  const output = await provider({
    source: {
      sourceId: "muchfi-v3",
      protocolType: "v3",
      quoter: muchfiQuoter,
      quoterAbiProvenance: "onchain-bytecode",
      pools: [
        {
          address: muchfiPool,
          token0: usdc,
          token1: wdoge,
          feeTier: 2500,
        },
      ],
    },
    sellToken: usdc,
    buyToken: wdoge,
    quoteMode: "exactOutput",
    amountOut,
    blockNumber: 5_200_000n,
  });

  assert.equal(output.poolAddress, muchfiPool);
  assert.equal(output.quotedAmountIn, quotedAmountIn);
  assert.equal(output.quotedAmountOut, undefined);
  assert.equal(output.gasUnits, 115_516n);
});

test("live concentrated-liquidity provider calls Barkswap Algebra quoter with canonical deployer sentinel", async () => {
  const amountIn = 1_000_000_000_000_000_000n;
  const currentSqrtPriceX96 = 71_337_271_076_655_749_229_250_262_609n;
  const quotedAmountOut = 805_765_265_067_272_371n;
  const client = fakeClient(
    new Map([
      [`${barkswapPool.toLowerCase()}:0x0dfe1681`, encodedAddress(usdc)],
      [`${barkswapPool.toLowerCase()}:0xd21220a7`, encodedAddress(wdoge)],
      [`${barkswapPool.toLowerCase()}:0xe76c01e4`, encodedWords([currentSqrtPriceX96, 0n, 500n, 193n, 30n, 1n])],
      [`${barkswapPool.toLowerCase()}:0x1a686502`, encodedWords([286_127_046_181_362_770_693n])],
      [
        `${barkswapQuoter.toLowerCase()}:0xe94764c4${addressWord(usdc)}${addressWord(wdoge)}${addressWord("0x0000000000000000000000000000000000000000")}${word(amountIn)}${word(0n)}`,
        encodedWords([
          quotedAmountOut,
          amountIn,
          71_114_155_847_875_054_584_458_117_318n,
          0n,
          130_547n,
          500n,
        ]),
      ],
    ]),
  );

  const provider = createLiveConcentratedLiquidityQuoterOutputProvider({ client });
  const output = await provider({
    source: {
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
      quoter: barkswapQuoter,
      quoterAbiProvenance: "onchain-bytecode",
      quoterPoolDeployer: "0x0000000000000000000000000000000000000000",
      pools: [
        {
          address: barkswapPool,
          token0: usdc,
          token1: wdoge,
        },
      ],
    },
    sellToken: usdc,
    buyToken: wdoge,
    amountIn,
    blockNumber: 5_200_000n,
  });

  assert.equal(output.poolAddress, barkswapPool);
  assert.equal(output.quotedAmountOut, quotedAmountOut);
  assert.equal(output.sqrtPriceX96, currentSqrtPriceX96);
  assert.equal(output.feeBps, 5n);
  assert.equal(output.gasUnits, 130_547n);
});

test("live concentrated-liquidity provider calls Barkswap Algebra exact-output quoter", async () => {
  const amountOut = 805_765_265_067_272_371n;
  const quotedAmountIn = 1_000_000_000_000_000_000n;
  const currentSqrtPriceX96 = 71_337_271_076_655_749_229_250_262_609n;
  const client = fakeClient(
    new Map([
      [`${barkswapPool.toLowerCase()}:0x0dfe1681`, encodedAddress(usdc)],
      [`${barkswapPool.toLowerCase()}:0xd21220a7`, encodedAddress(wdoge)],
      [`${barkswapPool.toLowerCase()}:0xe76c01e4`, encodedWords([currentSqrtPriceX96, 0n, 500n, 193n, 30n, 1n])],
      [`${barkswapPool.toLowerCase()}:0x1a686502`, encodedWords([286_127_046_181_362_770_693n])],
      [
        `${barkswapQuoter.toLowerCase()}:0x62086e24${addressWord(usdc)}${addressWord(wdoge)}${addressWord("0x0000000000000000000000000000000000000000")}${word(amountOut)}${word(0n)}`,
        encodedWords([
          quotedAmountIn,
          amountOut,
          71_114_155_847_875_054_584_458_117_318n,
          0n,
          130_547n,
          500n,
        ]),
      ],
    ]),
  );

  const provider = createLiveConcentratedLiquidityQuoterOutputProvider({ client });
  const output = await provider({
    source: {
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
      quoter: barkswapQuoter,
      quoterAbiProvenance: "onchain-bytecode",
      quoterPoolDeployer: "0x0000000000000000000000000000000000000000",
      pools: [
        {
          address: barkswapPool,
          token0: usdc,
          token1: wdoge,
        },
      ],
    },
    sellToken: usdc,
    buyToken: wdoge,
    quoteMode: "exactOutput",
    amountOut,
    blockNumber: 5_200_000n,
  });

  assert.equal(output.poolAddress, barkswapPool);
  assert.equal(output.quotedAmountIn, quotedAmountIn);
  assert.equal(output.feeBps, 5n);
  assert.equal(output.gasUnits, 130_547n);
});
