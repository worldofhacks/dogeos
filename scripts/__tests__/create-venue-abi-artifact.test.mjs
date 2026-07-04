import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVenueAbiArtifactFromArgs,
  parseArgs,
} from "../create-venue-abi-artifact.mjs";

const router = "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB";
const exactInputOnlyAbiJson = JSON.stringify([
  {
    type: "function",
    name: "exactInputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
  },
]);

const v3RouterAbiJson = JSON.stringify([
  {
    type: "function",
    name: "exactInputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "exactOutputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountOut", type: "uint256" },
          { name: "amountInMaximum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "multicall",
    inputs: [
      { name: "deadline", type: "uint256" },
      { name: "data", type: "bytes[]" },
    ],
  },
]);

test("parseArgs normalizes venue ABI artifact CLI options", () => {
  assert.deepEqual(
    parseArgs([
      "--source-id",
      "muchfi-v3",
      "--role",
      "router",
      "--address",
      router,
      "--issuer",
      "MuchFi",
      "--source-uri",
      "https://muchfi.example/router.json",
      "--selectors",
      "0x04e45aaf,0x5023b4df",
      "--abi",
      "router.json",
      "--checked-at",
      "2026-06-01T00:00:00.000Z",
    ]),
    {
      sourceId: "muchfi-v3",
      role: "router",
      address: router,
      issuer: "MuchFi",
      sourceUri: "https://muchfi.example/router.json",
      selectors: ["0x04e45aaf", "0x5023b4df"],
      abiPath: "router.json",
      checkedAt: "2026-06-01T00:00:00.000Z",
    },
  );
});

test("buildVenueAbiArtifactFromArgs reads ABI JSON and returns a verified artifact", async () => {
  const artifact = await buildVenueAbiArtifactFromArgs(
    [
      "--source-id",
      "new-dex",
      "--role",
      "router",
      "--address",
      router,
      "--issuer",
      "MuchFi",
      "--source-uri",
      "https://muchfi.example/router.json",
      "--selectors",
      "0x04e45aaf",
      "--abi",
      "router.json",
    ],
    {
      readFileFn: async (filePath, encoding) => {
        assert.equal(filePath, "router.json");
        assert.equal(encoding, "utf8");
        return exactInputOnlyAbiJson;
      },
    },
  );

  assert.equal(artifact.kind, "venue-artifact");
  assert.equal(artifact.verified, true);
  assert.deepEqual(artifact.selectors, ["0x04e45aaf"]);
  assert.deepEqual(artifact.abiFunctionSignatures, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  ]);
  assert.match(artifact.artifactHash, /^0x[0-9a-f]{64}$/);
});

test("buildVenueAbiArtifactFromArgs can resolve target metadata from the source registry", async () => {
  const artifact = await buildVenueAbiArtifactFromArgs(
    [
      "--source-id",
      "muchfi-v3",
      "--role",
      "router",
      "--issuer",
      "MuchFi",
      "--source-uri",
      "https://muchfi.example/router.json",
      "--abi",
      "router.json",
    ],
    {
      readFileFn: async () => v3RouterAbiJson,
    },
  );

  assert.equal(artifact.target.address, router);
  assert.deepEqual(artifact.selectors, ["0x04e45aaf", "0x5023b4df", "0x5ae401dc"]);
  assert.deepEqual(artifact.abiFunctionSignatures, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))",
    "multicall(uint256,bytes[])",
  ]);
});

test("buildVenueAbiArtifactFromArgs rejects registry targets when ABI functions are missing", async () => {
  await assert.rejects(
    () =>
      buildVenueAbiArtifactFromArgs(
        [
          "--source-id",
          "muchfi-v3",
          "--role",
          "router",
          "--issuer",
          "MuchFi",
          "--source-uri",
          "https://muchfi.example/router.json",
          "--abi",
          "router.json",
        ],
        {
          readFileFn: async () => exactInputOnlyAbiJson,
        },
      ),
    /missing expected ABI function/i,
  );
});

test("buildVenueAbiArtifactFromArgs rejects registry targets when selectors are missing", async () => {
  await assert.rejects(
    () =>
      buildVenueAbiArtifactFromArgs(
        [
          "--source-id",
          "muchfi-v3",
          "--role",
          "router",
          "--issuer",
          "MuchFi",
          "--source-uri",
          "https://muchfi.example/router.json",
          "--selectors",
          "0x04e45aaf",
          "--abi",
          "router.json",
        ],
        {
          readFileFn: async () => v3RouterAbiJson,
        },
      ),
    /missing expected selector/i,
  );
});
