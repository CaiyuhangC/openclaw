type CustomEntryLike = { type?: unknown; customType?: unknown; data?: unknown };

export const CACHE_TTL_CUSTOM_TYPE = "openclaw.cache-ttl";

export type CacheTtlEntryData = {
  timestamp: number;
  provider?: string;
  modelId?: string;
};

const CACHE_TTL_NATIVE_PROVIDERS = new Set(["anthropic", "moonshot", "zai"]);
const OPENROUTER_CACHE_TTL_MODEL_PREFIXES = [
  "anthropic/",
  "moonshot/",
  "moonshotai/",
  "zai/",
] as const;

/**
 * Default cache TTL values for providers that support prompt caching (in milliseconds).
 * Anthropic: 5 minutes (300,000ms)
 * Moonshot: 5 minutes (300,000ms)
 * ZAI: 5 minutes (300,000ms)
 */
const PROVIDER_DEFAULT_CACHE_TTL_MS: Record<string, number> = {
  anthropic: 5 * 60 * 1000, // 5 minutes
  moonshot: 5 * 60 * 1000, // 5 minutes
  zai: 5 * 60 * 1000, // 5 minutes
  openrouter: 5 * 60 * 1000, // 5 minutes (for eligible models)
  kilocode: 5 * 60 * 1000, // 5 minutes (for anthropic/* models)
};

function isOpenRouterCacheTtlModel(modelId: string): boolean {
  return OPENROUTER_CACHE_TTL_MODEL_PREFIXES.some((prefix) => modelId.startsWith(prefix));
}

export function isCacheTtlEligibleProvider(provider: string, modelId: string): boolean {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModelId = modelId.toLowerCase();
  if (CACHE_TTL_NATIVE_PROVIDERS.has(normalizedProvider)) {
    return true;
  }
  if (normalizedProvider === "openrouter" && isOpenRouterCacheTtlModel(normalizedModelId)) {
    return true;
  }
  if (normalizedProvider === "kilocode" && normalizedModelId.startsWith("anthropic/")) {
    return true;
  }
  return false;
}

export function readLastCacheTtlTimestamp(sessionManager: unknown): number | null {
  const sm = sessionManager as { getEntries?: () => CustomEntryLike[] };
  if (!sm?.getEntries) {
    return null;
  }
  try {
    const entries = sm.getEntries();
    let last: number | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type !== "custom" || entry?.customType !== CACHE_TTL_CUSTOM_TYPE) {
        continue;
      }
      const data = entry?.data as Partial<CacheTtlEntryData> | undefined;
      const ts = typeof data?.timestamp === "number" ? data.timestamp : null;
      if (ts && Number.isFinite(ts)) {
        last = ts;
        break;
      }
    }
    return last;
  } catch {
    return null;
  }
}

export function appendCacheTtlTimestamp(sessionManager: unknown, data: CacheTtlEntryData): void {
  const sm = sessionManager as {
    appendCustomEntry?: (customType: string, data: unknown) => void;
  };
  if (!sm?.appendCustomEntry) {
    return;
  }
  try {
    sm.appendCustomEntry(CACHE_TTL_CUSTOM_TYPE, data);
  } catch {
    // ignore persistence failures
  }
}

/**
 * Get the default cache TTL for a provider in milliseconds.
 * Returns null if the provider doesn't support caching or is not recognized.
 */
export function getProviderCacheTtlMs(provider: string, modelId: string): number | null {
  const normalizedProvider = provider.toLowerCase();

  // Check if provider is eligible for caching
  if (!isCacheTtlEligibleProvider(provider, modelId)) {
    return null;
  }

  // Return the provider's default TTL
  return PROVIDER_DEFAULT_CACHE_TTL_MS[normalizedProvider] ?? null;
}
