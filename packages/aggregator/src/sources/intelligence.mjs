import {
  SOURCE_STATUSES,
  listSources,
  listVenueContracts,
} from "./registry.mjs";

const REJECTED_SURFACES = Object.freeze([
  {
    surfaceId: "mock-univ2-contracts",
    displayName: "Mock UniV2 Contracts",
    status: "rejected",
    category: "mock-contracts",
    reason: "Verified mock Uniswap-style contracts are test scaffolding, not production spot liquidity.",
    evidence: [
      "Blockscout source paths reference contracts/mock/*.",
      "No official-token executable venue relationship is tied to these contracts.",
    ],
    execution: {
      enabled: false,
      reason: "Mock contracts are excluded from aggregator routing.",
    },
  },
  {
    surfaceId: "derps-perps",
    displayName: "Derps",
    status: "rejected",
    category: "non-spot",
    reason: "Derps is a perpetual trading surface, not same-chain spot swap liquidity.",
    evidence: [
      "Public venue copy describes a DOGE perpetual DEX.",
      "Observed contract surface is open/close/liquidation oriented rather than AMM swap routing.",
    ],
    execution: {
      enabled: false,
      reason: "Perpetual contracts are outside spot aggregator execution.",
    },
  },
  {
    surfaceId: "dogenadocash-privacy-pools",
    displayName: "DogenadoCash",
    status: "rejected",
    category: "privacy-pool",
    reason: "Privacy pool contracts do not provide spot-token swap routes.",
    evidence: [
      "Contract naming and flow match deposit/withdraw privacy pools.",
      "No router, quoter, factory, or official-token AMM pool relationship is present.",
    ],
    execution: {
      enabled: false,
      reason: "Privacy pools are not DEX liquidity venues.",
    },
  },
  {
    surfaceId: "chainlink-ccip-routers",
    displayName: "Chainlink CCIP Routers",
    status: "rejected",
    category: "bridge-messaging",
    reason: "CCIP routers support cross-chain messaging, not same-chain spot swaps.",
    evidence: [
      "Router surface is bridge/messaging oriented.",
      "No DogeOS official-token pool state or same-chain quote surface is present.",
    ],
    execution: {
      enabled: false,
      reason: "Bridge routers are excluded from same-chain DEX routing.",
    },
  },
  {
    surfaceId: "tulpea-backstop-lending",
    displayName: "Tulpea / Backstop",
    status: "rejected",
    category: "lending-vault",
    reason: "Lending, vault, and backstop contracts are not spot AMM execution surfaces.",
    evidence: [
      "Contract naming and ABI surface are vault/accounting oriented.",
      "No executable spot router, quoter, factory, or official-token pool path is confirmed.",
    ],
    execution: {
      enabled: false,
      reason: "Lending and vault surfaces are outside spot routing.",
    },
  },
  {
    surfaceId: "barkswap-token-name-hits",
    displayName: "Barkswap Token/NFT Name Hits",
    status: "rejected",
    category: "token-only",
    reason: "Blockscout search returns many BARK/SWAP token and NFT names that are not routers.",
    evidence: [
      "Search hits include ERC-20 and ERC-721 token contracts.",
      "Only the pinned Barkswap Algebra factory/router/quoter/pools are used for execution.",
    ],
    execution: {
      enabled: false,
      reason: "Token and NFT contracts are not swap execution surfaces.",
    },
  },
]);

function uniqueSorted(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))]
    .sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }));
}

function venueBySourceId(venues = []) {
  return new Map(venues.map((venue) => [venue.sourceId, venue]));
}

function contractAbiProvenance(contracts = []) {
  return uniqueSorted(
    contracts.map(
      (contract) =>
        contract.abiProvenance ??
        contract.executionEvidence?.abiProof?.provenance ??
        "none",
    ),
  );
}

function contractHasBlockscoutAbi(contract = {}) {
  return (
    contract.verification?.isBlockscoutAbiAvailable === true ||
    contract.executionEvidence?.abiProof?.blockscoutAbiAvailable === true ||
    contract.blockscoutContract?.hasAbi === true
  );
}

function contractHasAdapterArtifact(contract = {}) {
  return (
    contract.verification?.hasAdapterAbiArtifact === true ||
    contract.executionEvidence?.abiProof?.adapterAbiArtifactVerified === true ||
    contract.abiArtifact?.verified === true
  );
}

