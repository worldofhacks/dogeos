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
// or a transport-layer fault from the JSON-RPC client / fetch (ANY HTTP status
// in the message — jsonRpcClient throws `eth_call failed with HTTP <status>.`
// BEFORE reading the body, so a gateway 400/403 blip is as retryable as a 502;
// real reverts arrive via HTTP 200 + JSON-RPC error envelope, never as an HTTP
// status message). NON-transient = an on-chain revert ("execution reverted") or
// an ABI-decode failure — that pair is deterministically unroutable on this
// venue and must stay a real no-route; revert markers are checked before these
// transport patterns in isTransientError.
function isTransportErrorMessage(message) {
  return (
    /\btimed out\b|\btimeout\b/i.test(message) ||
    /\bHTTP\s?\d/i.test(message) ||
    /\bfetch failed\b|\bnetwork\b|\bsocket\b|\bconnection\b/i.test(message) ||
    /ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR/i.test(message) ||
    /missing batch response|unknown RPC error/i.test(message) ||
    // jsonRpcClient throws this when the endpoint returns well-formed JSON of
    // the wrong shape (e.g. a gateway rate-limit envelope) — transport, not venue.
    /batch response must be an array/i.test(message) ||
    // JSON.parse failures from an HTML error page. V8's message is
    // `Unexpected token '<', "<html>\r\n<h"... is not valid JSON` — the quoted
    // excerpt embeds the page's own newlines, but the trailing "is not valid
    // JSON" is contiguous, so the plain substring below matches it (anchored to
    // the real message tail instead of a broad token→json span).
    /invalid json|not valid json|non-JSON/i.test(message)
  );
}

// Definitive on-chain revert markers. A revert means the venue's quoter itself
// rejected the call deterministically — even if the surrounding text looks
// transport-shaped (hypothetical "HTTP 400: execution reverted"), it must stay
// a genuine no-route, so these are checked BEFORE the transport patterns.
function isRevertMessage(message) {
  return /execution reverted|\brevert/i.test(message);
}

function isGenuineVenueErrorMessage(message) {
  return /execution reverted|revert|must (?:be|contain)|decode|invalid|exceeds/i.test(message);
}

export function isTransientError(error) {
  if (!error) return false;
  if (error.transient === true) return true;
  if (error.name === "AbortError") return true;
  const message = String(error.message ?? error);
  // Precedence: revert markers → transport signatures → other venue signatures.
  // Revert markers are definitive genuine no-routes even inside a
  // transport-shaped message ("HTTP 400: execution reverted"). Transport
  // signatures then run BEFORE the broader venue words ("invalid", "decode", …)
  // so a transport fault whose text contains one of those (e.g. an HTML error
  // page's "not valid JSON" parse error) stays retryable — that is the
  // false-"no route" class fixed in c32bc98.
  if (isRevertMessage(message)) return false;
  if (isTransportErrorMessage(message)) return true;
  // Remaining venue signatures are genuine, deterministic no-routes.
  if (isGenuineVenueErrorMessage(message)) return false;
  // Unknown error text ALSO defaults to genuine: the composite retry only
  // re-runs THROWN transients, and guessing "transient" for unrecognized text
  // would hide real venue failures behind retries. Add new transport
  // signatures to isTransportErrorMessage instead.
  return false;
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
