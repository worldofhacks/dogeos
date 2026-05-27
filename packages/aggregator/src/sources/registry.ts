export type ProtocolType = "v2" | "v3" | "algebra" | "pancake-v3" | "unknown";
export type SourceStatus = "active" | "readOnly" | "watchlist" | "disabled";
export type RiskLevel = "low" | "medium" | "high";

export interface LiquiditySource {
  sourceId: string;
  displayName: string;
  protocolType: ProtocolType;
  status: SourceStatus;
  verified: boolean;
  riskLevel: RiskLevel;
  factory?: `0x${string}`;
  router?: `0x${string}`;
  quoter?: `0x${string}`;
  positionManager?: `0x${string}`;
  pools?: readonly `0x${string}`[];
  notes: string;
}

export const SOURCES: readonly LiquiditySource[] = [
  {
    sourceId: "owned-pancake-v3",
    displayName: "Owned Pancake V3",
    protocolType: "pancake-v3",
    status: "disabled",
    verified: false,
    riskLevel: "medium",
    notes: "No DogeOS deployment yet; GPL decision and Blockscout verification required before activation."
  },
  {
    sourceId: "muchfi-v3",
    displayName: "MuchFi V3",
    protocolType: "v3",
    status: "readOnly",
    verified: false,
    riskLevel: "medium",
    factory: "0x7d175e06570CaFA1cfDF060850b84E0Ca23EfF0B",
    router: "0x54f7D7f6FeDf4E930eFd6b4742Ba0B9E8a6dC1CB",
    positionManager: "0x7932C91f3BAD326ecd6C2bE81697D732714B9eC5",
    pools: [
      "0x4F1c638952a23DB25a13167B83810201c4BC7299",
      "0xBeD5EE59C0b913468253f3bb1021f2DeE5426ecC",
      "0x64A2683ae2995E1ca89FECA0c9ffc9056EF0504F"
    ],
    notes: "Quote/read target only; execution waits for canonical router/quoter ABI provenance."
  },
  {
    sourceId: "muchfi-v2",
    displayName: "MuchFi V2",
    protocolType: "v2",
    status: "readOnly",
    verified: false,
    riskLevel: "medium",
    factory: "0x7864071B532894216e3C045a74814EafEB92ae20",
    pools: [
      "0xD826428b6a0ead35Dcb31A75DB61be94f2ee87F4",
      "0x1498200A5D49081D8E55250aFeb13aAf3c1d9AE4"
    ],
    notes: "Reserve reads are available and the direct pair adapter is deployed and source verified; execution remains disabled until explicit allowlist approval and route preflight pass."
  },
  {
    sourceId: "barkswap-algebra",
    displayName: "Barkswap Algebra",
    protocolType: "algebra",
    status: "readOnly",
    verified: false,
    riskLevel: "medium",
    factory: "0x099F459D81ce99aD3eCE1Ca2c77d9869883d2457",
    positionManager: "0x4Bb4A5CF44028519908D6B4A90C570fEaA8c9a07",
    pools: [
      "0x9389992E65Ac233156bfd1bCB5a2CBA0A22D55B1",
      "0x5DC3eB0e452f464e134F854EAeDf9431B93Da624"
    ],
    notes: "Algebra-style read target; execution waits for canonical deployment, router, quoter, and ABI confirmation."
  },
  {
    sourceId: "suchswap",
    displayName: "SuchSwap",
    protocolType: "unknown",
    status: "watchlist",
    verified: false,
    riskLevel: "high",
    factory: "0x924163a558915Bf685eD21809A8B8b372A79Ed37",
    positionManager: "0xC0BAc1a8EbFA10E92f2b59638d314673FadD031e",
    notes: "Watchlist only until source identity and router/quoter path are confirmed."
  },
  {
    sourceId: "dogebox",
    displayName: "DogeBox",
    protocolType: "unknown",
    status: "watchlist",
    verified: false,
    riskLevel: "high",
    notes: "Watchlist only; no official WDOGE/USDC or WDOGE/USDT production route found in repo evidence."
  }
] as const;

export function getSource(sourceId: string): LiquiditySource {
  const source = SOURCES.find((candidate) => candidate.sourceId === sourceId);
  if (!source) {
    throw new Error(`UNKNOWN_SOURCE:${sourceId}`);
  }
  return source;
}

export function getQuoteSources(): LiquiditySource[] {
  return SOURCES.filter((source) => source.status === "active" || source.status === "readOnly");
}

export function getExecutableSources(): LiquiditySource[] {
  return SOURCES.filter((source) => source.status === "active" && source.verified);
}
