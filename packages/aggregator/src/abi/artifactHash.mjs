import { createHash } from "node:crypto";

export function canonicalizeAbiArtifact(value) {
  if (Array.isArray(value)) return value.map(canonicalizeAbiArtifact);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeAbiArtifact(value[key])]),
  );
}

export function abiArtifactPayloadFromArtifact(artifact = {}) {
  return {
    kind: artifact.kind,
    target: artifact.target,
    selectors: artifact.selectors ?? artifact.selectorMatches ?? [],
    abiFunctionSignatures: artifact.abiFunctionSignatures ?? artifact.abiFunctionMatches ?? [],
    abi: artifact.abi,
  };
}

export function hashAbiArtifactPayload(payload) {
  const canonicalJson = JSON.stringify(canonicalizeAbiArtifact(payload));
  return `0x${createHash("sha256").update(canonicalJson).digest("hex")}`;
}
