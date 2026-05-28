const fs = require("node:fs");
const path = require("node:path");
const { JsonRpcProvider } = require("ethers");
const {
  DEFAULT_BLOCKSCOUT_URL,
  DEFAULT_CHAIN_ID,
  DEFAULT_DOGEOS_RPC_URL,
  mergeEnv
} = require("../deploy/lib/env.cjs");
const {
  buildFundingPlan,
  formatFundingMarkdown,
  lastClaimedAtByAddressFromState,
  markAddressClaimed,
  normalizeFundingAddresses
} = require("./lib/fundingPlan.cjs");

const DEFAULT_TARGET_DOGE = "5";
const DEFAULT_STATE_PATH = "deployments/dogeos-chikyu/faucet-funding-state.json";

function parseArgs(argv) {
  const args = {
    markClaimed: undefined,
    statePath: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mark-claimed") {
      args.markClaimed = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--state") {
      args.statePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.markClaimed === "") {
    throw new Error("--mark-claimed requires a wallet address");
  }
  if (args.statePath === "") {
    throw new Error("--state requires a file path");
  }

  return args;
}

function printHelp() {
  console.log(`Usage: pnpm faucet:plan [-- --mark-claimed <address>] [-- --state <path>]

Builds a DogeOS Chikyu testnet faucet funding plan for project wallets.

This command does not automate faucet claims. Complete the official faucet flow manually,
then use --mark-claimed to record the local 24-hour claim window.`);
}

function resolveAddressSource(env) {
  const configuredFaucetAddresses = env.DOGEOS_FAUCET_ADDRESSES || "";
  const configured = configuredFaucetAddresses.includes("replace_with")
    ? env.DEPLOYER_ADDRESS
    : configuredFaucetAddresses || env.DEPLOYER_ADDRESS;
  if (!configured || String(configured).includes("replace_with")) {
    throw new Error("Set DOGEOS_FAUCET_ADDRESSES or DEPLOYER_ADDRESS to at least one project wallet address");
  }

  return configured;
}

function readJsonIfExists(target) {
  if (!fs.existsSync(target)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${target}.tmp`, target);
}

function writeTextAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, value);
  fs.renameSync(`${target}.tmp`, target);
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10);
}

async function readBalances(provider, addresses) {
  const entries = await Promise.all(
    addresses.map(async (address) => [address, (await provider.getBalance(address)).toString()])
  );

  return Object.fromEntries(entries);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const cwd = process.cwd();
  const env = mergeEnv({ cwd });
  const now = new Date();
  const statePath = path.resolve(cwd, args.statePath || env.DOGEOS_FAUCET_STATE_PATH || DEFAULT_STATE_PATH);
  let claimState = readJsonIfExists(statePath);

  if (args.markClaimed) {
    claimState = markAddressClaimed(claimState, args.markClaimed, now);
    writeJsonAtomic(statePath, claimState);
  }

  const rpcUrl = env.DOGEOS_RPC_URL || DEFAULT_DOGEOS_RPC_URL;
  const blockscoutUrl = env.DOGEOS_BLOCKSCOUT_URL || DEFAULT_BLOCKSCOUT_URL;
  const chainId = DEFAULT_CHAIN_ID;
  const addresses = normalizeFundingAddresses(resolveAddressSource(env));
  const provider = new JsonRpcProvider(rpcUrl, {
    chainId,
    name: "dogeos-chikyu-testnet"
  });
  const network = await provider.getNetwork();

  if (Number(network.chainId) !== chainId) {
    throw new Error(`Expected DogeOS Chikyu chainId ${chainId}, got ${network.chainId.toString()}`);
  }

  const [blockNumber, balancesWeiByAddress] = await Promise.all([
    provider.getBlockNumber(),
    readBalances(provider, addresses)
  ]);

  const targetMode = env.DOGEOS_FAUCET_TARGET_MODE || (env.DOGEOS_FAUCET_TOP_UP_DOGE ? "top-up" : "absolute");
  const targetDoge = env.DOGEOS_FAUCET_TOP_UP_DOGE || env.DOGEOS_FAUCET_TARGET_DOGE || DEFAULT_TARGET_DOGE;
  const plan = buildFundingPlan({
    addresses,
    balancesWeiByAddress,
    lastClaimedAtByAddress: lastClaimedAtByAddressFromState(claimState),
    minimumIntervalHours: env.DOGEOS_FAUCET_MIN_INTERVAL_HOURS || 24,
    now,
    targetDoge,
    targetMode
  });
  plan.blockNumber = blockNumber;
  plan.blockscoutUrl = blockscoutUrl;
  plan.chainId = chainId;
  plan.rpcUrl = rpcUrl;
  plan.statePath = path.relative(cwd, statePath);

  const dated = dateStamp(now);
  const deploymentReport = path.join(cwd, "deployments", "dogeos-chikyu", "faucet-funding-latest.json");
  const datedDeploymentReport = path.join(cwd, "deployments", "dogeos-chikyu", `faucet-funding-${dated}.json`);
  const docsReport = path.join(cwd, "docs", "dexv3", "faucet-funding-latest.md");
  const datedDocsReport = path.join(cwd, "docs", "dexv3", `faucet-funding-${dated}.md`);
  const markdown = formatFundingMarkdown(plan);

  writeJsonAtomic(deploymentReport, plan);
  writeJsonAtomic(datedDeploymentReport, plan);
  writeTextAtomic(docsReport, markdown);
  writeTextAtomic(datedDocsReport, markdown);

  console.log("DogeOS faucet funding plan written");
  console.log(`chainId: ${chainId}`);
  console.log(`blockNumber: ${blockNumber}`);
  console.log(`wallets: ${plan.summary.walletCount}`);
  console.log(`eligibleNow: ${plan.summary.eligibleWallets}`);
  console.log(`targetMode: ${plan.targetMode}`);
  console.log(`targetInputDOGE: ${plan.targetInputDoge}`);
  console.log(`targetDeficitDOGE: ${plan.summary.totalDeficitDoge}`);
  console.log(`faucet: ${plan.faucetUrl}`);
  console.log(`stateFile: ${path.relative(cwd, statePath)}`);
  console.log(`planFile: ${path.relative(cwd, deploymentReport)}`);
  console.log(`docsFile: ${path.relative(cwd, docsReport)}`);

  if (args.markClaimed) {
    console.log(`markedClaimed: ${normalizeFundingAddresses([args.markClaimed])[0]}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
