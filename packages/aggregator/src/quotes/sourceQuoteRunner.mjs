// sourceQuoteRunner.mjs — the shared per-venue quote runner used by BOTH the V2
// and the concentrated-liquidity candidate providers.
//
// It exists to enforce ONE invariant that the previous duplicated copies got
// wrong, which is the root cause of the intermittent "no route then a route on
// the next poll" bug:
//
//   An EMPTY result ([]) from a venue must mean "this venue genuinely cannot
//   quote this pair at this block" — NEVER "the RPC was slow and we gave up".
//
// A transient failure (a per-venue timeout or a transport/RPC fault) is
// therefore reported with `transient: true` so the API layer can answer with a
// retryable status instead of a definitive "no route". A genuine venue error (an
// on-chain revert, an ABI-decode failure) is reported with `transient: false`
// and is a real, deterministic no-route from that venue.
//
// Note on layering: this runner does NOT swallow a slow call into a route-killing
// []. The previous 1000 ms per-venue cap was tighter than the composite's own
// per-venue budget AND was caught-and-returned-as-[], so the composite's retry
// (which only acts on THROWN errors) never engaged and the only venue of a
// single-pool token vanished on any sub-1 s RPC spike. The DogeOS testnet quoter
// eth_call is normally ~0.7 s but spikes to 2-3 s (worse for larger amounts that
// cross more ticks), so the default budget here covers that spike, and anything
// past it surfaces as transient (retryable) rather than a false no-route.

// Per-venue quote budget. Covers the documented 2-3 s DogeOS testnet quoter
// spike with margin; must stay BELOW the composite per-provider budget so a
// per-venue timeout is attributed to the venue, not the whole provider.
export const DEFAULT_SOURCE_TIMEOUT_MS = 3_000;

// A per-venue timeout: a transient failure, not a "no pool" result.
class SourceTimeoutError extends Error {
  constructor(sourceId, timeoutMs) {
    super(`Source ${sourceId} timed out after ${timeoutMs}ms.`);
    this.name = "SourceTimeoutError";
    this.transient = true;
  }
}

// Distinguish a TRANSIENT failure (retry would likely succeed) from a GENUINE
// one (the venue truly can't quote this pair). Transient = our per-venue timeout
// or a transport-layer fault from the JSON-RPC client / fetch (HTTP non-2xx,
// network reset, DNS, aborted socket, missing batch response). NON-transient = an
// on-chain revert ("execution reverted") or an ABI-decode failure — that pair is
// deterministically unroutable on this venue and must stay a real no-route.
export function isTransientError(error) {
  if (!error) return false;
  if (error.transient === true) return true;
  if (error.name === "AbortError") return true;
  const message = String(error.message ?? error);
  if (/execution reverted|revert|must (?:be|contain)|decode|invalid|exceeds/i.test(message)) {
    return false;
  }
  return (
    /\btimed out\b|\btimeout\b/i.test(message) ||
    /\bHTTP\s?\d/i.test(message) ||
    /\bfetch failed\b|\bnetwork\b|\bsocket\b|\bconnection\b/i.test(message) ||
    /ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR/i.test(message) ||
    /missing batch response|unknown RPC error/i.test(message)
  );
}

function reportSourceError(onSourceError, error, context) {
  if (typeof onSourceError !== "function") return;
  try {
    onSourceError(error, context);
  } catch {
    // Quote health reporting must never block a healthy route.
  }
}

// Run ONE venue's quote `task` under `timeoutMs`. Returns the task's candidates
// (or its genuine empty []). On a timeout or any thrown fault it reports the
// error with a `transient` classification and returns [] — preserving sibling
// venues (the providers aggregate with Promise.all) while letting the API layer
// tell a transient miss apart from a real no-route via the recorded diagnostic.
export async function runSourceQuote({
  source,
  input,
  timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  onSourceError,
  task,
}) {
  let timer = null;

  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SourceTimeoutError(source.sourceId, timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (error) {
    reportSourceError(onSourceError, error, {
      sourceId: source.sourceId,
      protocolType: source.protocolType,
      input,
      transient: isTransientError(error),
    });
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
