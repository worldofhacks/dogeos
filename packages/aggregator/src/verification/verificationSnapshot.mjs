import { DOGEOS_CHAIN } from "../../../config/src/chains.mjs";
import { OFFICIAL_DOGEOS_TOKENS } from "../../../config/src/tokens.mjs";
import { listVerificationTargets } from "../sources/registry.mjs";
import { deriveExecutableStatus, hasSelector } from "./verifySource.mjs";

export const DOGEOS_RPC_URL = DOGEOS_CHAIN.rpcUrls[0];
export const BLOCKSCOUT_BASE_URL = DOGEOS_CHAIN.blockscoutBaseUrl;
export const DOGEOS_CHAIN_ID_HEX = DOGEOS_CHAIN.idHex;
export const TOKEN_DECIMALS_SELECTOR = "0x313ce567";

export function defaultVerificationTargets() {
  return listVerificationTargets();
}

export function buildBlockscoutAddressUrl(address, blockscoutBaseUrl = BLOCKSCOUT_BASE_URL) {
  return `${blockscoutBaseUrl}/api/v2/addresses/${address}`;
}

export function buildBlockscoutSmartContractUrl(address, blockscoutBaseUrl = BLOCKSCOUT_BASE_URL) {
  return `${blockscoutBaseUrl}/api/v2/smart-contracts/${address}`;
}

export function buildBlockscoutAbiUrl(address, blockscoutBaseUrl = BLOCKSCOUT_BASE_URL) {
  const params = new URLSearchParams({
    module: "contract",
    action: "getabi",
    address,
  });
  return `${blockscoutBaseUrl}/api?${params.toString()}`;
}

export function selectorPresent(bytecode, selector) {
  return hasSelector(bytecode, selector);
}

function normalizeAddress(address, fieldName) {
  const normalized = String(address ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

export function decodeAddressResult(result, fieldName = "eth_call result") {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be an ABI-encoded address.`);
  }
  return `0x${normalized.slice(26)}`;
}

function decodeSafeIntegerResult(result, fieldName) {
  const normalized = String(result ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${fieldName} must be an ABI-encoded uint256.`);
  }

  const value = BigInt(normalized);
  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber)) {
    throw new Error(`${fieldName} exceeds JavaScript safe integer range.`);
  }
  return asNumber;
}

export function summarizeReadCheck(check, rawResult) {
  const expectedAddress = normalizeAddress(check.expectedAddress, `${check.label} expectedAddress`);
  const actualAddress = decodeAddressResult(rawResult, `${check.label} result`);

  return {
    label: check.label,
    selector: check.selector,
    expectedAddress,
    actualAddress,
    rawResult,
    matches: actualAddress === expectedAddress,
  };
}

export function summarizeTokenDecimalCheck(token, rawResult, options = {}) {
  const actualDecimals = decodeSafeIntegerResult(rawResult, `${token.symbol} decimals result`);
  const hasBytecode = options.hasBytecode ?? true;

  return {
    symbol: token.symbol,
    address: token.address,
    selector: TOKEN_DECIMALS_SELECTOR,
    expectedDecimals: token.decimals,
    actualDecimals,
    rawResult,
    hasBytecode,
    matches: hasBytecode && actualDecimals === token.decimals,
  };
}

