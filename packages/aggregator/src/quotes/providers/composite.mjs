const DEFAULT_PROVIDER_TIMEOUT_MS = 1_500;

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
  onProviderError,
} = {}) {
  const enabledProviders = providers
    .map((provider, index) => normalizeProvider(provider, index, providerTimeoutMs))
    .filter(Boolean);

  return async function compositeQuoteCandidateProvider(input) {
    const providerResults = await Promise.all(
      enabledProviders.map(async (provider) => {
        try {
          return await runProvider(provider, input);
        } catch (error) {
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
