/**
 * Cache refresh scheduler for periodic cache refresh operations.
 * Uses a lightweight timer-based approach similar to heartbeat-runner.
 */

import { parseDurationMs } from "../../cli/parse-duration.js";
import type { OpenClawConfig } from "../../config/config.js";
import type { CacheAutoRefreshConfig } from "../../config/types.base.js";
import { getProviderCacheTtlMs } from "./cache-ttl.js";

const DEFAULT_MAX_REFRESH_COUNT = 10;
const DEFAULT_SAFETY_MARGIN_MS = 30_000; // 30 seconds before expiry

export type CacheRefreshSchedulerOptions = {
  provider: string;
  modelId: string;
  config?: CacheAutoRefreshConfig;
  sessionManager?: unknown;
};

/**
 * Resolve cache auto-refresh configuration from agent defaults.
 */
export function resolveCacheAutoRefreshConfig(
  cfg: OpenClawConfig | undefined,
): CacheAutoRefreshConfig | undefined {
  return cfg?.agents?.defaults?.cacheAutoRefresh;
}

/**
 * Check if cache auto-refresh is enabled for a specific provider.
 */
export function isCacheAutoRefreshEnabled(
  config: CacheAutoRefreshConfig | undefined,
  provider?: string,
): boolean {
  if (!config?.enabled) {
    return false;
  }

  // If provider-specific config exists, check if it's explicitly disabled
  if (provider && config.providers?.[provider]) {
    // Currently we don't have a per-provider enabled flag, so just check global
    return true;
  }

  return true;
}

/**
 * Get the maximum refresh count for a provider.
 */
export function getMaxRefreshCount(
  config: CacheAutoRefreshConfig | undefined,
  provider?: string,
): number {
  // Check provider-specific override first
  if (provider && config?.providers?.[provider]?.maxRefreshCount) {
    const count = config.providers[provider].maxRefreshCount;
    if (count !== undefined) {
      return count;
    }
  }

  // Fall back to global config or default
  return config?.maxRefreshCount ?? DEFAULT_MAX_REFRESH_COUNT;
}

/**
 * Get the refresh interval for a provider in milliseconds.
 * Returns null if custom interval is not configured.
 */
export function getRefreshIntervalMs(
  config: CacheAutoRefreshConfig | undefined,
  provider?: string,
): number | null {
  // Check provider-specific override first
  if (provider && config?.providers?.[provider]?.refreshInterval) {
    const interval = config.providers[provider].refreshInterval;
    if (interval) {
      try {
        return parseDurationMs(interval, { defaultUnit: "m" });
      } catch {
        // Invalid duration, fall through
      }
    }
  }

  // Fall back to global config
  if (config?.refreshInterval) {
    try {
      return parseDurationMs(config.refreshInterval, { defaultUnit: "m" });
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Calculate the next refresh time based on TTL and configuration.
 */
export function calculateNextRefreshMs(params: {
  lastRefreshTimestamp: number;
  cacheTtlMs: number;
  customIntervalMs?: number | null;
  safetyMarginMs?: number;
}): number {
  const { lastRefreshTimestamp, cacheTtlMs, customIntervalMs } = params;
  const safetyMarginMs = params.safetyMarginMs ?? DEFAULT_SAFETY_MARGIN_MS;

  // If custom interval is specified, use it
  if (customIntervalMs && customIntervalMs > 0) {
    return lastRefreshTimestamp + customIntervalMs;
  }

  // Otherwise, refresh before TTL expires (with safety margin)
  const refreshIntervalMs = Math.max(0, cacheTtlMs - safetyMarginMs);
  return lastRefreshTimestamp + refreshIntervalMs;
}

/**
 * Resolve effective cache TTL for a provider, considering configuration and defaults.
 */
export function resolveEffectiveCacheTtlMs(
  provider: string,
  modelId: string,
  customIntervalMs?: number | null,
): number | null {
  // If custom interval is specified, use it as the effective TTL
  if (customIntervalMs && customIntervalMs > 0) {
    return customIntervalMs;
  }

  // Otherwise, use provider's default TTL
  return getProviderCacheTtlMs(provider, modelId);
}

export { DEFAULT_MAX_REFRESH_COUNT, DEFAULT_SAFETY_MARGIN_MS };
