import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const currentApiKey = "c".repeat(32);
const previousApiKey = "p".repeat(32);

describe("runtime configuration", () => {
  it("requires an API key unless local unauthenticated mode is explicit", () => {
    expect(() => loadConfig({})).toThrow(/API_KEY is required/);
    const local = loadConfig({ ALLOW_UNAUTHENTICATED_LOCAL: "true" });
    expect(local.apiKey).toBeUndefined();
    expect(local.accessMode).toBe("bearer");
  });

  it("never permits unauthenticated production mode", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      ALLOW_UNAUTHENTICATED_LOCAL: "true",
    })).toThrow(/API_KEY is required/);
  });

  it("permits only an explicit, expiring production public-demo mode", () => {
    const publicDemo = loadConfig({
      NODE_ENV: "production",
      ACCESS_MODE: "public-demo",
      PUBLIC_DEMO_EXPIRES_AT: "2026-09-08T18:29:59Z",
    });
    expect(publicDemo.apiKey).toBeUndefined();
    expect(publicDemo.accessMode).toBe("public-demo");
    expect(publicDemo.publicDemoExpiresAt).toBe(Date.parse("2026-09-08T18:29:59Z"));
    expect(publicDemo.publicDemoPerClientRateLimitMax).toBe(6);
    expect(publicDemo.publicDemoGlobalRateLimitMax).toBe(20);
    expect(publicDemo.publicDemoMaxColdExtractions).toBe(50);

    expect(() => loadConfig({
      NODE_ENV: "production",
      ACCESS_MODE: "public-demo",
    })).toThrow(/PUBLIC_DEMO_EXPIRES_AT/);
    expect(() => loadConfig({
      NODE_ENV: "production",
      ACCESS_MODE: "public-demo",
      PUBLIC_DEMO_EXPIRES_AT: "not-a-date",
    })).toThrow(/PUBLIC_DEMO_EXPIRES_AT/);
    expect(() => loadConfig({
      API_KEY: currentApiKey,
      ACCESS_MODE: "something-else",
    })).toThrow(/ACCESS_MODE/);
  });

  it("rejects weak or duplicate bearer credentials", () => {
    expect(() => loadConfig({ API_KEY: "too-short" })).toThrow(/at least 32/);
    expect(() => loadConfig({
      API_KEY: currentApiKey,
      API_KEY_PREVIOUS: "still-too-short",
    })).toThrow(/API_KEY_PREVIOUS must contain at least 32/);
    expect(() => loadConfig({
      API_KEY: currentApiKey,
      API_KEY_PREVIOUS: currentApiKey,
    })).toThrow(/must differ/);
  });

  it("accepts bounded cache disablement and explicit hardening controls", () => {
    const config = loadConfig({
      API_KEY: currentApiKey,
      CACHE_TTL_SECONDS: "0",
      CACHE_MAX_ENTRIES: "25",
      LINKEDIN_EXTRACTION_TIMEOUT_MS: "24000",
      LINKEDIN_MAX_RESPONSE_BYTES: "2000000",
      LINKEDIN_REQUESTS_PER_MINUTE: "40",
      API_KEY_PREVIOUS: previousApiKey,
    });
    expect(config.cacheTtlMs).toBe(0);
    expect(config.cacheMaxEntries).toBe(25);
    expect(config.linkedinExtractionTimeoutMs).toBe(24_000);
    expect(config.linkedinMaxResponseBytes).toBe(2_000_000);
    expect(config.linkedinRequestsPerMinute).toBe(40);
    expect(config.apiKeyPrevious).toBe(previousApiKey);
  });

  it.each([
    ["PORT", "0"],
    ["CACHE_TTL_SECONDS", "-1"],
    ["CACHE_MAX_ENTRIES", "not-a-number"],
    ["LINKEDIN_MAX_CONCURRENCY", "0"],
    ["LINKEDIN_REQUEST_TIMEOUT_MS", "1.5"],
    ["LINKEDIN_MAX_RESPONSE_BYTES", "1024"],
  ])("rejects an invalid configured value: %s=%s", (name, value) => {
    expect(() => loadConfig({ API_KEY: currentApiKey, [name]: value })).toThrow(RangeError);
  });
});
