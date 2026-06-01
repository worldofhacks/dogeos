import assert from "node:assert/strict";
import test from "node:test";

import { DOGEOS_CHAIN } from "../../config/src/chains.mjs";
import { hashAbiArtifactPayload } from "../src/abi/artifactHash.mjs";
import {
  VENUE_ABI_PROVENANCE,
  abiFunctionSignaturesFromAbi,
  createVenueAbiArtifact,
} from "../src/abi/venueAbiArtifacts.mjs";

const router = "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB";
const v3RouterAbi = Object.freeze([
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
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
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [],
  },
]);

test("abiFunctionSignaturesFromAbi derives canonical tuple function signatures", () => {
  assert.deepEqual(abiFunctionSignaturesFromAbi(v3RouterAbi), [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  ]);
});

test("createVenueAbiArtifact binds venue ABI proof to the exact DogeOS target and hash", () => {
  const artifact = createVenueAbiArtifact({
    sourceId: "muchfi-v3",
    role: "router",
    address: router,
    issuer: "MuchFi",
    sourceUri: "https://muchfi.example/abis/dogeos-testnet/router.json",
    selectors: ["0x04e45aaf"],
    abi: v3RouterAbi,
    checkedAt: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(artifact.kind, VENUE_ABI_PROVENANCE);
  assert.equal(artifact.status, "verified");
  assert.equal(artifact.verified, true);
  assert.equal(artifact.issuer, "MuchFi");
  assert.equal(artifact.sourceUri, "https://muchfi.example/abis/dogeos-testnet/router.json");
  assert.equal(artifact.checkedAt, "2026-06-01T00:00:00.000Z");
  assert.deepEqual(artifact.target, {
    sourceId: "muchfi-v3",
    chainId: DOGEOS_CHAIN.id,
    role: "router",
    address: router,
  });
  assert.deepEqual(artifact.selectors, ["0x04e45aaf"]);
  assert.deepEqual(artifact.abiFunctionSignatures, [
    "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  ]);
  assert.equal(
    artifact.artifactHash,
    hashAbiArtifactPayload({
      kind: VENUE_ABI_PROVENANCE,
      target: artifact.target,
      selectors: artifact.selectors,
      abiFunctionSignatures: artifact.abiFunctionSignatures,
      abi: artifact.abi,
    }),
  );
});

test("createVenueAbiArtifact rejects unsigned or unbound venue ABI metadata", () => {
  assert.throws(
    () =>
      createVenueAbiArtifact({
        sourceId: "muchfi-v3",
        role: "router",
        address: router,
        sourceUri: "https://muchfi.example/abis/dogeos-testnet/router.json",
        selectors: ["0x04e45aaf"],
        abi: v3RouterAbi,
      }),
    /issuer/i,
  );

  assert.throws(
    () =>
      createVenueAbiArtifact({
        sourceId: "muchfi-v3",
        role: "router",
        address: "0x1234",
        issuer: "MuchFi",
        sourceUri: "https://muchfi.example/abis/dogeos-testnet/router.json",
        selectors: ["0x04e45aaf"],
        abi: v3RouterAbi,
      }),
    /address/i,
  );

  assert.throws(
    () =>
      createVenueAbiArtifact({
        sourceId: "muchfi-v3",
        role: "router",
        address: router,
        issuer: "MuchFi",
        sourceUri: "https://muchfi.example/abis/dogeos-testnet/router.json",
        selectors: [],
        abi: v3RouterAbi,
      }),
    /selector/i,
  );

  assert.throws(
    () =>
      createVenueAbiArtifact({
        sourceId: "muchfi-v3",
        role: "router",
        address: router,
        issuer: "MuchFi",
        sourceUri: "https://muchfi.example/abis/dogeos-testnet/router.json",
        selectors: ["0x04e45aaf"],
        abi: [],
      }),
    /function/i,
  );

  assert.throws(
    () =>
      createVenueAbiArtifact({
        sourceId: "muchfi-v3",
        role: "router",
        address: router,
        issuer: "MuchFi",
        sourceUri: "https://muchfi.example/abis/dogeos-testnet/router.json",
        selectors: ["0x04e45aaf"],
        abi: v3RouterAbi,
        chainId: Number.NaN,
      }),
    /chainId/i,
  );
});
