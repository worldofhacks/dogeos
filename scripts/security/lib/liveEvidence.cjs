const fs = require("node:fs");
const path = require("node:path");

const DOGEOS_CHAIN_ID = 6281971;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function asBigInt(value) {
  return BigInt(value);
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function check(label, ok, details = undefined) {
  return { label, ok: Boolean(ok), ...(details === undefined ? {} : { details }) };
}

function deploymentsDir(cwd) {
  return path.join(cwd, "deployments", "dogeos-chikyu");
}

function docsDir(cwd) {
  return path.join(cwd, "docs", "dexv3");
}

function latestOnchainValidationPath(cwd) {
  const dir = docsDir(cwd);
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => /^onchain-validation-\d{4}-\d{2}-\d{2}\.json$/u.test(name))
    .sort();
  if (candidates.length === 0) {
    throw new Error("No on-chain validation JSON report found in docs/dexv3");
  }
  return path.join(dir, candidates[candidates.length - 1]);
}

function sourceBlocks(registryText) {
  const matches = registryText.match(/\{\n\s+sourceId: ".*?",[\s\S]*?\n\s+\}/gu);
  return matches || [];
}

function readStringField(block, field) {
  const match = block.match(new RegExp(`${field}:\\s*"([^"]+)"`, "u"));
  return match ? match[1] : undefined;
}

function readSourcePolicy(cwd) {
  const registryPath = path.join(cwd, "packages", "aggregator", "src", "sources", "registry.ts");
  const registryText = fs.readFileSync(registryPath, "utf8");
  const sources = sourceBlocks(registryText).map((block) => ({
    sourceId: readStringField(block, "sourceId"),
    status: readStringField(block, "status"),
    quoteSupport: readStringField(block, "quoteSupport"),
    executionSupport: readStringField(block, "executionSupport"),
    verified: /verified:\s*true/u.test(block)
  }));

  return {
    sources,
    quoteActiveSources: sources
      .filter((source) => source.quoteSupport === "enabled" && source.status === "quoteActive")
      .map((source) => source.sourceId),
    executableSources: sources
      .filter((source) => source.executionSupport === "enabled" && source.verified)
      .map((source) => source.sourceId)
  };
}