function contractHasVenueArtifact(contract = {}) {
  return (
    contract.verification?.hasVenueAbiArtifact === true ||
    contract.executionEvidence?.abiProof?.venueAbiArtifactVerified === true
  );
}

function liquiditySummary(source = {}, contracts = []) {
  const poolContracts = contracts.filter((contract) => contract.role === "pool");
  const livePoolContracts = poolContracts.filter(
    (contract) => contract.executionEvidence?.onchainProof?.poolHasLiveLiquidity === true,
  );
  const pairs = uniqueSorted([
    ...(source.pools ?? []).map((pool) => pool.pair),
    ...poolContracts.map((contract) => contract.executionEvidence?.onchainProof?.poolPair),
  ]);
  const feeTiers = uniqueSorted([
    ...(source.pools ?? []).map((pool) => pool.feeTier),
    ...poolContracts.map((contract) => contract.executionEvidence?.onchainProof?.poolFeeTier),
  ]).map((feeTier) => Number(feeTier));

  return {
    totalPoolCount: poolContracts.length || (source.pools ?? []).length,
    livePoolCount: livePoolContracts.length,
    pairs,
    feeTiers,
  };
}

function summarizeSource(source, venue) {
  const contracts = venue?.contracts ?? [];
  const routerContracts = contracts.filter((contract) => contract.role === "router");
  const quoterContracts = contracts.filter((contract) => contract.role === "quoter");
  const executableRouters = routerContracts.filter(
    (contract) => contract.executionEvidence?.executable === true,
  ).length;
  const executionEnabled =
    venue?.execution?.enabled === true ||
    (source.status === SOURCE_STATUSES.ACTIVE && source.verification?.execution === true);

  return {
    sourceId: source.sourceId,
    displayName: source.displayName,
    status: source.status,
    protocolType: source.protocolType,
    supportedPairs: [...(source.supportedPairs ?? [])],
    execution: {
      enabled: executionEnabled,
      reason: venue?.execution?.reason ?? source.verification?.reason ?? null,
    },
    contracts: {
      total: contracts.length,
      routers: routerContracts.length,
      quoters: quoterContracts.length,
      pools: contracts.filter((contract) => contract.role === "pool").length,
      executableRouters,
      readOnlyContracts: contracts.filter(
        (contract) => contract.executionEvidence?.executable !== true,
      ).length,
    },
    liquidity: liquiditySummary(source, contracts),
    abi: {
      provenance: contractAbiProvenance(contracts),
      blockscoutAbiAvailable: contracts.some(contractHasBlockscoutAbi),
      adapterAbiArtifactVerified: contracts.some(contractHasAdapterArtifact),
      venueAbiArtifactVerified: contracts.some(contractHasVenueArtifact),
    },
  };
}

function classifySource(summary) {
  if (summary.execution.enabled) return "activeExecutable";
  if (summary.status === SOURCE_STATUSES.WATCHLIST) return "watchlistCandidates";
  if (
    summary.status === SOURCE_STATUSES.READ_ONLY ||
    summary.status === SOURCE_STATUSES.SIMULATION_ONLY ||
    summary.contracts.quoters > 0
  ) {
    return "readOnlyQuote";
  }
  return "watchlistCandidates";
}

export function listRejectedSurfaces() {
  return structuredClone(REJECTED_SURFACES);
}

export function buildVenueIntelligence({
  sources = listSources(),
  venues = listVenueContracts(),
  rejectedSurfaces = listRejectedSurfaces(),
} = {}) {
  const venuesBySourceId = venueBySourceId(venues);
  const classified = {
    activeExecutable: [],
    readOnlyQuote: [],
    watchlistCandidates: [],
  };

  for (const source of sources) {
    const summary = summarizeSource(source, venuesBySourceId.get(source.sourceId));
    classified[classifySource(summary)].push(summary);
  }

  for (const value of Object.values(classified)) {
    value.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  return {
    summary: {
      activeExecutable: classified.activeExecutable.length,
      readOnlyQuote: classified.readOnlyQuote.length,
      watchlist: classified.watchlistCandidates.length,
      rejected: rejectedSurfaces.length,
    },
    ...classified,
    rejectedSurfaces: structuredClone(rejectedSurfaces),
  };
}
