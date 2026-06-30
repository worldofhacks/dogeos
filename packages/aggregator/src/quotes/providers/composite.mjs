const DEFAULT_PROVIDER_TIMEOUT_MS = 1_500;
// Retry a venue that TRANSIENTLY fails (timeout / RPC error) before giving up. A
// genuine "no pool" result returns [] WITHOUT throwing, so it is never retried —
// only thrown failures are. This stops a single slow testnet RPC call from
// dropping the ONLY route of a single-pool token (the intermittent "no route").
const DEFAULT_PROVIDER_RETRIES = 1;

function normalizeProvider(entry, index, defaultTimeoutMs) {
  if (typeof entry === "function") {
    return {
      providerId: entry.providerId ?? entry.name ?? `provider-${index}`,
      provider: entry,
      timeoutMs: defaultTimeoutMs,
    };
  }

  if (entry?.provider && typeof entry.provider === "function") {
    return {
      providerId: entry.providerId ?? entry.name ?? `provider-${index}`,
      provider: entry.provider,
      timeoutMs: entry.timeoutMs ?? defaultTimeoutMs,
    };
  }

  return null;
}

function timeoutError(providerId, timeoutMs) {
  return new Error(`Provider ${providerId} timed out after ${timeoutMs}ms.`);
}

async function runProvider({ providerId, provider, timeoutMs }, input) {
  let timer = null;

  try {
    const result = await Promise.race([
      provider(input),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(providerId, timeoutMs)), timeoutMs);
      }),
    ]);

    return Array.isArray(result) ? result : [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Run a provider, retrying TRANSIENT (thrown) failures up to `retries` times. A
// successful empty result ([]) is returned as-is (no retry). On final failure it
// rethrows the last error so the caller reports it exactly once.
async function runProviderWithRetry(provider, input, retries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await runProvider(provider, input);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function reportProviderError(onProviderError, error, context) {
  if (typeof onProviderError !== "function") return;

  try {
    onProviderError(error, context);
  } catch {
    // Quote health reporting must not block healthy routes.
  }
}

export function createCompositeQuoteCandidateProvider({
  providers = [],
  providerTimeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  providerRetries = DEFAULT_PROVIDER_RETRIES,
  onProviderError,
} = {}) {
  const enabledProviders = providers
    .map((provider, index) => normalizeProvider(provider, index, providerTimeoutMs))
    .filter(Boolean);

  return async function compositeQuoteCandidateProvider(input) {
    const providerResults = await Promise.all(
      enabledProviders.map(async (provider) => {
        try {
          return await runProviderWithRetry(provider, input, providerRetries);
        } catch (error) {
          // Reported ONCE, after retries are exhausted.
          reportProviderError(onProviderError, error, {
            providerId: provider.providerId,
            input,
          });
          return [];
        }
      }),
    );

    return providerResults.flat();
  };
}
