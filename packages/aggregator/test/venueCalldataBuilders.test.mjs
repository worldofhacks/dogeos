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

// SwapRouter02-style deadline wrapper around a single inner call:
// multicall(uint256 deadline, bytes[] data) with data = [innerCalldata].
// Layout: selector ++ deadline ++ offset(0x40) ++ count(1) ++ elementOffset
// (0x20) ++ innerByteLength ++ inner bytes zero-padded to a 32-byte multiple.
const MULTICALL_DEADLINE_SELECTOR = "0x5ae401dc";
// exactInput/OutputSingle inner calldata: 4-byte selector + 7 words = 228 bytes.
const V3_INNER_BYTE_LENGTH = 228n;

function expectedV3Multicall(deadline, innerCalldata) {
  const inner = innerCalldata.slice(2);
  assert.equal(BigInt(inner.length / 2), V3_INNER_BYTE_LENGTH);
  const paddedInner = inner.padEnd(Math.ceil(inner.length / 64) * 64, "0");
  return `${MULTICALL_DEADLINE_SELECTOR}${word(deadline)}${word(64n)}${word(1n)}${word(32n)}${word(V3_INNER_BYTE_LENGTH)}${paddedInner}`;
}

// Decodes the deadline word (first argument) out of built multicall calldata.
function decodedMulticallDeadline(data) {
  assert.equal(data.slice(0, 10), MULTICALL_DEADLINE_SELECTOR);
  return BigInt(`0x${data.slice(10, 74)}`);
}

test("venue calldata builders wrap MuchFi V3 exactInputSingle in multicall with the quote deadline", () => {
  const builder = builderFor("muchfi-v3", "v3", [
    {
      sourceId: "muchfi-v3",
      protocolType: "v3",
    },
  ]);
  const data = builder.buildCalldata(quote());

  assert.equal(builder.selector, MULTICALL_DEADLINE_SELECTOR);
  assert.equal(
    data,
    expectedV3Multicall(
      1_780_000_300n,
      `0x04e45aaf${addressWord(usdc.address)}${addressWord(wdoge.address)}${word(500n)}${addressWord(recipient)}${word(1_000_000_000_000_000_000n)}${word(900_000_000_000_000_000n)}${word(0n)}`,
    ),
  );
  // The enforceable expiry decoded from the built calldata IS the quote deadline.
  assert.equal(decodedMulticallDeadline(data), 1_780_000_300n);
});

test("venue calldata builders refuse MuchFi V3 exactInputSingle calldata without a deadline", () => {
  const builder = builderFor("muchfi-v3", "v3", [
    {
      sourceId: "muchfi-v3",
      protocolType: "v3",
    },
  ]);

  assert.throws(() => builder.buildCalldata(quote({ deadline: undefined })));
  assert.throws(() => builder.buildCalldata(quote({ deadline: 0 })), /deadline/);
});

test("venue calldata builders wrap MuchFi V3 exactOutputSingle in multicall with the quote deadline", () => {
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

  assert.equal(builder.selector, MULTICALL_DEADLINE_SELECTOR);
  assert.equal(
    data,
    expectedV3Multicall(
      1_780_000_300n,
      `0x5023b4df${addressWord(usdc.address)}${addressWord(wdoge.address)}${word(500n)}${addressWord(recipient)}${word(900_000_000_000_000_000n)}${word(1_000_000_000_000_000_000n)}${word(0n)}`,
    ),
  );
  assert.equal(decodedMulticallDeadline(data), 1_780_000_300n);
});

test("venue calldata builders refuse MuchFi V3 exactOutputSingle calldata without a deadline", () => {
  const builder = createVenueCalldataBuilders({
    sources: [{ sourceId: "muchfi-v3", protocolType: "v3" }],
  }).find(
    (candidate) =>
      candidate.sourceId === "muchfi-v3" &&
      candidate.protocolType === "v3" &&
      candidate.quoteMode === "exactOutput",
  );
  assert.ok(builder);

  assert.throws(() =>
    builder.buildCalldata(
      quote({
        quoteMode: "exactOutput",
        amountOut: 900_000_000_000_000_000n,
        maxAmountIn: 1_000_000_000_000_000_000n,
        deadline: undefined,
      }),
    ),
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
