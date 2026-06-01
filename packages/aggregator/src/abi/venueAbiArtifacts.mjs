import { DOGEOS_CHAIN } from "../../../config/src/chains.mjs";
import { hashAbiArtifactPayload } from "./artifactHash.mjs";

export const VENUE_ABI_PROVENANCE = "venue-artifact";

function requireString(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required for venue ABI artifacts.`);
  }
  return normalized;
}

function normalizeAddress(address, fieldName) {
  const normalized = String(address ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function normalizeSelector(selector) {
  const normalized = String(selector ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{8}$/.test(normalized)) {
    throw new Error("Venue ABI artifact selectors must be 4-byte hex values.");
  }
  return normalized;
}

function normalizeChainId(chainId) {
  const normalized = Number(chainId);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error("chainId must be a positive safe integer.");
  }
  return normalized;
}

function canonicalAbiType(input = {}) {
  const type = input.type ?? "";
  if (!type.startsWith("tuple")) return type;

  const tupleSuffix = type.slice("tuple".length);
  const components = Array.isArray(input.components) ? input.components : [];
  return `(${components.map((component) => canonicalAbiType(component)).join(",")})${tupleSuffix}`;
}

export function abiFunctionSignaturesFromAbi(abi = []) {
  if (!Array.isArray(abi)) {
    throw new Error("Venue ABI artifact abi must be a JSON ABI array.");
  }

  return abi
    .filter((entry) => entry?.type === "function" && typeof entry.name === "string")
    .map((entry) => {
      const inputs = Array.isArray(entry.inputs) ? entry.inputs : [];
      return `${entry.name}(${inputs.map((input) => canonicalAbiType(input)).join(",")})`;
    });
}

export function createVenueAbiArtifact({
  sourceId,
  role,
  address,
  selectors,
  abiFunctionSignatures,
  abi,
  issuer,
  sourceUri,
  signedAt = null,
  checkedAt = null,
  chainId = DOGEOS_CHAIN.id,
}) {
  const artifactSelectors = (selectors ?? []).map(normalizeSelector);
  if (artifactSelectors.length === 0) {
    throw new Error("Venue ABI artifacts require at least one selector.");
  }

  const artifactAbiFunctionSignatures = (abiFunctionSignatures?.length
    ? abiFunctionSignatures
    : abiFunctionSignaturesFromAbi(abi))
    .map((signature) => requireString(signature, "abiFunctionSignatures entry"));
  if (artifactAbiFunctionSignatures.length === 0) {
    throw new Error("Venue ABI artifacts require at least one function signature.");
  }

  const target = {
    sourceId: requireString(sourceId, "sourceId"),
    chainId: normalizeChainId(chainId),
    role: requireString(role, "role"),
    address: normalizeAddress(address, "address"),
  };
  const payload = {
    kind: VENUE_ABI_PROVENANCE,
    target,
    selectors: artifactSelectors,
    abiFunctionSignatures: artifactAbiFunctionSignatures,
    abi,
  };

  return {
    ...payload,
    status: "verified",
    verified: true,
    issuer: requireString(issuer, "issuer"),
    sourceUri: requireString(sourceUri, "sourceUri"),
    artifactHash: hashAbiArtifactPayload(payload),
    signedAt,
    checkedAt,
  };
}
