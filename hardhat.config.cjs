require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("solidity-coverage");

const {
  DEFAULT_BLOCKSCOUT_URL,
  DEFAULT_CHAIN_ID,
  DEFAULT_DOGEOS_RPC_URL,
  DEFAULT_WDOGE_ADDRESS,
  loadDotEnv,
  normalizePrivateKey
} = require("./scripts/deploy/lib/env.cjs");

for (const [key, value] of Object.entries(loadDotEnv(process.cwd()))) {
  if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
    process.env[key] = value;
  }
}

function dogeosAccounts() {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    return [];
  }

  try {
    return [normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY)];
  } catch {
    return [];
  }
}

module.exports = {
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "prague",
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  paths: {
    sources: "contracts",
    tests: "contracts/test"
  },
  networks: {
    dogeosTestnet: {
      chainId: DEFAULT_CHAIN_ID,
      url: process.env.DOGEOS_RPC_URL || DEFAULT_DOGEOS_RPC_URL,
      accounts: dogeosAccounts()
    }
  },
  etherscan: {
    apiKey: {
      dogeosTestnet: process.env.DOGEOS_BLOCKSCOUT_API_KEY || "dogeos-blockscout"
    },
    customChains: [
      {
        network: "dogeosTestnet",
        chainId: DEFAULT_CHAIN_ID,
        urls: {
          apiURL: `${(process.env.DOGEOS_BLOCKSCOUT_URL || DEFAULT_BLOCKSCOUT_URL).replace(/\/$/u, "")}/api`,
          browserURL: process.env.DOGEOS_BLOCKSCOUT_URL || DEFAULT_BLOCKSCOUT_URL
        }
      }
    ]
  },
  sourcify: {
    enabled: false
  },
  dogeos: {
    wDogeAddress: process.env.WDOGE_ADDRESS || DEFAULT_WDOGE_ADDRESS
  }
};
