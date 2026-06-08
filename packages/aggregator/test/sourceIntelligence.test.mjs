import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVenueIntelligence,
  listRejectedSurfaces,
} from "../src/sources/intelligence.mjs";

test("venue intelligence separates executable, read-only, watchlist, and rejected surfaces", () => {
  const intelligence = buildVenueIntelligence({
    sources: [
      {
        sourceId: "live-v2",
        displayName: "Live V2",
        protocolType: "v2",
        status: "active",
        supportedPairs: ["WDOGE/USDC"],
        verification: { execution: true },
      },
      {
        sourceId: "quote-only",
        displayName: "Quote Only",
        protocolType: "v3",
        status: "readOnly",
        supportedPairs: ["WDOGE/USDC"],
        verification: { execution: false, reason: "Quoter is verified but router is not executable." },
      },
      {
        sourceId: "candidate",
        displayName: "Candidate",
        protocolType: "v3",
        status: "watchlist",
        supportedPairs: ["WDOGE/USDC"],
        verification: { execution: false, reason: "Router and quoter are not confirmed." },
      },
    ],
    venues: [
      {
        sourceId: "live-v2",
        execution: { enabled: true, reason: "Router verified." },
        contracts: [
          {
            role: "router",
            address: "0x1111111111111111111111111111111111111111",
            executionEvidence: {
              executable: true,
              abiProof: {
                provenance: "adapter-fragment",
                adapterAbiArtifactVerified: true,
                blockscoutAbiAvailable: false,
              },
            },
          },
          {
            role: "pool",
            address: "0x2222222222222222222222222222222222222222",
            executionEvidence: {
              onchainProof: {
                poolPair: "WDOGE/USDC",
                poolHasLiveLiquidity: true,
                poolFeeTier: 500,
              },
            },
          },
        ],
      },
      {
        sourceId: "quote-only",
        execution: { enabled: false, reason: "Read-only quote source." },
        contracts: [
          {
            role: "quoter",
            address: "0x3333333333333333333333333333333333333333",
            executionEvidence: {
              executable: false,
              abiProof: {
                provenance: "adapter-fragment",
                adapterAbiArtifactVerified: true,
              },
            },
          },
        ],
      },
      {
        sourceId: "candidate",
        execution: { enabled: false, reason: "Router pending." },
        contracts: [],
      },
    ],
  });

  assert.deepEqual(intelligence.summary, {
    activeExecutable: 1,
    readOnlyQuote: 1,
    watchlist: 1,
    rejected: listRejectedSurfaces().length,
  });
  assert.deepEqual(intelligence.activeExecutable.map((source) => source.sourceId), ["live-v2"]);
  assert.deepEqual(intelligence.readOnlyQuote.map((source) => source.sourceId), ["quote-only"]);
  assert.deepEqual(intelligence.watchlistCandidates.map((source) => source.sourceId), ["candidate"]);
  assert.equal(intelligence.activeExecutable[0].contracts.executableRouters, 1);
  assert.equal(intelligence.activeExecutable[0].liquidity.livePoolCount, 1);
  assert.deepEqual(intelligence.activeExecutable[0].liquidity.feeTiers, [500]);
  assert.equal(intelligence.activeExecutable[0].abi.provenance.includes("adapter-fragment"), true);
  assert.equal(intelligence.rejectedSurfaces.some((surface) => surface.surfaceId === "derps-perps"), true);
});

test("default venue intelligence uses the committed DogeOS source registry", () => {
  const intelligence = buildVenueIntelligence();

  assert.deepEqual(
    intelligence.activeExecutable.map((source) => source.sourceId).sort(),
    ["barkswap-algebra", "muchfi-v2", "muchfi-v3"],
  );
  assert.deepEqual(
    intelligence.watchlistCandidates.map((source) => source.sourceId).sort(),
    ["dogebox", "suchswap"],
  );
  assert.equal(intelligence.summary.rejected >= 4, true);
  assert.equal(intelligence.activeExecutable.every((source) => source.execution.enabled), true);
  assert.equal(
    intelligence.rejectedSurfaces.every((surface) => surface.execution.enabled === false),
    true,
  );
});
