import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { getOfficialToken } from "../../config/src/tokens.mjs";
import {
  createVenueCalldataBuilders,
} from "../src/swap/venueCalldataBuilders.mjs";

const usdc = getOfficialToken("USDC");
const wdoge = getOfficialToken("WDOGE");
const recipient = "0x1111111111111111111111111111111111111111";
const zeroDeployer = "0x0000000000000000000000000000000000000000";

function word(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function addressWord(address) {
  return String(address).toLowerCase().slice(2).padStart(64, "0");
}

function quote(overrides = {}) {
  return {
    sourceId: "muchfi-v3",
    protocolType: "v3",
    status: "active",
    chainId: DOGEOS_CHAIN.id,
    sellToken: usdc.address,
    buyToken: wdoge.address,
    amountIn: 1_000_000_000_000_000_000n,
    minAmountOut: 900_000_000_000_000_000n,
    recipient,
    deadline: 1_780_000_300,
    feeBps: 5n,
    ...overrides,
  };
}

function builderFor(sourceId, protocolType, sources) {
  const builder = createVenueCalldataBuilders({ sources }).find(
    (candidate) =>
      candidate.sourceId === sourceId && candidate.protocolType === protocolType,
  );
  assert.ok(builder);
  return builder;
}

test("venue calldata builders encode MuchFi V2 swapExactTokensForTokens calldata", () => {
  const builder = builderFor("muchfi-v2", "v2", [
    {
      sourceId: "muchfi-v2",
      protocolType: "v2",
    },
  ]);
  const data = builder.buildCalldata(
    quote({
      sourceId: "muchfi-v2",
      protocolType: "v2",
      feeBps: 30n,
    }),
  );

  assert.equal(builder.selector, "0x38ed1739");
  assert.equal(
    data,
    `0x38ed1739${word(1_000_000_000_000_000_000n)}${word(900_000_000_000_000_000n)}${word(160n)}${addressWord(recipient)}${word(1_780_000_300n)}${word(2n)}${addressWord(usdc.address)}${addressWord(wdoge.address)}`,
  );
});

test("venue calldata builders encode MuchFi V2 swapTokensForExactTokens calldata", () => {
  const builder = createVenueCalldataBuilders({
    sources: [
      {
        sourceId: "muchfi-v2",
        protocolType: "v2",
      },
    ],
  }).find(
    (candidate) =>
      candidate.sourceId === "muchfi-v2" &&
      candidate.protocolType === "v2" &&
      candidate.quoteMode === "exactOutput",
  );
  assert.ok(builder);

  const data = builder.buildCalldata(
    quote({
      sourceId: "muchfi-v2",
      protocolType: "v2",
      quoteMode: "exactOutput",
      amountOut: 900_000_000_000_000_000n,
      maxAmountIn: 1_000_000_000_000_000_000n,
      feeBps: 30n,
    }),
  );

  assert.equal(builder.selector, "0x8803dbee");
  assert.equal(
    data,
    `0x8803dbee${word(900_000_000_000_000_000n)}${word(1_000_000_000_000_000_000n)}${word(160n)}${addressWord(recipient)}${word(1_780_000_300n)}${word(2n)}${addressWord(usdc.address)}${addressWord(wdoge.address)}`,
  );
});

test("venue calldata builders encode MuchFi V3 exactInputSingle calldata", () => {
  const builder = builderFor("muchfi-v3", "v3", [
    {
      sourceId: "muchfi-v3",
      protocolType: "v3",
    },
  ]);
  const data = builder.buildCalldata(quote());

  assert.equal(builder.selector, "0x04e45aaf");
  assert.equal(
    data,
    `0x04e45aaf${addressWord(usdc.address)}${addressWord(wdoge.address)}${word(500n)}${addressWord(recipient)}${word(1_000_000_000_000_000_000n)}${word(900_000_000_000_000_000n)}${word(0n)}`,
  );
});

test("venue calldata builders encode MuchFi V3 exactOutputSingle calldata", () => {
  const builder = createVenueCalldataBuilders({
    sources: [
      {
        sourceId: "muchfi-v3",
        protocolType: "v3",
      },
    ],
  }).find(
    (candidate) =>
      candidate.sourceId === "muchfi-v3" &&
      candidate.protocolType === "v3" &&
      candidate.quoteMode === "exactOutput",
  );
  assert.ok(builder);

  const data = builder.buildCalldata(
    quote({
      quoteMode: "exactOutput",
      amountOut: 900_000_000_000_000_000n,
      maxAmountIn: 1_000_000_000_000_000_000n,
    }),
  );

  assert.equal(builder.selector, "0x5023b4df");
  assert.equal(
    data,
    `0x5023b4df${addressWord(usdc.address)}${addressWord(wdoge.address)}${word(500n)}${addressWord(recipient)}${word(900_000_000_000_000_000n)}${word(1_000_000_000_000_000_000n)}${word(0n)}`,
  );
});

test("venue calldata builders encode Barkswap Algebra exactInputSingle calldata", () => {
  const builder = builderFor("barkswap-algebra", "algebra", [
    {
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
      quoterPoolDeployer: zeroDeployer,
    },
  ]);
  const data = builder.buildCalldata(
    quote({
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
    }),
  );

  assert.equal(builder.selector, "0x1679c792");
  assert.equal(
    data,
    `0x1679c792${addressWord(usdc.address)}${addressWord(wdoge.address)}${addressWord(zeroDeployer)}${addressWord(recipient)}${word(1_780_000_300n)}${word(1_000_000_000_000_000_000n)}${word(900_000_000_000_000_000n)}${word(0n)}`,
  );
});

test("venue calldata builders encode Barkswap Algebra exactOutputSingle calldata", () => {
  const builder = createVenueCalldataBuilders({
    sources: [
      {
        sourceId: "barkswap-algebra",
        protocolType: "algebra",
        quoterPoolDeployer: zeroDeployer,
      },
    ],
  }).find(
    (candidate) =>
      candidate.sourceId === "barkswap-algebra" &&
      candidate.protocolType === "algebra" &&
      candidate.quoteMode === "exactOutput",
  );
  assert.ok(builder);

  const data = builder.buildCalldata(
    quote({
      sourceId: "barkswap-algebra",
      protocolType: "algebra",
      quoteMode: "exactOutput",
      amountOut: 900_000_000_000_000_000n,
      maxAmountIn: 1_000_000_000_000_000_000n,
    }),
  );

  assert.equal(builder.selector, "0x1764babc");
  assert.equal(
    data,
    `0x1764babc${addressWord(usdc.address)}${addressWord(wdoge.address)}${addressWord(zeroDeployer)}${addressWord(recipient)}${word(1_780_000_300n)}${word(900_000_000_000_000_000n)}${word(1_000_000_000_000_000_000n)}${word(0n)}`,
  );
});
