/**
 * Cache refresh integration module.
 * Provides hooks for integrating cache refresh logic into the stream pipeline.
 */

import type { OpenClawConfig } from "../../config/config.js";
import { log } from "./logger.js";
import {
  appendCacheRefreshEntry,
  hasExceededRefreshLimit,
  readCacheRefreshState,
  shouldRefreshCache,
  type CacheRefreshEntryData,
} from "./cache-refresh-tracker.js";
import {
  getMaxRefreshCount,
  getRefreshIntervalMs,
  isCacheAutoRefreshEnabled,
  resolveCacheAutoRefreshConfig,
  resolveEffectiveCacheTtlMs,
  DEFAULT_SAFETY_MARGIN_MS,
} from "./cache-refresh-scheduler.js";
import { appendCacheTtlTimestamp, getProviderCacheTtlMs } from "./cache-ttl.js";

export type CacheRefreshCheckResult = {
  shouldRefresh: boolean;
  reason?: "disabled" | "limit-exceeded" | "not-eligible" | "too-early";
  refreshCount: number;
  maxRefreshCount: number;
};

/**
 * Check if cache should be refreshed before the next LLM request.
 */
export function checkCacheRefreshNeeded(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  sessionManager?: unknown;
  nowMs?: number;
}): CacheRefreshCheckResult {
  const { cfg, provider, modelId, sessionManager, nowMs = Date.now() } = params;

  // Get cache auto-refresh config
  const config = resolveCacheAutoRefreshConfig(cfg);

  // Check if auto-refresh is enabled
  if (!isCacheAutoRefreshEnabled(config, provider)) {
    return {
      shouldRefresh: false,
      reason: "disabled",
      refreshCount: 0,
      maxRefreshCount: 0,
    };
  }

  // Get provider's cache TTL
  const providerTtlMs = getProviderCacheTtlMs(provider, modelId);
  if (!providerTtlMs) {
    return {
      shouldRefresh: false,
      reason: "not-eligible",
      refreshCount: 0,
      maxRefreshCount: 0,
    };
  }

  // Get custom refresh interval if configured
  const customIntervalMs = getRefreshIntervalMs(config, provider);
  const effectiveTtlMs = resolveEffectiveCacheTtlMs(provider, modelId, customIntervalMs);

  if (!effectiveTtlMs) {
    return {
      shouldRefresh: false,
      reason: "not-eligible",
      refreshCount: 0,
      maxRefreshCount: 0,
    };
  }

  // Get current refresh state
  const refreshState = readCacheRefreshState(sessionManager, provider);
  const maxRefreshCount = getMaxRefreshCount(config, provider);

  // Check if refresh limit exceeded
  if (hasExceededRefreshLimit(refreshState.refreshCount, maxRefreshCount)) {
    return {
      shouldRefresh: false,
      reason: "limit-exceeded",
      refreshCount: refreshState.refreshCount,
      maxRefreshCount,
    };
  }

  // Check if cache needs refresh based on TTL
  const needsRefresh = shouldRefreshCache({
    lastRefreshTimestamp: refreshState.lastRefreshTimestamp,
    cacheTtlMs: effectiveTtlMs,
    safetyMarginMs: DEFAULT_SAFETY_MARGIN_MS,
    nowMs,
  });

  if (!needsRefresh) {
    return {
      shouldRefresh: false,
      reason: "too-early",
      refreshCount: refreshState.refreshCount,
      maxRefreshCount,
    };
  }

  return {
    shouldRefresh: true,
    refreshCount: refreshState.refreshCount,
    maxRefreshCount,
  };
}

/**
 * Record a cache refresh operation.
 */
export function recordCacheRefresh(params: {
  provider: string;
  modelId: string;
  sessionManager?: unknown;
  nowMs?: number;
}): void {
  const { provider, modelId, sessionManager, nowMs = Date.now() } = params;

  const refreshEntry: CacheRefreshEntryData = {
    timestamp: nowMs,
    provider,
    modelId,
    refreshCount: 1,
  };

  // Append refresh entry
  appendCacheRefreshEntry(sessionManager, refreshEntry);

  // Also update cache TTL timestamp for compatibility
  appendCacheTtlTimestamp(sessionManager, {
    timestamp: nowMs,
    provider,
    modelId,
  });

  log.debug(
    `Recorded cache refresh for ${provider}/${modelId} at ${new Date(nowMs).toISOString()}`,
  );
}

/**
 * Pre-request hook to check and trigger cache refresh if needed.
 * Returns true if refresh was performed.
 */
export function performPreRequestCacheRefresh(params: {
  cfg: OpenClawConfig | undefined;
  provider: string;
  modelId: string;
  sessionManager?: unknown;
}): boolean {
  const { cfg, provider, modelId, sessionManager } = params;

  const checkResult = checkCacheRefreshNeeded({
    cfg,
    provider,
    modelId,
    sessionManager,
  });

  if (!checkResult.shouldRefresh) {
    if (checkResult.reason === "limit-exceeded") {
      log.debug(
        `Cache refresh limit exceeded for ${provider}/${modelId}: ${checkResult.refreshCount}/${checkResult.maxRefreshCount}`,
      );
    }
    return false;
  }

  // Record the refresh
  recordCacheRefresh({ provider, modelId, sessionManager });

  log.info(
    `Cache refreshed for ${provider}/${modelId} (${checkResult.refreshCount + 1}/${checkResult.maxRefreshCount})`,
  );

  return true;
}
