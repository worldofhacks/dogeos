import { listSources, SOURCE_STATUSES } from "../sources/registry.mjs";

const EXECUTABLE_ABI_PROVENANCE = new Set(["adapter-fragment", "blockscout", "venue-artifact"]);

function normalizeAddress(value, fieldName) {
  const normalized = String(value ?? "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${fieldName} must be a 20-byte hex address.`);
  }
  return normalized;
}

function assertHexData(value, fieldName) {
  if (!/^0x([0-9a-fA-F]{2})*$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be hex calldata.`);
  }
}

function assertSelector(value, fieldName) {
  if (!/^0x[0-9a-fA-F]{8}$/.test(value ?? "")) {
    throw new Error(`${fieldName} must be a 4-byte function selector.`);
  }
}

function findBuilder(builders, quote) {
  const quoteMode = quote.quoteMode ?? "exactInput";
  return builders.find(
    (builder) =>
      builder.sourceId === quote.sourceId &&
      (!builder.protocolType || builder.protocolType === quote.protocolType) &&
      (builder.quoteMode ?? "exactInput") === quoteMode &&
      (builder.executionMode ?? null) === (quote.executionMode ?? null),
  );
}

function findSource(sources, sourceId) {
  return sources.find((source) => source.sourceId === sourceId);
}

function assertSourceExecutable({ source, quote, sources }) {
  if (!source) {
    throw new Error(`Unknown source ${quote.sourceId}.`);
  }

  if (source.status !== SOURCE_STATUSES.ACTIVE || quote.status !== SOURCE_STATUSES.ACTIVE) {
    throw new Error(`Source ${quote.sourceId} is not active for calldata building.`);
  }

  if (!EXECUTABLE_ABI_PROVENANCE.has(source.abiProvenance)) {
    throw new Error(`Source ${quote.sourceId} requires ABI provenance before calldata building.`);
  }

  if (!source.verification?.execution) {
    throw new Error(`Source ${quote.sourceId} is not verified for execution.`);
  }

  const sourceRouter = normalizeAddress(source.router, "source.router");

  // Router-execution mode: the venue stays the verified market (its router
  // must still match the registry entry), but the transaction targets the
  // first-party DogeSwapRouter, which must itself be active and verified.
  if (quote.executionMode === "dogeswap-router") {
    if (normalizeAddress(quote.venueRouter, "quote.venueRouter") !== sourceRouter) {
      throw new Error(`Quote venue router does not match verified router for ${quote.sourceId}.`);
    }
    const routerSource = findSource(sources, "dogeswap-split");
    if (
      !routerSource?.router ||
      routerSource.status !== SOURCE_STATUSES.ACTIVE ||
      routerSource.verification?.execution !== true
    ) {
      throw new Error("DogeSwapRouter execution is not active and verified.");
    }
    if (
      normalizeAddress(quote.router, "quote.router") !==
      normalizeAddress(routerSource.router, "routerSource.router")
    ) {
      throw new Error("Quote router does not match the verified DogeSwapRouter.");
    }
    return;
  }

  const quoteRouter = normalizeAddress(quote.router, "quote.router");
  if (sourceRouter !== quoteRouter) {
    throw new Error(`Quote router does not match verified router for ${quote.sourceId}.`);
  }
}

export function createVerifiedCalldataBuilder({
  sources = listSources(),
  builders = [],
} = {}) {
  return function verifiedCalldataBuilder(quote) {
    const builder = findBuilder(builders, quote);
    if (!builder) {
      throw new Error(`No verified calldata builder for ${quote.sourceId}.`);
    }

    const source = findSource(sources, quote.sourceId);
    assertSourceExecutable({ source, quote, sources });
    assertSelector(builder.selector, "builder.selector");

    const calldata = builder.buildCalldata(quote);
    assertHexData(calldata, "calldata");

    if (calldata.slice(0, 10).toLowerCase() !== builder.selector.toLowerCase()) {
      throw new Error(`Calldata selector does not match verified builder for ${quote.sourceId}.`);
    }

    return calldata;
  };
}
