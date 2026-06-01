import {
  ADAPTER_ABI_PROVENANCE,
  BARKSWAP_ALGEBRA_QUOTER_ABI,
  BARKSWAP_ALGEBRA_ROUTER_ABI,
  MUCHFI_V3_QUOTER_ABI,
  MUCHFI_V3_ROUTER_ABI,
  V2_ROUTER_ABI,
  createAdapterAbiArtifact,
} from "../abi/adapterAbiArtifacts.mjs";

export const SOURCE_STATUSES = Object.freeze({
  WATCHLIST: "watchlist",
  READ_ONLY: "readOnly",
  SIMULATION_ONLY: "simulationOnly",
  ACTIVE: "active",
  DISABLED: "disabled",
});

const V2_ROUTER_SELECTORS = ["0x38ed1739", "0xd06ca61f", "0x8803dbee"];
const V2_ROUTER_FUNCTIONS = [
  "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  "getAmountsOut(uint256,address[])",
  "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
];
const MUCHFI_V3_ROUTER_SELECTORS = ["0x04e45aaf", "0x5023b4df"];
const MUCHFI_V3_ROUTER_FUNCTIONS = [
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))",
  "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))",
];
const MUCHFI_V3_QUOTER_SELECTORS = ["0xc6a5026a", "0xbd21704a", "0xcdca1753"];
const MUCHFI_V3_QUOTER_FUNCTIONS = [
  "quoteExactInputSingle((address,address,uint256,uint24,uint160))",
  "quoteExactOutputSingle((address,address,uint256,uint24,uint160))",
  "quoteExactInput(bytes,uint256)",
];
const BARKSWAP_ALGEBRA_ROUTER_SELECTORS = ["0x1679c792", "0x1764babc"];
const BARKSWAP_ALGEBRA_ROUTER_FUNCTIONS = [
  "exactInputSingle((address,address,address,address,uint256,uint256,uint256,uint160))",
  "exactOutputSingle((address,address,address,address,uint256,uint256,uint256,uint160))",
];
const BARKSWAP_ALGEBRA_QUOTER_SELECTORS = ["0xe94764c4", "0x62086e24"];
const BARKSWAP_ALGEBRA_QUOTER_FUNCTIONS = [
  "quoteExactInputSingle((address,address,address,uint256,uint160))",
  "quoteExactOutputSingle((address,address,address,uint256,uint160))",
];

function adapterAbi({ sourceId, role, address, selectors, functions, abi }) {
  return createAdapterAbiArtifact({
    sourceId,
    role,
    address,
    selectors,
    abiFunctionSignatures: functions,
    abi,
  });
}

