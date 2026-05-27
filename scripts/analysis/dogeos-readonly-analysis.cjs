const fs = require("node:fs");
const path = require("node:path");
const { Contract, JsonRpcProvider } = require("ethers");
const {
  DEFAULT_BLOCKSCOUT_URL,
  DEFAULT_CHAIN_ID,
  DEFAULT_DOGEOS_RPC_URL
} = require("../deploy/lib/env.cjs");
const { readDeploymentJson } = require("../deploy/lib/deploymentState.cjs");

const REPORT_DATE = process.env.REPORT_DATE || new Date().toISOString().slice(0, 10);
const RPC_URL = process.env.DOGEOS_RPC_URL || DEFAULT_DOGEOS_RPC_URL;
const BLOCKSCOUT_URL = process.env.DOGEOS_BLOCKSCOUT_URL || DEFAULT_BLOCKSCOUT_URL;

const TOKENS = {
  WDOGE: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
  LBTC: "0x29789F5A3e4c3113e7165c33A7E3bc592CF6fE0E",
  WETH: "0x1a6094Ac3ca3Fc9F1B4777941a5f4AAc16A72000",
  USD1: "0x25D5E5375e01Ed39Dc856bDCA5040417fD45eA3F",
  USDC: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
  USDT: "0xC81800b77D91391Ef03d7868cB81204E753093a9"
};

const CONTRACTS = {
  l1GasPriceOracle: "0x5300000000000000000000000000000000000002",
  muchFiV2Factory: "0x7864071B532894216e3C045a74814EafEB92ae20",
  muchFiV2UsdcWdoge: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
  muchFiV2UsdtWdoge: "0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4",
  muchFiV3PositionManager: "0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5",
  muchFiV3Factory: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
  muchFiV3RouterCandidate: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
  muchFiV3UsdcWdoge500: "0x4F1c638952a23DB25a13167B83810201c4BC7299",
  muchFiV3UsdcWdoge2500: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
  muchFiV3UsdtWdoge500: "0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F",
  barkswapNewFactory: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
  barkswapNewPositionManager: "0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07",
  barkswapUsdcWdogeNew: "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
  barkswapUsdtWdogeNew: "0x5DC3eB0e452f464e134F854EAeDf9431B93Da624"
};

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];
const V2_FACTORY_ABI = [
  "function allPairsLength() view returns (uint256)",
  "function getPair(address,address) view returns (address)"
];
const V2_PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)"
];
const V3_FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const V3_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"
];
const ALGEBRA_FACTORY_ABI = ["function poolByPair(address,address) view returns (address)"];
const ALGEBRA_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint16)",
  "function liquidity() view returns (uint128)",
  "function globalState() view returns (uint160,int24,uint16,uint16,uint16,bool)"
];
const L1_ORACLE_ABI = ["function getL1Fee(bytes) view returns (uint256)"];

function localDeployments() {
  const router = readDeploymentJson("router-latest.json");
  const adapter = readDeploymentJson("adapter-latest.json");
  const allowlist = readDeploymentJson("adapter-allowlist-latest.json");
  const canary = readDeploymentJson("canary-v2-swap-latest.json");

  return {
    router: router
      ? {
          address: router.routerAddress,
          blockNumber: router.deployedBlockNumber,
          transactionHash: router.transactionHash
        }
      : null,
    allowlist: allowlist
      ? {
          adapter: allowlist.adapter?.adapterAddress,
          blockNumber: allowlist.deployedBlockNumber,
          router: allowlist.router?.routerAddress,
          transactionHash: allowlist.transactionHash
        }
      : null,
    canary: canary
      ? {
          actualAmountOut: canary.actualAmountOut,
          amountInWei: canary.amountInWei,
          blockNumber: canary.receipt?.blockNumber,
          postChecks: canary.postChecks,
          transactionHash: canary.receipt?.transactionHash
        }
      : null,
    adapter: adapter
      ? {
          address: adapter.adapterAddress,
          blockNumber: adapter.deployedBlockNumber,
          transactionHash: adapter.transactionHash,
          factory: adapter.muchFiV2FactoryAddress
        }
      : null
  };
}

function stringify(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === "bigint" ? item.toString() : item),
    2
  );
}

async function codeInfo(provider, address) {
  const code = await provider.getCode(address);
  return {
    address,
    bytecodePresent: code !== "0x",
    bytecodeLength: code === "0x" ? 0 : (code.length - 2) / 2
  };
}

