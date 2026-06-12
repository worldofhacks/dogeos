import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_BALANCE,
  DOGESWAP_ROUTER_EXECUTE_SELECTOR,
  ROUTER_COMMANDS,
  buildDogeSwapSplitCalldata,
  encodeDogeSwapRouterExecute,
  encodePermit2PermitInput,
  encodePermit2TransferFromInput,
  encodeV2SwapInput,
  encodeV3SwapInput,
  encodeAlgebraSwapInput,
} from "../src/swap/dogeSwapRouterCalldata.mjs";

const usdc = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";
const wdoge = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";
const recipient = "0x1111111111111111111111111111111111111111";

// Ground truth captured byte-for-byte from `cast calldata` against the
// audited DogeSwapRouter ABI (forge toolchain), for a split program:
//   PERMIT2_TRANSFER_FROM(USDC, 1e18)
//   V3_SWAP(USDC->WDOGE, fee 500, amountIn 0.5e18, minOut 0)
//   V2_SWAP(amountIn CONTRACT_BALANCE, minOut 0, path [USDC, WDOGE])
//   settlement (WDOGE, 0.98e18, recipient), deadline 1780000300
const CAST_FIXTURE =
  "0xe56964c600000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000f6bdb158a5ddf77f1b83bc9074f6a472c58d78ae0000000000000000000000000000000000000000000000000d99a8cec7e200000000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000006a18a62c000000000000000000000000000000000000000000000000000000000000000301030200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000d19d2ffb1c284668b7afe72cddae1baf3bc039250000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000d19d2ffb1c284668b7afe72cddae1baf3bc03925000000000000000000000000f6bdb158a5ddf77f1b83bc9074f6a472c58d78ae00000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000006f05b59d3b20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000c0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000002000000000000000000000000d19d2ffb1c284668b7afe72cddae1baf3bc03925000000000000000000000000f6bdb158a5ddf77f1b83bc9074f6a472c58d78ae";

test("encodeDogeSwapRouterExecute matches the cast-generated calldata byte-for-byte", () => {
  const calldata = encodeDogeSwapRouterExecute({
    commands: [ROUTER_COMMANDS.PERMIT2_TRANSFER_FROM, ROUTER_COMMANDS.V3_SWAP, ROUTER_COMMANDS.V2_SWAP],
    inputs: [
      encodePermit2TransferFromInput({ token: usdc, amount: 10n ** 18n }),
      encodeV3SwapInput({ sellToken: usdc, buyToken: wdoge, feeTier: 500n, amountIn: 5n * 10n ** 17n, minOut: 0n }),
      encodeV2SwapInput({ amountIn: CONTRACT_BALANCE, minOut: 0n, path: [usdc, wdoge] }),
    ],
    settlement: { buyToken: wdoge, minOut: 98n * 10n ** 16n, recipient },
    deadline: 1_780_000_300n,
  });

  assert.equal(calldata.toLowerCase(), CAST_FIXTURE.toLowerCase());
});

test("encodeV2SwapInput lays out amountIn, minOut, and a dynamic path", () => {
  const input = encodeV2SwapInput({ amountIn: 123n, minOut: 7n, path: [usdc, wdoge] });
  const words = input.match(/.{64}/g);
  assert.equal(BigInt(`0x${words[0]}`), 123n);
  assert.equal(BigInt(`0x${words[1]}`), 7n);
  assert.equal(BigInt(`0x${words[2]}`), 96n); // path offset = 3 words
  assert.equal(BigInt(`0x${words[3]}`), 2n); // path length
  assert.equal(`0x${words[4].slice(24)}`, usdc.toLowerCase());
  assert.equal(`0x${words[5].slice(24)}`, wdoge.toLowerCase());
});

test("encodeAlgebraSwapInput defaults the deployer to the zero sentinel", () => {
  const input = encodeAlgebraSwapInput({ sellToken: usdc, buyToken: wdoge, amountIn: 5n, minOut: 1n });
  const words = input.match(/.{64}/g);
  assert.equal(`0x${words[2].slice(24)}`, "0x0000000000000000000000000000000000000000");
});

test("buildDogeSwapSplitCalldata pulls the total once and spends the last leg via CONTRACT_BALANCE", () => {
  const calldata = buildDogeSwapSplitCalldata(
    { routerPoolDeployer: "0x0000000000000000000000000000000000000000" },
    {
      sourceId: "dogeswap-split",
      sellToken: usdc,
      buyToken: wdoge,
      amountIn: 100n * 10n ** 18n,
      minAmountOut: 98n * 10n ** 18n,
      recipient,
      deadline: 1_780_000_300n,
      legs: [
        { protocolType: "v3", amountIn: 60n * 10n ** 18n, feeTier: 500n },
        { protocolType: "v2", amountIn: 40n * 10n ** 18n },
      ],
    },
  );

  assert.ok(calldata.startsWith(DOGESWAP_ROUTER_EXECUTE_SELECTOR));
  // The single Permit2 pull is for the full input amount…
  assert.ok(calldata.includes((100n * 10n ** 18n).toString(16).padStart(64, "0")));
  // …the first leg spends its explicit 60e18…
  assert.ok(calldata.includes((60n * 10n ** 18n).toString(16).padStart(64, "0")));
  // …and the last leg spends CONTRACT_BALANCE so no dust is stranded.
  assert.ok(calldata.includes(CONTRACT_BALANCE.toString(16).padStart(64, "0")));
});

