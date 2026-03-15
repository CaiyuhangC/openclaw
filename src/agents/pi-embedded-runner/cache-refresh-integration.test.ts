import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import {
  checkCacheRefreshNeeded,
  performPreRequestCacheRefresh,
  recordCacheRefresh,
} from "./cache-refresh-integration.js";

describe("cache-refresh-integration", () => {
  describe("checkCacheRefreshNeeded", () => {
    it("returns disabled when auto-refresh is not enabled", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: false,
            },
          },
        },
      } as OpenClawConfig;

      const result = checkCacheRefreshNeeded({
        cfg,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.reason).toBe("disabled");
    });

    it("returns not-eligible for non-caching provider", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: true,
            },
          },
        },
      } as OpenClawConfig;

      const result = checkCacheRefreshNeeded({
        cfg,
        provider: "openai",
        modelId: "gpt-4",
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.reason).toBe("not-eligible");
    });

    it("returns limit-exceeded when refresh count is at limit", () => {
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
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 1900000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: 2200000,
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
        ],
      };

      const result = checkCacheRefreshNeeded({
        cfg,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        sessionManager,
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.reason).toBe("limit-exceeded");
      expect(result.refreshCount).toBe(5);
      expect(result.maxRefreshCount).toBe(5);
    });

    it("returns too-early when cache has not expired", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: true,
              maxRefreshCount: 10,
            },
          },
        },
      } as OpenClawConfig;

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

      const result = checkCacheRefreshNeeded({
        cfg,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        sessionManager,
        nowMs: 1100000, // 100 seconds later, still within TTL
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.reason).toBe("too-early");
    });

    it("returns should refresh when conditions are met", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: true,
              maxRefreshCount: 10,
            },
          },
        },
      } as OpenClawConfig;

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

      const result = checkCacheRefreshNeeded({
        cfg,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        sessionManager,
        nowMs: 1271000, // 271 seconds later, approaching expiry
      });

      expect(result.shouldRefresh).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.refreshCount).toBe(1);
      expect(result.maxRefreshCount).toBe(10);
    });
  });

  describe("recordCacheRefresh", () => {
    it("appends refresh entry and cache TTL timestamp", () => {
      const entries: unknown[] = [];
      const sessionManager = {
        appendCustomEntry: (type: string, data: unknown) => {
          entries.push({ type: "custom", customType: type, data });
        },
      };

      recordCacheRefresh({
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        sessionManager,
        nowMs: 1000000,
      });

      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        customType: "openclaw.cache-refresh",
        data: {
          timestamp: 1000000,
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
          refreshCount: 1,
        },
      });
      expect(entries[1]).toMatchObject({
        customType: "openclaw.cache-ttl",
        data: {
          timestamp: 1000000,
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        },
      });
    });
  });

  describe("performPreRequestCacheRefresh", () => {
    it("returns false when refresh is not needed", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: false,
            },
          },
        },
      } as OpenClawConfig;

      const result = performPreRequestCacheRefresh({
        cfg,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
      });

      expect(result).toBe(false);
    });

    it("returns true and records refresh when conditions are met", () => {
      const cfg: OpenClawConfig = {
        agents: {
          defaults: {
            cacheAutoRefresh: {
              enabled: true,
              maxRefreshCount: 10,
            },
          },
        },
      } as OpenClawConfig;

      const entries: unknown[] = [];
      const sessionManager = {
        getEntries: () => [
          {
            type: "custom",
            customType: "openclaw.cache-refresh",
            data: {
              timestamp: Date.now() - 271_000, // 271 seconds ago
              provider: "anthropic",
              modelId: "claude-3-5-sonnet-20241022",
              refreshCount: 1,
            },
          },
        ],
        appendCustomEntry: (type: string, data: unknown) => {
          entries.push({ type: "custom", customType: type, data });
        },
      };

      const result = performPreRequestCacheRefresh({
        cfg,
        provider: "anthropic",
        modelId: "claude-3-5-sonnet-20241022",
        sessionManager,
      });

      expect(result).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
