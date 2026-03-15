import { describe, expect, it } from "vitest";
import {
  appendCacheRefreshEntry,
  hasExceededRefreshLimit,
  readCacheRefreshState,
  shouldRefreshCache,
  type CacheRefreshEntryData,
} from "./cache-refresh-tracker.js";

describe("cache-refresh-tracker", () => {
  describe("readCacheRefreshState", () => {
    it("returns initial state when no entries exist", () => {
      const sessionManager = {
        getEntries: () => [],
      };

      const state = readCacheRefreshState(sessionManager);

      expect(state).toEqual({
        lastRefreshTimestamp: null,
        refreshCount: 0,
      });
    });

    it("reads refresh state from session entries", () => {
      const sessionManager = {
        getEntries: () => [
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1000000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
        ],
      };

      const state = readCacheRefreshState(sessionManager);

      expect(state.lastRefreshTimestamp).toBe(1000000);
      expect(state.refreshCount).toBe(1);
      expect(state.provider).toBe("anthropic");
      expect(state.modelId).toBe("claude-3-5-sonnet-20241022");
    });

    it("counts multiple refresh entries", () => {
      const sessionManager = {
        getEntries: () => [
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1000000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1300000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1600000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
        ],
      };

      const state = readCacheRefreshState(sessionManager);

      expect(state.lastRefreshTimestamp).toBe(1600000);
      expect(state.refreshCount).toBe(3);
    });

    it("filters by provider when specified", () => {
      const sessionManager = {
        getEntries: () => [
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1000000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1300000,
              provider: "openai",
              modelId: "gpt-4",
              refreshCount: 1,
            },
          },
        ],
      };

      const state = readCacheRefreshState(sessionManager, "anthropic");

      expect(state.lastRefreshTimestamp).toBe(1000000);
      expect(state.refreshCount).toBe(1);
      expect(state.provider).toBe("anthropic");
    });

    it("handles session manager without getEntries method", () => {
      const sessionManager = {};

      const state = readCacheRefreshState(sessionManager);

      expect(state).toEqual({
        lastRefreshTimestamp: null,
        refreshCount: 0,
      });
    });
  });

  describe("appendCacheRefreshEntry", () => {
    it("appends refresh entry to session manager", () => {
      const entries: unknown[] = [];
      const sessionManager = {
        appendCustomEntry: (type: string, data: unknown) => {
          entries.push({ type: "custom", customType: type, data });
        },
      };

      const entryData: CacheRefreshEntryData = {
        timestamp: 1000000,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        refreshCount: 1,
      };

      appendCacheRefreshEntry(sessionManager, entryData);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual({
        type: "custom",
        customType: "openclaw.cache-refresh",
        data: entryData,
      });
    });

    it("handles session manager without appendCustomEntry method", () => {
      const sessionManager = {};

      // Should not throw
      expect(() => {
        appendCacheRefreshEntry(sessionManager, {
          timestamp: 1000000,
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
          refreshCount: 1,
        });
      }).not.toThrow();
    });
  });

  describe("hasExceededRefreshLimit", () => {
    it("returns false when count is below limit", () => {
      expect(hasExceededRefreshLimit(5, 10)).toBe(false);
    });

    it("returns true when count equals limit", () => {
      expect(hasExceededRefreshLimit(10, 10)).toBe(true);
    });

    it("returns true when count exceeds limit", () => {
      expect(hasExceededRefreshLimit(15, 10)).toBe(true);
    });

    it("returns false for zero count", () => {
      expect(hasExceededRefreshLimit(0, 10)).toBe(false);
    });
  });

  describe("shouldRefreshCache", () => {
    it("returns false when no previous refresh", () => {
      const result = shouldRefreshCache({
        lastRefreshTimestamp: null,
        cacheTtlMs: 300_000,
        nowMs: 1000000,
      });

      expect(result).toBe(false);
    });

    it("returns false when within TTL", () => {
      const result = shouldRefreshCache({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000, // 5 minutes
        safetyMarginMs: 30_000, // 30 seconds
        nowMs: 1100000, // 100 seconds elapsed
      });

      expect(result).toBe(false);
    });

    it("returns true when approaching TTL expiry", () => {
      const result = shouldRefreshCache({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000, // 5 minutes
        safetyMarginMs: 30_000, // 30 seconds
        nowMs: 1270000 + 1000, // 271 seconds elapsed (> 270s threshold)
      });

      expect(result).toBe(true);
    });

    it("returns true when past TTL expiry", () => {
      const result = shouldRefreshCache({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000, // 5 minutes
        safetyMarginMs: 30_000, // 30 seconds
        nowMs: 1400000, // 400 seconds elapsed
      });

      expect(result).toBe(true);
    });

    it("uses default safety margin when not specified", () => {
      const result = shouldRefreshCache({
        lastRefreshTimestamp: 1000000,
        cacheTtlMs: 300_000, // 5 minutes
        nowMs: 1270000 + 1000, // 271 seconds elapsed
      });

      expect(result).toBe(true);
    });
  });
});