test("encodePermit2PermitInput matches cast abi-encode((PermitSingle),(bytes))", () => {
  // Ground truth: cast abi-encode 'f(((address,uint160,uint48,uint48),address,uint256),bytes)'
  //   '((USDC,1e18,1790000000,7),0xa3158549f38400F355aDf20C92DA1769620Aa35A,1780002100)' 0x1b2c3d4e5f
  const expected =
    "000000000000000000000000d19d2ffb1c284668b7afe72cddae1baf3bc03925" +
    "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
    "000000000000000000000000000000000000000000000000000000006ab13b80" +
    "0000000000000000000000000000000000000000000000000000000000000007" +
    "000000000000000000000000a3158549f38400f355adf20c92da1769620aa35a" +
    "000000000000000000000000000000000000000000000000000000006a18ad34" +
    "00000000000000000000000000000000000000000000000000000000000000e0" +
    "0000000000000000000000000000000000000000000000000000000000000005" +
    "1b2c3d4e5f000000000000000000000000000000000000000000000000000000";

  const encoded = encodePermit2PermitInput({
    permitSingle: {
      details: { token: usdc, amount: 10n ** 18n, expiration: 1_790_000_000n, nonce: 7n },
      spender: "0xa3158549f38400F355aDf20C92DA1769620Aa35A",
      sigDeadline: 1_780_002_100n,
    },
    signature: "0x1b2c3d4e5f",
  });

  assert.equal(encoded, expected);
});

test("buildDogeSwapSplitCalldata prepends PERMIT2_PERMIT when a signed permit is attached", () => {
  const base = {
    sourceId: "dogeswap-split",
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 10n ** 18n,
    minAmountOut: 1n,
    recipient,
    deadline: 1_780_000_300n,
    legs: [
      { protocolType: "v3", amountIn: 6n * 10n ** 17n, feeTier: 500n },
      { protocolType: "v2", amountIn: 4n * 10n ** 17n },
    ],
  };
  const withoutPermit = buildDogeSwapSplitCalldata({}, base);
  const withPermit = buildDogeSwapSplitCalldata(
    {},
    {
      ...base,
      permit2Permit: {
        permitSingle: {
          details: { token: usdc, amount: "1000000000000000000", expiration: "1790000000", nonce: "0" },
          spender: "0xa3158549f38400F355aDf20C92DA1769620Aa35A",
          sigDeadline: "1780002100",
        },
        signature: `0x${"ab".repeat(65)}`,
      },
    },
  );

  // commands bytes live right after the 6-word head + length word
  const commandsOf = (calldata) => {
    const words = calldata.slice(10).match(/.{64}/g);
    const length = Number(BigInt(`0x${words[6]}`));
    return words[7].slice(0, length * 2);
  };
  assert.equal(commandsOf(withoutPermit), "010302"); // pull, v3, v2
  assert.equal(commandsOf(withPermit), "00010302"); // permit, pull, v3, v2
});

test("verified registry builds router-execution calldata for a wrapped venue quote", async () => {
  const { createVerifiedCalldataBuilder } = await import("../src/swap/calldataRegistry.mjs");
  const { createVenueCalldataBuilders } = await import("../src/swap/venueCalldataBuilders.mjs");

  const dogeRouter = "0xa3158549f38400F355aDf20C92DA1769620Aa35A";
  const venueRouter = "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB";
  const sources = [
    {
      sourceId: "muchfi-v3",
      protocolType: "v3",
      status: "active",
      router: venueRouter,
      abiProvenance: "venue-artifact",
      verification: { execution: true },
    },
    {
      sourceId: "dogeswap-split",
      protocolType: "aggregator",
      status: "active",
      router: dogeRouter,
      abiProvenance: "venue-artifact",
      verification: { execution: true },
    },
  ];
  const builder = createVerifiedCalldataBuilder({
    sources,
    builders: createVenueCalldataBuilders({ sources }),
  });

  const wrappedQuote = {
    sourceId: "muchfi-v3",
    protocolType: "v3",
    status: "active",
    quoteMode: "exactInput",
    executionMode: "dogeswap-router",
    router: dogeRouter,
    venueRouter,
    sellToken: usdc,
    buyToken: wdoge,
    amountIn: 10n ** 18n,
    minAmountOut: 9n * 10n ** 17n,
    recipient,
    deadline: 1_780_000_300n,
    legs: [{ sourceId: "muchfi-v3", protocolType: "v3", amountIn: 10n ** 18n, feeTier: 500n }],
  };
  const calldata = builder(wrappedQuote);
  assert.ok(calldata.startsWith(DOGESWAP_ROUTER_EXECUTE_SELECTOR));

  // Discipline: a wrapped quote whose venueRouter does not match the verified
  // venue must be rejected.
  assert.throws(
    () => builder({ ...wrappedQuote, venueRouter: recipient }),
    /venue router does not match/,
  );
  // And a wrapped quote pointing at an unverified execution router must fail.
  const withoutRouterSource = createVerifiedCalldataBuilder({
    sources: [sources[0]],
    builders: createVenueCalldataBuilders({ sources: [sources[0]] }),
  });
  assert.throws(() => withoutRouterSource(wrappedQuote), /not active and verified/);
});

test("buildDogeSwapSplitCalldata rejects legs that overspend the declared total", () => {
  assert.throws(
    () =>
      buildDogeSwapSplitCalldata(
        {},
        {
          sourceId: "dogeswap-split",
          sellToken: usdc,
          buyToken: wdoge,
          amountIn: 100n,
          minAmountOut: 90n,
          recipient,
          deadline: 1_780_000_300n,
          legs: [
            { protocolType: "v3", amountIn: 150n, feeTier: 500n },
            { protocolType: "v2", amountIn: 10n },
          ],
        },
      ),
    /overspend/,
  );
});