async function blockscoutAddress(address) {
  const url = `${BLOCKSCOUT_URL.replace(/\/$/u, "")}/api/v2/addresses/${address}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { httpStatus: response.status, isContract: null, isVerified: null, name: null };
    }
    const body = await response.json();
    return {
      httpStatus: response.status,
      isContract: Boolean(body.is_contract),
      isVerified: Boolean(body.is_verified),
      name: body.name || null
    };
  } catch (error) {
    return { httpStatus: null, isContract: null, isVerified: null, name: null, error: error.message };
  }
}

async function readToken(provider, symbol, address) {
  const token = new Contract(address, ERC20_ABI, provider);
  const [name, onchainSymbol, decimals, code] = await Promise.all([
    token.name(),
    token.symbol(),
    token.decimals(),
    codeInfo(provider, address)
  ]);
  return {
    address,
    name,
    symbol: onchainSymbol,
    expectedSymbol: symbol,
    decimals: Number(decimals),
    bytecodePresent: code.bytecodePresent,
    bytecodeLength: code.bytecodeLength
  };
}

async function readV2Pair(provider, address) {
  const pair = new Contract(address, V2_PAIR_ABI, provider);
  const [token0, token1, reserves] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves()
  ]);
  return {
    address,
    token0,
    token1,
    reserves: [reserves[0], reserves[1], reserves[2]]
  };
}

async function readV3Pool(provider, address) {
  const pool = new Contract(address, V3_POOL_ABI, provider);
  const [token0, token1, fee, liquidity, slot0] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.liquidity(),
    pool.slot0()
  ]);
  return {
    address,
    token0,
    token1,
    fee,
    liquidity,
    slot0: Array.from(slot0)
  };
}

async function readAlgebraPool(provider, address) {
  const pool = new Contract(address, ALGEBRA_POOL_ABI, provider);
  const [token0, token1, fee, liquidity, globalState] = await Promise.all([
    pool.token0(),
    pool.token1(),
    pool.fee(),
    pool.liquidity(),
    pool.globalState()
  ]);
  return {
    address,
    token0,
    token1,
    fee,
    liquidity,
    globalState: Array.from(globalState)
  };
}

function writeReport(json) {
  const dir = path.join(process.cwd(), "docs", "dexv3");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `onchain-validation-${REPORT_DATE}.json`);
  const mdPath = path.join(dir, `onchain-validation-${REPORT_DATE}.md`);
  fs.writeFileSync(jsonPath, `${stringify(json)}\n`);

  const tokenRows = Object.entries(json.tokens)
    .map(([, token]) => `| ${token.expectedSymbol} | \`${token.address}\` | ${token.name} | ${token.decimals} | ${token.bytecodePresent ? "Present" : "Missing"} |`)
    .join("\n");
  const verificationRows = Object.entries(json.blockscout)
    .map(([, item]) => `| \`${item.address}\` | ${item.label} | ${item.httpStatus ?? "n/a"} | ${item.isVerified ? "Yes" : "No"} | ${item.name || ""} |`)
    .join("\n");

  fs.writeFileSync(
    mdPath,
    `# DogeOS On-Chain Validation ${REPORT_DATE}

Read-only validation through DogeOS Chikyu RPC and Blockscout. No private key was used and no transaction was broadcast.

| Field | Value |
| --- | --- |
| Chain ID | \`${json.network.chainId}\` |
| Block | \`${json.network.block}\` |
| RPC | \`${json.rpc}\` |
| Blockscout | \`${json.blockscoutUrl}\` |

## Official Tokens

| Symbol | Address | On-chain name | Decimals | Bytecode |
| --- | --- | --- | --- | --- |
${tokenRows}

## DEX Source Status

- MuchFi V2 pairs still expose readable reserves.
- MuchFi V3 pools still expose readable token, fee, liquidity, and slot0 state.
- Barkswap Algebra pools still expose readable token, fee, liquidity, and globalState.
- The V1 router and MuchFi V2 direct-pair adapter are deployed and source verified when listed as verified below.
- MuchFi V2 direct-pair execution has allowlist and canary evidence when listed in the local deployment evidence. MuchFi V3 and Barkswap Algebra are quote-active through on-chain pool reads, but remain non-executable until verified adapters, explicit allowlisting, route preflight, and live canary evidence exist.

## Blockscout Verification

| Address | Label | HTTP | Verified | Name |
| --- | --- | --- | --- | --- |
${verificationRows}

## Deployment Decision

The V1 router and MuchFi V2 adapter can remain active for controlled testnet canary execution. Keep MuchFi V2 as the only executable source until broader monitoring and canary coverage are added. MuchFi V3 and Barkswap Algebra are quote-active only; execution additionally requires adapter implementation, allowlisting, preflight, and canary evidence.

Raw evidence: \`${path.basename(jsonPath)}\`.
`
  );

  return { jsonPath, mdPath };
}