const SOURCES = [
  {
    sourceId: "muchfi-v2",
    displayName: "MuchFi V2",
    ownership: "external",
    protocolType: "v2",
    status: SOURCE_STATUSES.ACTIVE,
    factory: "0x7864071B532894216e3C045a74814EafEB92ae20",
    router: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
    quoter: null,
    abiProvenance: ADAPTER_ABI_PROVENANCE,
    pools: [
      {
        pair: "WDOGE/USDC",
        address: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
        token0: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      },
      {
        pair: "WDOGE/USDT",
        address: "0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4",
        token0: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      },
    ],
    verificationTargets: [
      {
        role: "factory",
        address: "0x7864071B532894216e3C045a74814EafEB92ae20",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "V2-style factory with visible WDOGE/USDC and WDOGE/USDT pairs.",
      },
      {
        role: "router",
        address: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
        abiProvenance: ADAPTER_ABI_PROVENANCE,
        expectedSelectors: V2_ROUTER_SELECTORS,
        expectedAbiFunctions: V2_ROUTER_FUNCTIONS,
        abiArtifact: adapterAbi({
          sourceId: "muchfi-v2",
          role: "router",
          address: "0xC653e745FC613a03D156DACB924AE8e9148B18dc",
          selectors: V2_ROUTER_SELECTORS,
          functions: V2_ROUTER_FUNCTIONS,
          abi: V2_ROUTER_ABI,
        }),
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x7864071B532894216e3C045a74814EafEB92ae20",
          },
          {
            label: "WETH()",
            selector: "0xad5c4648",
            expectedAddress: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
          },
        ],
        notes: "V2 router returned factory() and WETH() values matching MuchFi V2 factory and WDOGE. Exact-input and exact-output swap selectors are present in bytecode.",
      },
      {
        role: "pool",
        address: "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x0902f1ac"],
        notes: "MuchFi V2 USDC/WDOGE pair with live getReserves().",
      },
      {
        role: "pool",
        address: "0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x0902f1ac"],
        notes: "MuchFi V2 USDT/WDOGE pair with live getReserves().",
      },
    ],
    supportedPairs: ["WDOGE/USDC", "WDOGE/USDT"],
    verification: {
      execution: true,
      reason: "Router selectors and relationship reads are verified on-chain; swaps execute after live simulation.",
    },
  },
  {
    sourceId: "muchfi-v3",
    displayName: "MuchFi V3",
    ownership: "external",
    protocolType: "v3",
    status: SOURCE_STATUSES.ACTIVE,
    factory: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
    router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    quoter: "0x5DE1Ea595653419f295511DEb781b98387a77cc2",
    quoterAbiProvenance: ADAPTER_ABI_PROVENANCE,
    positionManager: "0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5",
    poolDeployer: "0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348",
    abiProvenance: ADAPTER_ABI_PROVENANCE,
    pools: [
      {
        pair: "WDOGE/USDC",
        address: "0x4F1c638952a23DB25a13167B83810201c4BC7299",
        token0: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
        feeTier: 500,
      },
      {
        pair: "WDOGE/USDC",
        address: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
        token0: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
        feeTier: 2500,
      },
      {
        pair: "WDOGE/USDT",
        address: "0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F",
        token0: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
        feeTier: 500,
      },
    ],
    verificationTargets: [
      {
        role: "router",
        address: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
        abiProvenance: ADAPTER_ABI_PROVENANCE,
        expectedSelectors: MUCHFI_V3_ROUTER_SELECTORS,
        expectedAbiFunctions: MUCHFI_V3_ROUTER_FUNCTIONS,
        abiArtifact: adapterAbi({
          sourceId: "muchfi-v3",
          role: "router",
          address: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
          selectors: MUCHFI_V3_ROUTER_SELECTORS,
          functions: MUCHFI_V3_ROUTER_FUNCTIONS,
          abi: MUCHFI_V3_ROUTER_ABI,
        }),
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
          },
          {
            label: "WETH9()",
            selector: "0x4aa4a4fc",
            expectedAddress: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
          },
        ],
        notes: "V3 router with exactInputSingle, exactOutputSingle, factory(), and WETH9() selectors observed on-chain.",
      },
      {
        role: "quoter",
        address: "0x5DE1Ea595653419f295511DEb781b98387a77cc2",
        abiProvenance: ADAPTER_ABI_PROVENANCE,
        expectedSelectors: MUCHFI_V3_QUOTER_SELECTORS,
        expectedAbiFunctions: MUCHFI_V3_QUOTER_FUNCTIONS,
        abiArtifact: adapterAbi({
          sourceId: "muchfi-v3",
          role: "quoter",
          address: "0x5DE1Ea595653419f295511DEb781b98387a77cc2",
          selectors: MUCHFI_V3_QUOTER_SELECTORS,
          functions: MUCHFI_V3_QUOTER_FUNCTIONS,
          abi: MUCHFI_V3_QUOTER_ABI,
        }),
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
          },
          {
            label: "WETH9()",
            selector: "0x4aa4a4fc",
            expectedAddress: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
          },
        ],
        notes: "V3 QuoterV2-style contract. Exact-input and exact-output tuple quote selectors work; factory() and WETH9() match MuchFi V3 and WDOGE.",
      },
      {
        role: "factory",
        address: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
        abiProvenance: "none",
        expectedSelectors: [],
        expectedReadChecks: [
          {
            label: "poolDeployer()",
            selector: "0x3119049a",
            expectedAddress: "0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348",
          },
        ],
        notes: "V3 factory returned by MuchFi position manager.",
      },
      {
        role: "poolDeployer",
        address: "0x6c04e808d5FfFb597cb6a5b539f2a1dDF3529348",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "MuchFi V3 pool deployer returned by factory.",
      },
      {
        role: "positionManager",
        address: "0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "MuchFi V3 positions NFT discovered on-chain.",
      },
      {
        role: "pool",
        address: "0x4F1c638952a23DB25a13167B83810201c4BC7299",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x3850c7bd", "0x1a686502"],
        notes: "MuchFi V3 USDC/WDOGE 500-fee pool with live slot0() and liquidity().",
      },
      {
        role: "pool",
        address: "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x3850c7bd", "0x1a686502"],
        notes: "MuchFi V3 USDC/WDOGE 2500-fee pool with live slot0() and liquidity().",
      },
      {
        role: "pool",
        address: "0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0x3850c7bd", "0x1a686502"],
        notes: "MuchFi V3 USDT/WDOGE 500-fee pool with live slot0() and liquidity().",
      },
    ],
    supportedPairs: ["WDOGE/USDC", "WDOGE/USDT"],
    verification: {
      execution: true,
      reason: "Router selectors and relationship reads are verified on-chain; swaps execute after live simulation.",
    },
  },
  {
    sourceId: "barkswap-algebra",
    displayName: "Barkswap",
    ownership: "external",
    protocolType: "algebra",
    status: SOURCE_STATUSES.ACTIVE,
    factory: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
    router: "0x77147f436cE9739D2A54Ffe428DBe02b90c0205e",
    quoter: "0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D",
    quoterAbiProvenance: ADAPTER_ABI_PROVENANCE,
    quoterPoolDeployer: "0x0000000000000000000000000000000000000000",
    poolDeployer: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
    positionManager: "0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07",
    abiProvenance: ADAPTER_ABI_PROVENANCE,
    pools: [
      {
        pair: "WDOGE/USDC",
        address: "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
        token0: "0xD19d2Ffb1c284668b7AFe72cddae1BAF3Bc03925",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      },
      {
        pair: "WDOGE/USDT",
        address: "0x5DC3eB0e452f464e134F854EAeDf9431B93Da624",
        token0: "0xC81800b77D91391Ef03d7868cB81204E753093a9",
        token1: "0xF6BDB158A5ddF77F1B83bC9074F6a472c58D78aE",
      },
    ],
    verificationTargets: [
      {
        role: "factory",
        address: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
        abiProvenance: "none",
        expectedSelectors: [],
        expectedReadChecks: [
          {
            label: "poolDeployer()",
            selector: "0x3119049a",
            expectedAddress: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
          },
        ],
        notes: "Newer Barkswap-style factory candidate with official-token pools.",
      },
      {
        role: "poolDeployer",
        address: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "Newer Barkswap pool deployer tied to factory() and poolDeployer() reads.",
      },
      {
        role: "factory",
        address: "0x88f7307dD42E603c2B4DDD1BFcc5cBe55A5Ed263",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "Older Barkswap-style factory candidate with official-token pools.",
      },
      {
        role: "router",
        address: "0x77147f436cE9739D2A54Ffe428DBe02b90c0205e",
        abiProvenance: ADAPTER_ABI_PROVENANCE,
        expectedSelectors: BARKSWAP_ALGEBRA_ROUTER_SELECTORS,
        expectedAbiFunctions: BARKSWAP_ALGEBRA_ROUTER_FUNCTIONS,
        abiArtifact: adapterAbi({
          sourceId: "barkswap-algebra",
          role: "router",
          address: "0x77147f436cE9739D2A54Ffe428DBe02b90c0205e",
          selectors: BARKSWAP_ALGEBRA_ROUTER_SELECTORS,
          functions: BARKSWAP_ALGEBRA_ROUTER_FUNCTIONS,
          abi: BARKSWAP_ALGEBRA_ROUTER_ABI,
        }),
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
          },
          {
            label: "poolDeployer()",
            selector: "0x3119049a",
            expectedAddress: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
          },
        ],
        notes: "Algebra SwapRouter-style contract with exactInputSingle, exactOutputSingle, and factory()/poolDeployer() reads.",
      },
      {
        role: "quoter",
        address: "0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D",
        abiProvenance: ADAPTER_ABI_PROVENANCE,
        expectedSelectors: BARKSWAP_ALGEBRA_QUOTER_SELECTORS,
        expectedAbiFunctions: BARKSWAP_ALGEBRA_QUOTER_FUNCTIONS,
        abiArtifact: adapterAbi({
          sourceId: "barkswap-algebra",
          role: "quoter",
          address: "0xcEF56157baaB2Fe9D16ccF0eB4a9Df354380257D",
          selectors: BARKSWAP_ALGEBRA_QUOTER_SELECTORS,
          functions: BARKSWAP_ALGEBRA_QUOTER_FUNCTIONS,
          abi: BARKSWAP_ALGEBRA_QUOTER_ABI,
        }),
        expectedReadChecks: [
          {
            label: "factory()",
            selector: "0xc45a0155",
            expectedAddress: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
          },
          {
            label: "poolDeployer()",
            selector: "0x3119049a",
            expectedAddress: "0xeb4E9b84990C7c07D5205D35647A29de1B33dE7e",
          },
        ],
        notes: "Algebra QuoterV2-style contract. Exact-input and exact-output tuple quote selectors work with the zero deployer sentinel.",
      },
      {
        role: "positionManager",
        address: "0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "Newer Barkswap positions NFT discovered on-chain.",
      },
      {
        role: "pool",
        address: "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0xe76c01e4", "0x1a686502"],
        notes: "Newer Barkswap USDC/WDOGE Algebra pool with live globalState() and liquidity().",
      },
      {
        role: "pool",
        address: "0x5DC3eB0e452f464e134F854EAeDf9431B93Da624",
        abiProvenance: "onchain-bytecode",
        expectedSelectors: ["0xe76c01e4", "0x1a686502"],
        notes: "Newer Barkswap USDT/WDOGE Algebra pool with live globalState() and liquidity().",
      },
    ],
    supportedPairs: ["WDOGE/USDC", "WDOGE/USDT"],
    verification: {
      execution: true,
      reason: "Router selectors and relationship reads are verified on-chain; swaps execute after live simulation.",
    },
  },
  {
    sourceId: "suchswap",
    displayName: "SuchSwap",
    ownership: "external",
    protocolType: "v3",
    status: SOURCE_STATUSES.WATCHLIST,
    factory: "0x924163a558915Bf685eD21809A8B8b372A79Ed37",
    router: null,
    quoter: null,
    positionManager: "0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e",
    abiProvenance: "none",
    pools: [],
    verificationTargets: [
      {
        role: "factory",
        address: "0x924163a558915Bf685eD21809A8B8b372A79Ed37",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "SuchSwap factory candidate returned by position manager.",
      },
      {
        role: "positionManager",
        address: "0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e",
        abiProvenance: "none",
        expectedSelectors: [],
        notes: "SuchSwap positions NFT candidate.",
      },
    ],
    supportedPairs: [],
    verification: {
      execution: false,
      reason: "Venue identity and periphery are not confirmed.",
    },
  },
  {
    sourceId: "dogebox",
    displayName: "DogeBox",
    ownership: "external",
    protocolType: "v2",
    status: SOURCE_STATUSES.WATCHLIST,
    factory: null,
    router: null,
    quoter: null,
    abiProvenance: "none",
    pools: [],
    verificationTargets: [],
    supportedPairs: [],
    verification: {
      execution: false,
      reason: "No confirmed official-token route source.",
    },
  },
];

