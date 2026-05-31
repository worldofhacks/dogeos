export function hasSelector(bytecode, selector) {
  if (!/^0x[0-9a-fA-F]*$/.test(bytecode ?? "")) return false;
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector ?? "")) return false;
  return bytecode.toLowerCase().includes(selector.slice(2).toLowerCase());
}

function normalizeBlockscout(blockscout = {}) {
  return {
    isContract: Boolean(blockscout.isContract ?? blockscout.is_contract),
    isVerified: Boolean(blockscout.isVerified ?? blockscout.is_verified),
  };
}

function normalizeBlockscoutContract(blockscoutContract = {}) {
  return {
    hasAbi: Boolean(blockscoutContract.hasAbi ?? blockscoutContract.has_abi),
  };
}

function normalizeSelectorList(values = []) {
  return values.filter((value) => /^0x[0-9a-fA-F]{8}$/.test(value ?? "")).map((value) => value.toLowerCase());
}

function normalizeSignatureList(values = []) {
  return values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim());
}

function summarizeExecutionAbiArtifact(abiArtifact, expectedSelectors = [], expectedAbiFunctions = []) {
  const selectors = normalizeSelectorList(abiArtifact?.selectorMatches ?? abiArtifact?.selectors ?? []);
  const expected = normalizeSelectorList(expectedSelectors);
  const selectorMatches = expected.filter((selector) => selectors.includes(selector));
  const abiFunctions = normalizeSignatureList(
    abiArtifact?.abiFunctionMatches ?? abiArtifact?.abiFunctionSignatures ?? [],
  );
  const expectedFunctions = normalizeSignatureList(expectedAbiFunctions);
  const abiFunctionMatches = expectedFunctions.filter((signature) => abiFunctions.includes(signature));
  const hasVerifiedFlag = typeof abiArtifact?.verified === "boolean";

  return {
    isVerified: hasVerifiedFlag ? abiArtifact.verified === true : abiArtifact?.status === "verified",
    matchesTarget: abiArtifact?.matchesTarget === true,
    selectorMatches,
    abiFunctionMatches,
  };
}

