import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import * as aggregator from "../src/index.mjs";

test("public aggregator API exports stable module boundaries", () => {
  assert.equal(typeof aggregator.listSources, "function");
  assert.equal(typeof aggregator.listVenueContracts, "function");
  assert.equal(typeof aggregator.deriveExecutableStatus, "function");
  assert.equal(typeof aggregator.createVenueAbiArtifact, "function");
  assert.equal(typeof aggregator.abiFunctionSignaturesFromAbi, "function");
  assert.equal(typeof aggregator.createVerificationSnapshotProvider, "function");
  assert.equal(typeof aggregator.summarizeAbiArtifact, "function");
  assert.equal(typeof aggregator.verifyDefaultSources, "function");
  assert.equal(typeof aggregator.feeWeiToTokenAmount, "function");
  assert.equal(typeof aggregator.normalizeFeeWeiRate, "function");
  assert.equal(typeof aggregator.scoreExactOutputQuote, "function");
  assert.equal(typeof aggregator.quoteV2ExactInput, "function");
  assert.equal(typeof aggregator.quoteV2ExactOutput, "function");
  assert.equal(typeof aggregator.quoteV3ExactInputFromQuoter, "function");
  assert.equal(typeof aggregator.quoteV3ExactOutputFromQuoter, "function");
  assert.equal(typeof aggregator.quoteAlgebraExactInputFromQuoter, "function");
  assert.equal(typeof aggregator.quoteAlgebraExactOutputFromQuoter, "function");
  assert.equal(typeof aggregator.discoverV2Pool, "function");
  assert.equal(typeof aggregator.createLiveV2QuoteCandidateProvider, "function");
  assert.equal(typeof aggregator.createLiveConcentratedLiquidityQuoterOutputProvider, "function");
  assert.equal(typeof aggregator.createCompositeQuoteCandidateProvider, "function");
  assert.equal(typeof aggregator.createVerifiedConcentratedLiquidityQuoteCandidateProvider, "function");
  assert.equal(typeof aggregator.chooseBestDirectRoute, "function");
  assert.equal(typeof aggregator.composeOneHopCandidates, "function");
  assert.equal(typeof aggregator.createOneHopQuoteCandidateProvider, "function");
  assert.equal(typeof aggregator.buildQuoteResponse, "function");
  assert.equal(typeof aggregator.buildReadOnlyCrosschainRoute, "function");
  assert.equal(typeof aggregator.deriveCrosschainOrderStatus, "function");
  assert.equal(typeof aggregator.isCrosschainEnabled, "function");
  assert.equal(typeof aggregator.buildSwapTx, "function");
  assert.equal(typeof aggregator.createVerifiedCalldataBuilder, "function");
  assert.equal(typeof aggregator.createErc20ApprovalPlanner, "function");
  assert.equal(typeof aggregator.buildErc20ApprovalPlan, "function");
  assert.equal(typeof aggregator.buildErc20ApproveCalldata, "function");
  assert.equal(typeof aggregator.createSwapBalanceVerifier, "function");
  assert.equal(typeof aggregator.buildSwapBalancePreflight, "function");
  assert.equal(typeof aggregator.createVenueCalldataBuilders, "function");
  assert.equal(typeof aggregator.buildV2SwapTokensForExactTokensCalldata, "function");
  assert.equal(typeof aggregator.buildMuchFiV3ExactOutputSingleCalldata, "function");
  assert.equal(typeof aggregator.buildBarkswapAlgebraExactOutputSingleCalldata, "function");
});

test("public aggregator API and package scripts expose no recurring admission surface", async () => {
  const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, "../../../package.json"), "utf8"));

  assert.equal("assertExecutableAdmissionRecord" in aggregator, false);
  assert.equal("validateExecutableAdmissionRecords" in aggregator, false);
  assert.equal("EXECUTABLE_ADMISSION_RECORDS" in aggregator, false);
  assert.equal("verify:admissions" in packageJson.scripts, false);
  assert.equal(packageJson.scripts["create:venue-abi"], "node scripts/create-venue-abi-artifact.mjs");
});