export function listSources() {
  return SOURCES.map((source) => structuredClone(source));
}

export function getSource(sourceId) {
  const source = SOURCES.find((entry) => entry.sourceId === sourceId);
  if (!source) {
    throw new Error(`Unknown DogeOS source: ${sourceId}`);
  }
  return structuredClone(source);
}

export function getExecutableSources() {
  return listSources().filter((source) => source.status === SOURCE_STATUSES.ACTIVE);
}

export function listVenueContracts() {
  return SOURCES.map((source) => ({
    sourceId: source.sourceId,
    displayName: source.displayName,
    ownership: source.ownership,
    protocolType: source.protocolType,
    status: source.status,
    supportedPairs: structuredClone(source.supportedPairs),
    pools: structuredClone(source.pools),
    execution: {
      enabled: source.status === SOURCE_STATUSES.ACTIVE && source.verification.execution === true,
      reason: source.verification.reason,
    },
    contracts: source.verificationTargets.map((target) => ({
      role: target.role,
      address: target.address,
      abiProvenance: target.abiProvenance,
      expectedSelectors: structuredClone(target.expectedSelectors ?? []),
      expectedAbiFunctions: structuredClone(target.expectedAbiFunctions ?? []),
      expectedReadChecks: structuredClone(target.expectedReadChecks ?? []),
      abiArtifact: structuredClone(target.abiArtifact ?? null),
      notes: target.notes,
    })),
  })).map((venue) => structuredClone(venue));
}

export function listVerificationTargets() {
  return SOURCES.flatMap((source) =>
    source.verificationTargets.map((target) => {
      const pool = target.role === "pool"
        ? (source.pools ?? []).find(
            (candidate) => candidate.address.toLowerCase() === target.address.toLowerCase(),
          )
        : null;

      return {
        sourceId: source.sourceId,
        protocolType: source.protocolType,
        displayName: source.displayName,
        ...target,
        ...(pool
          ? {
              expectedPool: {
                pair: pool.pair,
                token0: pool.token0,
                token1: pool.token1,
                ...(pool.feeTier !== undefined ? { feeTier: pool.feeTier } : {}),
              },
            }
          : {}),
      };
    }),
  ).map((target) => structuredClone(target));
}
