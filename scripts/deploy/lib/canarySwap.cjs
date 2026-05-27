const fs = require("node:fs");
const path = require("node:path");

const BPS_DENOMINATOR = 10_000n;

function calculateMinAmountOut(quotedAmountOut, slippageBps) {
  const quote = BigInt(quotedAmountOut);
  const bps = BigInt(slippageBps);
  const haircut = (quote * bps) / BPS_DENOMINATOR;
  return quote - haircut;
}

function parseBoundedInteger(rawValue, label, min, max) {
  const value = String(rawValue || "").trim();
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function parseBoundedBps(rawValue, label, max) {
  return parseBoundedInteger(rawValue, label, 0, max);
}

function validatePositiveAmount(amount, label) {
  const value = BigInt(amount);
  if (value <= 0n) {
    throw new Error(`${label} must be greater than zero`);
  }

  return value;
}

function evidenceFilenames(isoTimestamp) {
  const date = isoTimestamp.slice(0, 10);
  const time = isoTimestamp.slice(11).replace(/[:.]/gu, "");
  return {
    jsonFilename: `canary-v2-swap-${date}T${time}.json`,
    latestJsonFilename: "canary-v2-swap-latest.json",
    markdownFilename: `canary-v2-swap-${date}.md`
  };
}

function stringify(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2
  );
}

function deploymentsDir(cwd = process.cwd()) {
  return path.join(cwd, "deployments", "dogeos-chikyu");
}

function docsDir(cwd = process.cwd()) {
  return path.join(cwd, "docs", "dexv3");
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, `${stringify(value)}\n`);
  fs.renameSync(`${target}.tmp`, target);
}

function writeCanaryEvidence(evidence, { cwd = process.cwd() } = {}) {
  const filenames = evidenceFilenames(evidence.startedAt);
  const deploymentJsonPath = path.join(deploymentsDir(cwd), filenames.jsonFilename);
  const latestJsonPath = path.join(deploymentsDir(cwd), filenames.latestJsonFilename);
  const markdownPath = path.join(docsDir(cwd), filenames.markdownFilename);

  writeJson(deploymentJsonPath, evidence);
  writeJson(latestJsonPath, evidence);
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(markdownPath, markdownReport(evidence));

  return {
    deploymentJsonPath,
    latestJsonPath,
    markdownPath
  };
}

function markdownReport(evidence) {
  return `# DogeOS V2 Canary Swap ${evidence.startedAt.slice(0, 10)}

Generated: \`${evidence.completedAt}\`

This was a dust-size live Chikyu testnet swap through the deployed \`DogeOSSwapRouter\` and \`DogeOSV2PairAdapter\`. The route used native DOGE input, router-side WDOGE wrapping, and the canonical MuchFi V2 WDOGE/USDC pair.

| Field | Value |
| --- | --- |
| Chain ID | \`${evidence.chainId}\` |
| Block | \`${evidence.receipt.blockNumber}\` |
| Router | \`${evidence.routerAddress}\` |
| Adapter | \`${evidence.adapterAddress}\` |
| Pair | \`${evidence.pairAddress}\` |
| Token in | native DOGE via WDOGE \`${evidence.wDogeAddress}\` |
| Token out | USDC \`${evidence.usdcAddress}\` |
| Amount in wei | \`${evidence.amountInWei}\` |
| Quoted amount out | \`${evidence.quotedAmountOut}\` |
| Min amount out | \`${evidence.minAmountOut}\` |
| Actual amount out | \`${evidence.actualAmountOut}\` |
| Slippage bps | \`${evidence.slippageBps}\` |
| Estimated gas | \`${evidence.estimatedGas}\` |
| Gas used | \`${evidence.receipt.gasUsed}\` |
| Transaction | \`${evidence.receipt.transactionHash}\` |
| Explorer | ${evidence.receipt.explorerUrl} |

## Post-Swap Checks

| Check | Result |
| --- | --- |
| Router remained unpaused | ${evidence.postChecks.routerPaused === false ? "Pass" : "Fail"} |
| Adapter remained allowlisted | ${evidence.postChecks.adapterAllowed === true ? "Pass" : "Fail"} |
| Output met min amount | ${evidence.postChecks.outputMetMinimum === true ? "Pass" : "Fail"} |
| Router WDOGE delta was zero | ${evidence.postChecks.routerWdogeDeltaZero === true ? "Pass" : "Fail"} |
| Router USDC delta was zero | ${evidence.postChecks.routerUsdcDeltaZero === true ? "Pass" : "Fail"} |
| Router adapter allowance reset | ${evidence.postChecks.routerAdapterAllowanceReset === true ? "Pass" : "Fail"} |
`;
}

module.exports = {
  BPS_DENOMINATOR,
  calculateMinAmountOut,
  evidenceFilenames,
  parseBoundedBps,
  parseBoundedInteger,
  validatePositiveAmount,
  writeCanaryEvidence
};