export function deriveExecutableStatus({
  role,
  bytecode,
  blockscout,
  blockscoutContract,
  abiProvenance,
  abiArtifact,
  expectedSelectors = [],
  expectedAbiFunctions = [],
  readChecks = [],
}) {
  const hasBytecode = /^0x[0-9a-fA-F]+$/.test(bytecode ?? "") && bytecode !== "0x";
  const normalizedBlockscout = normalizeBlockscout(blockscout);
  const normalizedBlockscoutContract = normalizeBlockscoutContract(blockscoutContract);
  const selectorMatches = expectedSelectors.filter((selector) => hasSelector(bytecode, selector));
  const expectedAbiFunctionSignatures = normalizeSignatureList(expectedAbiFunctions);
  const blockscoutAbiFunctionSignatures = normalizeSignatureList(
    blockscoutContract?.abiFunctionSignatures,
  );
  const blockscoutAbiFunctionMatches = expectedAbiFunctionSignatures.filter((signature) =>
    blockscoutAbiFunctionSignatures.includes(signature),
  );
  const readCheckMatches = readChecks.filter((check) => check.matches).map((check) => check.label);
  const hasBlockscoutAbiProvenance = abiProvenance === "blockscout";
  const hasVenueAbiArtifactProvenance = abiProvenance === "venue-artifact";
  const hasAdapterAbiArtifactProvenance = abiProvenance === "adapter-fragment";
  const executionArtifact = summarizeExecutionAbiArtifact(
    abiArtifact,
    expectedSelectors,
    expectedAbiFunctionSignatures,
  );
  const hasVenueAbiArtifact =
    hasVenueAbiArtifactProvenance && executionArtifact.isVerified && executionArtifact.matchesTarget;
  const hasAdapterAbiArtifact =
    hasAdapterAbiArtifactProvenance && executionArtifact.isVerified && executionArtifact.matchesTarget;
  const abiArtifactSelectorMatches = executionArtifact.selectorMatches;
  const abiArtifactFunctionMatches = executionArtifact.abiFunctionMatches;

  function result(status, reason, overrides = {}) {
    return {
      status,
      hasBytecode,
      hasBlockscoutAbi: normalizedBlockscoutContract.hasAbi,
      hasVenueAbiArtifact,
      hasAdapterAbiArtifact,
      abiArtifactSelectorMatches,
      abiArtifactFunctionMatches,
      blockscoutAbiFunctionMatches,
      selectorMatches,
      readCheckMatches,
      reason,
      ...overrides,
    };
  }

  if (!hasBytecode) {
    return result("watchlist", "No bytecode found at this address.");
  }

  if (role !== "router") {
    return result("readOnly", "Non-router contracts can support discovery reads, but cannot execute swaps.");
  }

  if (!normalizedBlockscout.isContract) {
    return result(
      "readOnly",
      "RPC bytecode exists, but Blockscout has not confirmed this as a contract.",
    );
  }

  if (hasVenueAbiArtifactProvenance || hasAdapterAbiArtifactProvenance) {
    const artifactLabel = hasAdapterAbiArtifactProvenance
      ? "adapter ABI fragment"
      : "venue ABI artifact";

    if (!executionArtifact.isVerified) {
      return result("readOnly", `Router ${artifactLabel} is not verified for execution.`);
    }

    if (!executionArtifact.matchesTarget) {
      return result("readOnly", `Router ${artifactLabel} target does not match this source.`);
    }

    if (expectedSelectors.length !== abiArtifactSelectorMatches.length) {
      return result(
        "simulationOnly",
        `Router ${artifactLabel} is missing one or more expected swap selectors.`,
      );
    }

    if (expectedAbiFunctionSignatures.length !== abiArtifactFunctionMatches.length) {
      return result(
        "simulationOnly",
        `Router ${artifactLabel} is missing one or more expected router functions.`,
      );
    }

    if (expectedSelectors.length !== selectorMatches.length) {
      return result(
        "simulationOnly",
        `Router bytecode is missing one or more selectors from the ${artifactLabel}.`,
      );
    }

    if (readChecks.some((check) => !check.matches)) {
      return result(
        "simulationOnly",
        `${artifactLabel} router has one or more mismatched on-chain relationship reads.`,
      );
    }

    return result(
      "active",
      `Router passed bytecode, ${artifactLabel}, selector, and relationship checks.`,
    );
  }

  if (abiProvenance === "onchain-bytecode") {
    return result(
      "readOnly",
      "Router has selector-only bytecode evidence, not execution ABI provenance.",
    );
  }

  if (!hasBlockscoutAbiProvenance) {
    return result("readOnly", "Router ABI provenance is not Blockscout verified for execution.");
  }

  if (!normalizedBlockscout.isVerified) {
    return result("readOnly", "Router is not verified on Blockscout.");
  }

  if (!normalizedBlockscoutContract.hasAbi) {
    return result("readOnly", "Blockscout ABI payload is missing for this router.", {
      hasBlockscoutAbi: false,
    });
  }

  if (expectedSelectors.length !== selectorMatches.length) {
    return result("simulationOnly", "Verified router is missing one or more expected swap selectors.");
  }

  if (expectedAbiFunctionSignatures.length !== blockscoutAbiFunctionMatches.length) {
    return result(
      "simulationOnly",
      "Blockscout ABI payload is missing one or more expected router functions.",
    );
  }

  if (readChecks.some((check) => !check.matches)) {
    return result(
      "simulationOnly",
      "Verified router has one or more mismatched on-chain relationship reads.",
    );
  }

  return result("active", "Router passed bytecode, Blockscout, ABI provenance, and selector checks.");
}
