import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  calculateNextRefreshMs,
  getMaxRefreshCount,
  getRefreshIntervalMs,
  isCacheAutoRefreshEnabled,
  resolveCacheAutoRefreshConfig,
  resolveEffectiveCacheTtlMs,
  DEFAULT_MAX_REFRESH_COUNT,
  DEFAULT_SAFETY_MARGIN_MS,
} from "./cache-refresh-scheduler.js";

describe("cache-refresh-scheduler", () => {
  describe("resolveCacheAutoRefreshConfig", () => {
    it("returns undefined when config is undefined", () => {
      const config = resolveCacheAutoRefreshConfig(undefined);
      expect(config).toBeUndefined();
    });

    it("returns cache auto-refresh config when present", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: true,
              maxRefreshCount: 5,
            },
          },
        },
      } as OpenClawConfig;

      const config = resolveCacheAutoRefreshConfig(cfg);

      expect(config).toEqual({
        enabled: true,
        maxRefreshCount: 5,
      });
    });
  });

  describe("isCacheAutoRefreshEnabled", () => {
    it("returns false when config is undefined", () => {
      expect(isCacheAutoRefreshEnabled(undefined)).toBe(false);
    });

    it("returns false when enabled is false", () => {
      const config = { enabled: false };
      expect(isCacheAutoRefreshEnabled(config)).toBe(false);
    });

    it("returns true when enabled is true", () => {
      const config = { enabled: true };
      expect(isCacheAutoRefreshEnabled(config)).toBe(true);
    });

    it("returns true when enabled is true with provider", () => {
      const config = {
        enabled: true,
        providers: {
          anthropic: {
            maxRefreshCount: 15,
          },
        },
      };
      expect(isCacheAutoRefreshEnabled(config, "anthropic")).toBe(true);
    });
  });

  describe("getMaxRefreshCount", () => {
    it("returns default when config is undefined", () => {
      expect(getMaxRefreshCount(undefined)).toBe(DEFAULT_MAX_REFRESH_COUNT);
    });

    it("returns global max refresh count", () => {
      const config = { maxRefreshCount: 15 };
      expect(getMaxRefreshCount(config)).toBe(15);
    });

    it("returns provider-specific max refresh count", () => {
      const config = {
        maxRefreshCount: 10,
        providers: {
          anthropic: {
            maxRefreshCount: 20,
          },
        },
      };
      expect(getMaxRefreshCount(config, "anthropic")).toBe(20);
    });

    it("falls back to global when provider has no override", () => {
      const config = {
        maxRefreshCount: 12,
        providers: {
          openai: {
            maxRefreshCount: 8,
          },
        },
      };
      expect(getMaxRefreshCount(config, "anthropic")).toBe(12);
    });
  });

  describe("getRefreshIntervalMs", () => {
    it("returns null when config is undefined", () => {
      expect(getRefreshIntervalMs(undefined)).toBeNull();
    });

    it("returns null when no interval is configured", () => {
      const config = { enabled: true };
      expect(getRefreshIntervalMs(config)).toBeNull();
    });

    it("parses global refresh interval", () => {
      const config = { refreshInterval: "4m" };
      expect(getRefreshIntervalMs(config)).toBe(4 * 60 * 1000);
    });

    it("parses provider-specific refresh interval", () => {
      const config = {
        refreshInterval: "5m",
        providers: {
          anthropic: {
            refreshInterval: "4m30s",
          },
        },
      };
      expect(getRefreshIntervalMs(config, "anthropic")).toBe(4 * 60 * 1000 + 30 * 1000);
    });

    it("returns null for invalid duration", () => {
      const config = { refreshInterval: "invalid" };
      expect(getRefreshIntervalMs(config)).toBeNull();
    });

    it("falls back to global when provider has no override", () => {
      const config = {
        refreshInterval: "3m",
        providers: {
          openai: {
            refreshInterval: "2m",
          },
        },
      };
      expect(getRefreshIntervalMs(config, "anthropic")).toBe(3 * 60 * 1000);
    });
  });

  describe("calculateNextRefreshMs", () => {
    it("uses custom interval when specified", () => {
      const result = calculateNextRefreshMs({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000,
        customIntervalMs: 240_000, // 4 minutes
      });

      expect(result).toBe(1000000 + 240_000);
    });

    it("uses TTL with safety margin when no custom interval", () => {
      const result = calculateNextRefreshMs({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000, // 5 minutes
        safetyMarginMs: 30_000, // 30 seconds
      });

      expect(result).toBe(1000000 + 270_000);
    });

    it("uses default safety margin when not specified", () => {
      const result = calculateNextRefreshMs({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000,
      });

      expect(result).toBe(1000000 + 300_000 - DEFAULT_SAFETY_MARGIN_MS);
    });

    it("handles zero custom interval", () => {
      const result = calculateNextRefreshMs({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000,
        customIntervalMs: 0,
      });

      expect(result).toBe(1000000 + 300_000 - DEFAULT_SAFETY_MARGIN_MS);
    });
  });

  describe("resolveEffectiveCacheTtlMs", () => {
    it("returns custom interval when specified", () => {
      const result = resolveEffectiveCacheTtlMs("anthropic", "claude-3-5-sonnet-20241022", 240_000);
      expect(result).toBe(240_000);
    });

    it("returns provider default when no custom interval", () => {
      const result = resolveEffectiveCacheTtlMs("anthropic", "claude-3-5-sonnet-20241022", null);
      expect(result).toBe(5 * 60 * 1000);
    });

    it("returns null for non-eligible provider", () => {
      const result = resolveEffectiveCacheTtlMs("openai", "gpt-4", null);
      expect(result).toBeNull();
    });

    it("returns provider default for openrouter with eligible model", () => {
      const result = resolveEffectiveCacheTtlMs("openrouter", "anthropic/claude-3-5-sonnet-20241022", null);
      expect(result).toBe(5 * 60 * 1000);
    });
  });
});