function parseAbiPayload(abi) {
  if (Array.isArray(abi)) return abi;
  if (typeof abi !== "string" || abi.trim() === "") return null;

  try {
    const parsed = JSON.parse(abi);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function canonicalAbiType(input = {}) {
  const type = input.type ?? "";
  if (!type.startsWith("tuple")) return type;

  const tupleSuffix = type.slice("tuple".length);
  const components = Array.isArray(input.components) ? input.components : [];
  return `(${components.map((component) => canonicalAbiType(component)).join(",")})${tupleSuffix}`;
}

function abiFunctionSignatures(abi = []) {
  if (!Array.isArray(abi)) return [];

  return abi
    .filter((entry) => entry?.type === "function" && typeof entry.name === "string")
    .map((entry) => {
      const inputs = Array.isArray(entry.inputs) ? entry.inputs : [];
      return `${entry.name}(${inputs.map((input) => canonicalAbiType(input)).join(",")})`;
    });
}

export function summarizeBlockscoutContract(blockscoutContract = {}) {
  const abi = parseAbiPayload(blockscoutContract.abi);

  return {
    status: blockscoutContract.status ?? null,
    name: blockscoutContract.name ?? blockscoutContract.contract_name ?? null,
    compilerVersion: blockscoutContract.compiler_version ?? blockscoutContract.compilerVersion ?? null,
    language: blockscoutContract.language ?? null,
    licenseType: blockscoutContract.license_type ?? blockscoutContract.licenseType ?? null,
    optimizationEnabled:
      blockscoutContract.optimization_enabled ?? blockscoutContract.optimizationEnabled ?? null,
    proxyType: blockscoutContract.proxy_type ?? blockscoutContract.proxyType ?? null,
    implementationCount: Array.isArray(blockscoutContract.implementations)
      ? blockscoutContract.implementations.length
      : 0,
    hasAbi: Boolean(blockscoutContract.hasAbi ?? blockscoutContract.has_abi ?? abi?.length),
    abiFunctionSignatures: abiFunctionSignatures(abi),
  };
}

export function summarizeBlockscoutAbi(blockscoutAbi = {}) {
  const abi = parseAbiPayload(blockscoutAbi.result ?? blockscoutAbi.abi);

  return {
    status: blockscoutAbi.status ?? null,
    message: blockscoutAbi.message ?? null,
    hasAbi: blockscoutAbi.status === "1" && Boolean(abi?.length),
    abiFunctionSignatures: abiFunctionSignatures(abi),
  };
}

function mergeBlockscoutContractSummary(blockscoutContract, blockscoutAbi) {
  const abiFunctionSignatures = [
    ...new Set([
      ...(blockscoutContract?.abiFunctionSignatures ?? []),
      ...(blockscoutAbi?.abiFunctionSignatures ?? []),
    ]),
  ];

  return {
    ...blockscoutContract,
    hasAbi: blockscoutContract?.hasAbi === true || blockscoutAbi?.hasAbi === true,
    abiFunctionSignatures,
  };
}

function normalizeSelectorList(values = []) {
  return values.filter((value) => /^0x[0-9a-fA-F]{8}$/.test(value ?? "")).map((value) => value.toLowerCase());
}

function normalizeSignatureList(values = []) {
  return values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
}

export function summarizeAbiArtifact(source, { expectedChainId = DOGEOS_CHAIN.id } = {}) {
  const artifact = source.abiArtifact;
  if (!artifact) return null;

  const selectors = normalizeSelectorList(artifact.selectorMatches ?? artifact.selectors ?? []);
  const expectedSelectors = normalizeSelectorList(source.expectedSelectors ?? []);
  const selectorMatches = expectedSelectors.filter((selector) => selectors.includes(selector));
  const missingSelectors = expectedSelectors.filter((selector) => !selectors.includes(selector));
  const abiFunctionSignatures = abiFunctionSignaturesFromArtifact(artifact);
  const expectedAbiFunctions = normalizeSignatureList(source.expectedAbiFunctions ?? []);
  const abiFunctionMatches = expectedAbiFunctions.filter((signature) =>
    abiFunctionSignatures.includes(signature),
  );
  const missingAbiFunctions = expectedAbiFunctions.filter(
    (signature) => !abiFunctionSignatures.includes(signature),
  );
  let target = null;
  let matchesTarget = false;
  let error = null;

  try {
    const targetAddress = normalizeAddress(artifact.target?.address, "ABI artifact target address");
    target = {
      sourceId: artifact.target?.sourceId ?? null,
      chainId: Number(artifact.target?.chainId),
      role: artifact.target?.role ?? null,
      address: targetAddress,
    };
    matchesTarget =
      target.sourceId === source.sourceId &&
      target.chainId === Number(expectedChainId) &&
      target.role === source.role &&
      targetAddress === normalizeAddress(source.address, "verification target address");
  } catch (caught) {
    error = caught.message;
  }

  const artifactHash = String(artifact.artifactHash ?? "").toLowerCase();
  const hasArtifactHash = /^0x[0-9a-f]{64}$/.test(artifactHash);
  const hasRequiredMetadata = Boolean(artifact.issuer && artifact.sourceUri && hasArtifactHash);
  const status = artifact.status ?? (artifact.verified === true ? "verified" : "missing");

  return {
    kind: artifact.kind ?? null,
    status,
    issuer: artifact.issuer ?? null,
    sourceUri: artifact.sourceUri ?? null,
    artifactHash: hasArtifactHash ? artifactHash : null,
    signedAt: artifact.signedAt ?? null,
    checkedAt: artifact.checkedAt ?? null,
    target,
    matchesTarget,
    selectorMatches,
    missingSelectors,
    abiFunctionMatches,
    missingAbiFunctions,
    verified:
      status === "verified" &&
      hasRequiredMetadata &&
      matchesTarget &&
      missingSelectors.length === 0 &&
      missingAbiFunctions.length === 0,
    error,
  };
}

function abiFunctionSignaturesFromArtifact(artifact = {}) {
  return normalizeSignatureList(artifact.abiFunctionMatches ?? artifact.abiFunctionSignatures ?? []);
}

export function classifyVerification({
  role,
  bytecode,
  blockscout,
  blockscoutContract,
  expectedSelectors = [],
  expectedAbiFunctions = [],
  abiProvenance = "none",
  abiArtifact = null,
  readChecks = [],
}) {
  const status = deriveExecutableStatus({
    role,
    bytecode,
    blockscout,
    blockscoutContract,
    expectedSelectors,
    expectedAbiFunctions,
    abiProvenance,
    abiArtifact,
    readChecks,
  });

  return {
    ...status,
    isBlockscoutContract: Boolean(blockscout?.is_contract ?? blockscout?.isContract),
    isBlockscoutVerified: Boolean(blockscout?.is_verified ?? blockscout?.isVerified),
    isBlockscoutAbiAvailable: Boolean(blockscoutContract?.hasAbi ?? blockscoutContract?.has_abi),
    isVenueAbiArtifactAvailable: abiProvenance === "venue-artifact" && abiArtifact?.verified === true,
    isAdapterAbiArtifactAvailable:
      abiProvenance === "adapter-fragment" && abiArtifact?.verified === true,
  };
}

export function buildExecutionEvidence({
  source = {},
  blockscoutUrl = null,
  blockscoutSmartContractUrl = null,
  blockscoutAbiEndpointUrl = null,
  blockscoutContract = {},
  blockscoutAbi = null,
  abiArtifact = null,
  readChecks = [],
  bytecodeSizeBytes = 0,
  verification = {},
}) {
  const passedReadChecks = readChecks.filter((check) => check.matches === true);

  return {
    status: verification.status ?? "unknown",
    executable: verification.status === "active",
    reason: verification.reason ?? null,
    abiProof: {
      provenance: source.abiProvenance ?? "none",
      blockscoutAbiAvailable: verification.isBlockscoutAbiAvailable === true,
      adapterAbiArtifactVerified:
        verification.hasAdapterAbiArtifact === true ||
        verification.isAdapterAbiArtifactAvailable === true,
      venueAbiArtifactVerified:
        verification.hasVenueAbiArtifact === true ||
        verification.isVenueAbiArtifactAvailable === true,
      artifactKind: abiArtifact?.kind ?? null,
      artifactHash: abiArtifact?.artifactHash ?? null,
      artifactSourceUri: abiArtifact?.sourceUri ?? null,
      missingSelectors: structuredClone(abiArtifact?.missingSelectors ?? []),
      missingAbiFunctions: structuredClone(abiArtifact?.missingAbiFunctions ?? []),
      ...(blockscoutAbi
        ? {
            blockscoutAbiStatus: blockscoutAbi.status ?? null,
            blockscoutAbiMessage: blockscoutAbi.message ?? null,
          }
        : {}),
    },
    onchainProof: {
      bytecodePresent: verification.hasBytecode === true,
      bytecodeSizeBytes,
      selectorMatches: structuredClone(verification.selectorMatches ?? []),
      readChecksPassed: passedReadChecks.length,
      readChecksTotal: readChecks.length,
      readCheckLabels: passedReadChecks.map((check) => check.label),
    },
    blockscout: {
      addressUrl: blockscoutUrl,
      smartContractUrl: blockscoutSmartContractUrl,
      ...(blockscoutAbiEndpointUrl ? { abiEndpointUrl: blockscoutAbiEndpointUrl } : {}),
      contractListed: verification.isBlockscoutContract === true,
      sourceVerified: verification.isBlockscoutVerified === true,
      abiAvailable: verification.isBlockscoutAbiAvailable === true,
      contractName: blockscoutContract.name ?? null,
    },
  };
}

async function fetchJson(fetchFn, url, options) {
  const response = await fetchFn(url, options);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchOptionalJson(fetchFn, url, options) {
  const response = await fetchFn(url, options);
  if (!response.ok) return null;
  return response.json();
}

async function rpc({ method, params, rpcUrl, fetchFn }) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  const response = await fetchJson(fetchFn, rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (response.error) {
    throw new Error(`${method} failed: ${response.error.message ?? JSON.stringify(response.error)}`);
  }

  return response.result;
}

async function verifyReadCheck({ source, check, rpcUrl, fetchFn }) {
  try {
    const rawResult = await rpc({
      method: "eth_call",
      params: [
        {
          to: source.address,
          data: check.selector,
        },
        "latest",
      ],
      rpcUrl,
      fetchFn,
    });
    return summarizeReadCheck(check, rawResult);
  } catch (error) {
    return {
      label: check.label,
      selector: check.selector,
      expectedAddress: normalizeAddress(check.expectedAddress, `${check.label} expectedAddress`),
      actualAddress: null,
      rawResult: null,
      matches: false,
      error: error.message,
    };
  }
}

async function verifyTokenDecimal({ token, rpcUrl, fetchFn }) {
  let hasBytecode = false;

  try {
    const bytecode = await rpc({
      method: "eth_getCode",
      params: [token.address, "latest"],
      rpcUrl,
      fetchFn,
    });
    hasBytecode = /^0x[0-9a-fA-F]+$/.test(bytecode ?? "") && bytecode !== "0x";
    if (!hasBytecode) {
      return {
        symbol: token.symbol,
        address: token.address,
        selector: TOKEN_DECIMALS_SELECTOR,
        expectedDecimals: token.decimals,
        actualDecimals: null,
        rawResult: null,
        hasBytecode: false,
        matches: false,
        error: "No bytecode found at token address.",
      };
    }

    const rawResult = await rpc({
      method: "eth_call",
      params: [
        {
          to: token.address,
          data: TOKEN_DECIMALS_SELECTOR,
        },
        "latest",
      ],
      rpcUrl,
      fetchFn,
    });
    return summarizeTokenDecimalCheck(token, rawResult, { hasBytecode });
  } catch (error) {
    return {
      symbol: token.symbol,
      address: token.address,
      selector: TOKEN_DECIMALS_SELECTOR,
      expectedDecimals: token.decimals,
      actualDecimals: null,
      rawResult: null,
      hasBytecode,
      matches: false,
      error: error.message,
    };
  }
}

async function verifyOfficialTokens({ tokens, rpcUrl, fetchFn }) {
  return Promise.all(tokens.map((token) => verifyTokenDecimal({ token, rpcUrl, fetchFn })));
}

export async function verifySource(source, options = {}) {
  const rpcUrl = options.rpcUrl ?? DOGEOS_RPC_URL;
  const fetchFn = options.fetchFn ?? fetch;
  const blockscoutBaseUrl = options.blockscoutBaseUrl ?? BLOCKSCOUT_BASE_URL;
  const blockscoutUrl = buildBlockscoutAddressUrl(source.address, blockscoutBaseUrl);
  const blockscoutSmartContractUrl = buildBlockscoutSmartContractUrl(source.address, blockscoutBaseUrl);
  const blockscoutAbiEndpointUrl = buildBlockscoutAbiUrl(source.address, blockscoutBaseUrl);

  const [bytecode, blockscout, blockscoutContractBody, blockscoutAbiBody] = await Promise.all([
    rpc({
      method: "eth_getCode",
      params: [source.address, "latest"],
      rpcUrl,
      fetchFn,
    }),
    fetchJson(fetchFn, blockscoutUrl),
    fetchOptionalJson(fetchFn, blockscoutSmartContractUrl),
    fetchOptionalJson(fetchFn, blockscoutAbiEndpointUrl),
  ]);
  const readChecks = await Promise.all(
    (source.expectedReadChecks ?? []).map((check) => verifyReadCheck({ source, check, rpcUrl, fetchFn })),
  );
  const blockscoutAbi = summarizeBlockscoutAbi(blockscoutAbiBody ?? {});
  const blockscoutContract = mergeBlockscoutContractSummary(
    summarizeBlockscoutContract(blockscoutContractBody ?? {}),
    blockscoutAbi,
  );
  const abiArtifact = summarizeAbiArtifact(source);

  const verification = classifyVerification({
    role: source.role,
    bytecode,
    blockscout,
    blockscoutContract,
    expectedSelectors: source.expectedSelectors,
    expectedAbiFunctions: source.expectedAbiFunctions,
    abiProvenance: source.abiProvenance,
    abiArtifact,
    readChecks,
  });

  return {
    ...source,
    blockscoutUrl,
    blockscoutSmartContractUrl,
    blockscoutAbiEndpointUrl,
    blockscoutContract,
    blockscoutAbi,
    abiArtifact,
    readChecks,
    bytecodeSizeBytes: Math.max(0, (bytecode.length - 2) / 2),
    verification,
    executionEvidence: buildExecutionEvidence({
      source,
      blockscoutUrl,
      blockscoutSmartContractUrl,
      blockscoutAbiEndpointUrl,
      blockscoutContract,
      blockscoutAbi,
      abiArtifact,
      readChecks,
      bytecodeSizeBytes: Math.max(0, (bytecode.length - 2) / 2),
      verification,
    }),
  };
}

export function summarizeVerificationReport(report) {
  const relationshipMismatches = (report.sources ?? []).flatMap((source) =>
    (source.readChecks ?? [])
      .filter((check) => check.matches !== true)
      .map((check) => ({
        sourceId: source.sourceId,
        role: source.role,
        address: source.address,
        label: check.label,
        selector: check.selector,
        expectedAddress: check.expectedAddress ?? null,
        actualAddress: check.actualAddress ?? null,
        error: check.error ?? null,
      })),
  );
  const tokenDecimalMismatches = (report.tokens ?? [])
    .filter((token) => token.matches !== true)
    .map((token) => ({
      symbol: token.symbol,
      address: token.address,
      expectedDecimals: token.expectedDecimals ?? null,
      actualDecimals: token.actualDecimals ?? null,
      hasBytecode: token.hasBytecode === true,
      error: token.error ?? null,
    }));

  return {
    chainMatches: report.chainMatches === true,
    relationshipMismatches,
    tokenDecimalMismatches,
    hasBlockingMismatch:
      report.chainMatches !== true || relationshipMismatches.length > 0 || tokenDecimalMismatches.length > 0,
  };
}

export async function verifyDefaultSources(options = {}) {
  const rpcUrl = options.rpcUrl ?? DOGEOS_RPC_URL;
  const fetchFn = options.fetchFn ?? fetch;
  const expectedChainIdHex = options.expectedChainIdHex ?? DOGEOS_CHAIN_ID_HEX;
  const verificationTargets = options.verificationTargets ?? defaultVerificationTargets();
  const tokens = options.tokens ?? OFFICIAL_DOGEOS_TOKENS;
  const chainId = await rpc({ method: "eth_chainId", params: [], rpcUrl, fetchFn });
  const [sources, tokenChecks] = await Promise.all([
    Promise.all(verificationTargets.map((source) => verifySource(source, options))),
    verifyOfficialTokens({ tokens, rpcUrl, fetchFn }),
  ]);

  const report = {
    chainId,
    expectedChainId: expectedChainIdHex,
    chainMatches: chainId === expectedChainIdHex,
    checkedAt: new Date().toISOString(),
    tokens: tokenChecks,
    sources,
  };

  return {
    ...report,
    summary: summarizeVerificationReport(report),
  };
}

export function createVerificationSnapshotProvider({
  cacheTtlMs = 60_000,
  nowMs = () => Date.now(),
  ...options
} = {}) {
  let cached = null;

  return async function verificationSnapshotProvider() {
    const now = nowMs();
    if (cached && now - cached.cachedAtMs <= cacheTtlMs) {
      return cached.report;
    }

    const report = await verifyDefaultSources(options);
    cached = {
      cachedAtMs: now,
      report,
    };
    return report;
  };
}
