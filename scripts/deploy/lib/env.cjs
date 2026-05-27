const fs = require("node:fs");
const path = require("node:path");
const { Wallet, getAddress, isAddress } = require("ethers");

const DEFAULT_CHAIN_ID = 6281971;
const DEFAULT_DOGEOS_RPC_URL = "https://rpc.testnet.dogeos.com";
const DEFAULT_BLOCKSCOUT_URL = "https://blockscout.testnet.dogeos.com";
const DEFAULT_WDOGE_ADDRESS = "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE";
const DEFAULT_MUCHFI_V2_FACTORY_ADDRESS = "0x7864071B532894216e3C045a74814EafEB92ae20";
const DEFAULT_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS = "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4";
const DEFAULT_USDC_ADDRESS = "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925";

function parseDotEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    values[key] = stripQuotes(rawValue.trim());
  }

  return values;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadDotEnv(cwd = process.cwd()) {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }

  return parseDotEnv(fs.readFileSync(envPath, "utf8"));
}

function mergeEnv({ cwd = process.cwd(), env = process.env } = {}) {
  return {
    ...loadDotEnv(cwd),
    ...env
  };
}

function normalizePrivateKey(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value || value.includes("replace_with")) {
    throw new Error("DEPLOYER_PRIVATE_KEY is missing or still uses the placeholder value");
  }

  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/u.test(normalized)) {
    throw new Error("DEPLOYER_PRIVATE_KEY must be exactly 32 bytes of hex");
  }

  return normalized;
}

function deriveAddress(privateKey) {
  return new Wallet(normalizePrivateKey(privateKey)).address;
}

function normalizeAddress(value, label) {
  if (!value || !isAddress(value)) {
    throw new Error(`${label} must be a valid EVM address`);
  }

  return getAddress(value);
}

function optionalAddress(value, label) {
  if (!value || String(value).includes("replace_after") || String(value).includes("replace_with")) {
    return undefined;
  }

  return normalizeAddress(value, label);
}

function resolveDeploymentConfig({ cwd = process.cwd(), env = process.env, requirePrivateKey = true } = {}) {
  const merged = mergeEnv({ cwd, env });
  const privateKey = requirePrivateKey ? normalizePrivateKey(merged.DEPLOYER_PRIVATE_KEY) : undefined;
  const deployerAddress = privateKey
    ? deriveAddress(privateKey)
    : optionalAddress(merged.DEPLOYER_ADDRESS, "DEPLOYER_ADDRESS");

  const configuredDeployer = optionalAddress(merged.DEPLOYER_ADDRESS, "DEPLOYER_ADDRESS");
  if (privateKey && configuredDeployer && configuredDeployer !== deployerAddress) {
    throw new Error("DEPLOYER_ADDRESS does not match DEPLOYER_PRIVATE_KEY");
  }

  if (!deployerAddress) {
    throw new Error("DEPLOYER_ADDRESS is required when DEPLOYER_PRIVATE_KEY is not loaded");
  }

  const routerOwnerAddress = optionalAddress(merged.ROUTER_OWNER_ADDRESS, "ROUTER_OWNER_ADDRESS") || deployerAddress;

  return {
    blockscoutUrl: merged.DOGEOS_BLOCKSCOUT_URL || DEFAULT_BLOCKSCOUT_URL,
    chainId: DEFAULT_CHAIN_ID,
    adapterAddress: optionalAddress(merged.DOGEOS_V2_PAIR_ADAPTER_ADDRESS, "DOGEOS_V2_PAIR_ADAPTER_ADDRESS"),
    deployerAddress,
    muchFiV2FactoryAddress: normalizeAddress(
      merged.DOGEOS_MUCHFI_V2_FACTORY_ADDRESS || DEFAULT_MUCHFI_V2_FACTORY_ADDRESS,
      "DOGEOS_MUCHFI_V2_FACTORY_ADDRESS"
    ),
    muchFiV2UsdcWdogePairAddress: normalizeAddress(
      merged.DOGEOS_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS || DEFAULT_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS,
      "DOGEOS_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS"
    ),
    privateKey,
    routerAddress: optionalAddress(merged.DOGEOS_SWAP_ROUTER_ADDRESS, "DOGEOS_SWAP_ROUTER_ADDRESS"),
    routerOwnerAddress,
    rpcUrl: merged.DOGEOS_RPC_URL || DEFAULT_DOGEOS_RPC_URL,
    usdcAddress: normalizeAddress(merged.USDC_ADDRESS || DEFAULT_USDC_ADDRESS, "USDC_ADDRESS"),
    wDogeAddress: normalizeAddress(merged.WDOGE_ADDRESS || DEFAULT_WDOGE_ADDRESS, "WDOGE_ADDRESS")
  };
}

function redactSecret(value) {
  const text = String(value || "");
  if (text.length <= 12) {
    return "<redacted>";
  }

  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

module.exports = {
  DEFAULT_BLOCKSCOUT_URL,
  DEFAULT_CHAIN_ID,
  DEFAULT_DOGEOS_RPC_URL,
  DEFAULT_MUCHFI_V2_FACTORY_ADDRESS,
  DEFAULT_MUCHFI_V2_USDC_WDOGE_PAIR_ADDRESS,
  DEFAULT_USDC_ADDRESS,
  DEFAULT_WDOGE_ADDRESS,
  deriveAddress,
  loadDotEnv,
  mergeEnv,
  normalizeAddress,
  normalizePrivateKey,
  parseDotEnv,
  redactSecret,
  resolveDeploymentConfig
};
