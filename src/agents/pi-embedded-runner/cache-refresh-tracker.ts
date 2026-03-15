/**
 * Cache refresh tracker for managing automatic cache refreshes.
 * Tracks refresh count per session and provider to prevent excessive refreshing.
 */

export const CACHE_REFRESH_CUSTOM_TYPE = "openclaw.cache-refresh";

export type CacheRefreshEntryData = {
  timestamp: number;
  provider?: string;
  modelId?: string;
  refreshCount: number;
};

type CustomEntryLike = { type?: unknown; customType?: unknown; data?: unknown };

export type CacheRefreshState = {
  lastRefreshTimestamp: number | null;
  refreshCount: number;
  provider?: string;
  modelId?: string;
};

/**
 * Read the last cache refresh state from session manager.
 */
export function readCacheRefreshState(
  sessionManager: unknown,
  provider?: string,
): CacheRefreshState {
  const sm = sessionManager as { getEntries?: () => CustomEntryLike[] };
  if (!sm?.getEntries) {
    return { lastRefreshTimestamp: null, refreshCount: 0 };
  }

  try {
    const entries = sm.getEntries();
    let lastTimestamp: number | null = null;
    let count = 0;
    let lastProvider: string | undefined;
    let lastModelId: string | undefined;

    // Count refresh entries, optionally filtering by provider
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry?.type !== "custom" || entry?.customType !== CACHE_REFRESH_CUSTOM_TYPE) {
        continue;
      }
      const data = entry?.data as Partial<CacheRefreshEntryData> | undefined;

      // If provider is specified, only count matching entries
      if (provider && data?.provider && data.provider !== provider) {
        continue;
      }

      const ts = typeof data?.timestamp === "number" ? data.timestamp : null;
      if (ts && Number.isFinite(ts)) {
        if (lastTimestamp === null) {
          lastTimestamp = ts;
          lastProvider = data?.provider;
          lastModelId = data?.modelId;
        }
        count += data?.refreshCount ?? 1;
      }
    }

    return {
      lastRefreshTimestamp: lastTimestamp,
      refreshCount: count,
      provider: lastProvider,
      modelId: lastModelId,
    };
  } catch {
    return { lastRefreshTimestamp: null, refreshCount: 0 };
  }
}

/**
 * Append a cache refresh entry to the session.
 */
export function appendCacheRefreshEntry(
  sessionManager: unknown,
  data: CacheRefreshEntryData,
): void {
  const sm = sessionManager as {
    appendCustomEntry?: (customType: string, data: unknown) => void;
  };
  if (!sm?.appendCustomEntry) {
    return;
  }
  try {
    sm.appendCustomEntry(CACHE_REFRESH_CUSTOM_TYPE, data);
  } catch {
    // ignore persistence failures
  }
}

/**
 * Check if refresh count has exceeded the limit.
 */
export function hasExceededRefreshLimit(
  currentCount: number,
  maxRefreshCount: number,
): boolean {
  return currentCount >= maxRefreshCount;
}

/**
 * Calculate if cache should be refreshed based on TTL and elapsed time.
 * Returns true if cache is close to expiring (within safety margin).
 */
export function shouldRefreshCache(params: {
  lastRefreshTimestamp: number | null;
  cacheTtlMs: number;
  safetyMarginMs?: number;
  nowMs?: number;
}): boolean {
  const { lastRefreshTimestamp, cacheTtlMs, nowMs = Date.now() } = params;

  // Default safety margin: 30 seconds before expiry
  const safetyMarginMs = params.safetyMarginMs ?? 30_000;

  if (lastRefreshTimestamp === null) {
    return false; // No previous refresh, can't determine
  }

  const elapsedMs = nowMs - lastRefreshTimestamp;
  const refreshThresholdMs = cacheTtlMs - safetyMarginMs;

  return elapsedMs >= refreshThresholdMs;
}