function validateLiveEvidence({ cwd = process.cwd() } = {}) {
  const deploymentDir = deploymentsDir(cwd);
  const router = readJson(path.join(deploymentDir, "router-latest.json"));
  const adapter = readJson(path.join(deploymentDir, "adapter-latest.json"));
  const allowlist = readJson(path.join(deploymentDir, "adapter-allowlist-preflight-latest.json"));
  const route = readJson(path.join(deploymentDir, "route-v2-preflight-latest.json"));
  const canary = readJson(path.join(deploymentDir, "canary-v2-swap-latest.json"));
  const onchainValidationPath = latestOnchainValidationPath(cwd);
  const onchain = readJson(onchainValidationPath);
  const sourcePolicy = readSourcePolicy(cwd);

  const checks = [
    check("registry keeps only MuchFi V2 executable", sourcePolicy.executableSources.join(",") === "muchfi-v2", {
      executableSources: sourcePolicy.executableSources
    }),
    check(
      "registry quote-enables MuchFi V3 and Barkswap",
      sourcePolicy.quoteActiveSources.join(",") === "muchfi-v3,barkswap-algebra",
      { quoteActiveSources: sourcePolicy.quoteActiveSources }
    ),
    check("router deploy evidence is DogeOS Chikyu and successful", router.chainId === DOGEOS_CHAIN_ID && router.status === 1),
    check("adapter deploy evidence is DogeOS Chikyu and successful", adapter.chainId === DOGEOS_CHAIN_ID && adapter.status === 1),
    check(
      "router and adapter addresses are well formed",
      ADDRESS.test(router.routerAddress) && ADDRESS.test(adapter.adapterAddress)
    ),
    check(
      "adapter allowlist preflight confirms already allowed",
      allowlist.chainId === DOGEOS_CHAIN_ID &&
        allowlist.alreadyAllowed === true &&
        lower(allowlist.router?.routerAddress) === lower(router.routerAddress) &&
        lower(allowlist.adapter?.adapterAddress) === lower(adapter.adapterAddress)
    ),
    check(
      "route preflight targets deployed router and adapter",
      route.chainId === DOGEOS_CHAIN_ID &&
        lower(route.routerAddress) === lower(router.routerAddress) &&
        lower(route.adapterAddress) === lower(adapter.adapterAddress) &&
        lower(route.tokenIn) === lower(ZERO_ADDRESS) &&
        asBigInt(route.estimatedSwapGas) > 0n &&
        asBigInt(route.quotedAmountOut) > 0n &&
        asBigInt(route.minAmountOut) > 0n
    ),
    check(
      "canary swap receipt is successful and linked to Blockscout",
      canary.chainId === DOGEOS_CHAIN_ID &&
        canary.receipt?.status === 1 &&
        TX_HASH.test(canary.receipt?.transactionHash || "") &&
        String(canary.receipt?.explorerUrl || "").includes(canary.receipt.transactionHash)
    ),
    check(
      "canary swap used deployed router and adapter",
      lower(canary.routerAddress) === lower(router.routerAddress) &&
        lower(canary.adapterAddress) === lower(adapter.adapterAddress)
    ),
    check(
      "canary output and gas are within preflight bounds",
      asBigInt(canary.actualAmountOut) >= asBigInt(canary.minAmountOut) &&
        asBigInt(canary.receipt.gasUsed) <= asBigInt(canary.estimatedGas)
    ),
    check(
      "canary post-checks preserve router safety invariants",
      canary.postChecks?.adapterAllowed === true &&
        canary.postChecks?.outputMetMinimum === true &&
        canary.postChecks?.routerAdapterAllowanceReset === true &&
        canary.postChecks?.routerPaused === false &&
        canary.postChecks?.routerUsdcDeltaZero === true &&
        canary.postChecks?.routerWdogeDeltaZero === true
    ),
    check(
      "MuchFi V3 quote pools have live bytecode and liquidity evidence",
      onchain.contracts?.muchFiV3Factory?.bytecodePresent === true &&
        onchain.contracts?.muchFiV3UsdcWdoge500?.bytecodePresent === true &&
        onchain.contracts?.muchFiV3UsdcWdoge2500?.bytecodePresent === true &&
        asBigInt(onchain.muchFiV3?.usdcWdoge500?.liquidity || 0) > 0n
    ),
    check(
      "Barkswap quote pools have live bytecode and liquidity evidence",
      onchain.contracts?.barkswapNewFactory?.bytecodePresent === true &&
        onchain.contracts?.barkswapUsdcWdogeNew?.bytecodePresent === true &&
        asBigInt(onchain.barkswap?.usdcWdoge?.liquidity || 0) > 0n
    )
  ];

  return {
    ok: checks.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    summary: {
      chainId: DOGEOS_CHAIN_ID,
      executableSources: sourcePolicy.executableSources,
      quoteActiveSources: sourcePolicy.quoteActiveSources,
      routerAddress: router.routerAddress,
      adapterAddress: adapter.adapterAddress,
      canaryTransactionHash: canary.receipt?.transactionHash,
      onchainValidationPath: path.relative(cwd, onchainValidationPath)
    },
    checks,
    artifacts: {
      router,
      adapter,
      allowlist,
      route,
      canary
    }
  };
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

function markdownReport(report) {
  const rows = report.checks
    .map((item) => `| ${item.label} | ${item.ok ? "Pass" : "Fail"} |`)
    .join("\n");

  return `# DogeOS Security Automation Evidence ${report.checkedAt.slice(0, 10)}

Generated: \`${report.checkedAt}\`

| Field | Value |
| --- | --- |
| Chain ID | \`${report.summary.chainId}\` |
| Executable sources | \`${report.summary.executableSources.join(", ") || "none"}\` |
| Quote-active sources | \`${report.summary.quoteActiveSources.join(", ") || "none"}\` |
| Router | \`${report.summary.routerAddress}\` |
| Adapter | \`${report.summary.adapterAddress}\` |
| Canary tx | \`${report.summary.canaryTransactionHash}\` |
| On-chain validation | \`${report.summary.onchainValidationPath}\` |

## Checks

| Check | Result |
| --- | --- |
${rows}
`;
}

function writeLiveEvidenceReport(report, { cwd = process.cwd() } = {}) {
  const dir = docsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const date = report.checkedAt.slice(0, 10);
  const jsonPath = path.join(dir, `security-automation-${date}.json`);
  const markdownPath = path.join(dir, `security-automation-${date}.md`);
  const latestJsonPath = path.join(dir, "security-automation-latest.json");
  fs.writeFileSync(jsonPath, `${stringify(report)}\n`);
  fs.writeFileSync(latestJsonPath, `${stringify(report)}\n`);
  fs.writeFileSync(markdownPath, markdownReport(report));
  return { jsonPath, latestJsonPath, markdownPath };
}

module.exports = {
  DOGEOS_CHAIN_ID,
  latestOnchainValidationPath,
  readSourcePolicy,
  validateLiveEvidence,
  writeLiveEvidenceReport
};