async function main() {
  const provider = new JsonRpcProvider(RPC_URL, {
    chainId: DEFAULT_CHAIN_ID,
    name: "dogeos-chikyu-testnet"
  });
  const network = await provider.getNetwork();
  const block = await provider.getBlockNumber();
  if (Number(network.chainId) !== DEFAULT_CHAIN_ID) {
    throw new Error(`Expected DogeOS chain ID ${DEFAULT_CHAIN_ID}, got ${network.chainId.toString()}`);
  }

  const tokenEntries = await Promise.all(
    Object.entries(TOKENS).map(async ([symbol, address]) => [symbol, await readToken(provider, symbol, address)])
  );
  const contractEntries = await Promise.all(
    Object.entries(CONTRACTS).map(async ([label, address]) => [label, await codeInfo(provider, address)])
  );

  const muchFiV2Factory = new Contract(CONTRACTS.muchFiV2Factory, V2_FACTORY_ABI, provider);
  const muchFiV3Factory = new Contract(CONTRACTS.muchFiV3Factory, V3_FACTORY_ABI, provider);
  const barkswapFactory = new Contract(CONTRACTS.barkswapNewFactory, ALGEBRA_FACTORY_ABI, provider);
  const l1Oracle = new Contract(CONTRACTS.l1GasPriceOracle, L1_ORACLE_ABI, provider);

  const blockscoutTargets = [
    ["muchFiV3RouterCandidate", "MuchFi V3 router candidate", CONTRACTS.muchFiV3RouterCandidate],
    ["muchFiV3Factory", "MuchFi V3 factory", CONTRACTS.muchFiV3Factory],
    ["muchFiV2Factory", "MuchFi V2 factory", CONTRACTS.muchFiV2Factory],
    ["barkswapNewFactory", "Barkswap factory", CONTRACTS.barkswapNewFactory],
    ["barkswapNewPositionManager", "Barkswap position manager", CONTRACTS.barkswapNewPositionManager]
  ];
  const deployments = localDeployments();
  if (deployments.router) {
    blockscoutTargets.push(["dogeosSwapRouter", "DogeOSSwapRouter deployment", deployments.router.address]);
  }
  if (deployments.adapter) {
    blockscoutTargets.push(["dogeosV2PairAdapter", "DogeOSV2PairAdapter deployment", deployments.adapter.address]);
  }
  const blockscoutEntries = await Promise.all(
    blockscoutTargets.map(async ([key, label, address]) => [
      key,
      { label, address, ...(await blockscoutAddress(address)) }
    ])
  );

  const json = {
    validatedAt: new Date().toISOString(),
    rpc: RPC_URL,
    blockscoutUrl: BLOCKSCOUT_URL,
    network: {
      chainId: network.chainId.toString(),
      block
    },
    tokens: Object.fromEntries(tokenEntries),
    contracts: Object.fromEntries(contractEntries),
    l1GasPriceOracle: {
      sampleL1FeeForRouterSelector: await l1Oracle.getL1Fee("0x414bf389")
    },
    muchFiV2: {
      allPairsLength: await muchFiV2Factory.allPairsLength(),
      getPairUsdcWdoge: await muchFiV2Factory.getPair(TOKENS.USDC, TOKENS.WDOGE),
      getPairUsdtWdoge: await muchFiV2Factory.getPair(TOKENS.USDT, TOKENS.WDOGE),
      usdcWdoge: await readV2Pair(provider, CONTRACTS.muchFiV2UsdcWdoge),
      usdtWdoge: await readV2Pair(provider, CONTRACTS.muchFiV2UsdtWdoge)
    },
    muchFiV3: {
      getPoolUsdcWdoge500: await muchFiV3Factory.getPool(TOKENS.USDC, TOKENS.WDOGE, 500),
      getPoolUsdcWdoge2500: await muchFiV3Factory.getPool(TOKENS.USDC, TOKENS.WDOGE, 2500),
      getPoolUsdtWdoge500: await muchFiV3Factory.getPool(TOKENS.USDT, TOKENS.WDOGE, 500),
      usdcWdoge500: await readV3Pool(provider, CONTRACTS.muchFiV3UsdcWdoge500),
      usdcWdoge2500: await readV3Pool(provider, CONTRACTS.muchFiV3UsdcWdoge2500),
      usdtWdoge500: await readV3Pool(provider, CONTRACTS.muchFiV3UsdtWdoge500)
    },
    barkswap: {
      poolByPairUsdcWdoge: await barkswapFactory.poolByPair(TOKENS.USDC, TOKENS.WDOGE),
      poolByPairUsdtWdoge: await barkswapFactory.poolByPair(TOKENS.USDT, TOKENS.WDOGE),
      usdcWdoge: await readAlgebraPool(provider, CONTRACTS.barkswapUsdcWdogeNew),
      usdtWdoge: await readAlgebraPool(provider, CONTRACTS.barkswapUsdtWdogeNew)
    },
    blockscout: Object.fromEntries(blockscoutEntries),
    deployments,
    decision: {
      routerDeployment: deployments.router ? "deployed-and-source-verified" : "allowed-for-testnet-preflight",
      externalExecution: deployments.canary ? "muchfi-v2-active-testnet-canary" : "disabled",
      reason: deployments.canary
        ? "MuchFi V2 direct-pair execution has adapter allowlist, route preflight, and live canary evidence. MuchFi V3 and Barkswap Algebra are quote-active only."
        : "Adapter allowlist execution remains disabled until explicit approval and route preflight. Adapter deployment/source verification evidence is included when available."
    }
  };

  const { jsonPath, mdPath } = writeReport(json);
  console.log("DogeOS read-only analysis completed");
  console.log(`chainId: ${json.network.chainId}`);
  console.log(`block: ${json.network.block}`);
  console.log(`json: ${jsonPath}`);
  console.log(`markdown: ${mdPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
