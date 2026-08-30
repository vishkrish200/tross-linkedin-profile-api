import { describe, expect, it, vi } from "vitest";
import { CacheProvider } from "../src/provider/cache-provider.js";
import { CircuitBreakerProvider } from "../src/provider/circuit-breaker-provider.js";
import { ColdExtractionBudgetProvider } from "../src/provider/cold-extraction-budget-provider.js";
import { ConcurrencyProvider } from "../src/provider/concurrency-provider.js";
import {
  ProviderBusyError,
  ProviderCircuitOpenError,
  ProviderProtectionError,
  ProviderQuotaExceededError,
  type ProfileProvider,
} from "../src/provider/profile-provider.js";

const profile = (sourceUrl: string) => ({
  sourceUrl,
  fetchedAt: "2026-08-30T00:00:00.000Z",
  name: "Test Person",
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  languages: [],
  profileImages: [],
  warnings: [],
});

describe("ColdExtractionBudgetProvider", () => {
  it("rejects work after the configured cold-extraction budget is consumed", async () => {
    const inner: ProfileProvider = { fetch: vi.fn(async (url) => profile(url)) };
    const provider = new ColdExtractionBudgetProvider(inner, 2);

    await expect(provider.fetch("https://www.linkedin.com/in/one/")).resolves.toMatchObject({
      name: "Test Person",
    });
    await expect(provider.fetch("https://www.linkedin.com/in/two/")).resolves.toMatchObject({
      name: "Test Person",
    });
    await expect(provider.fetch("https://www.linkedin.com/in/three/"))
      .rejects.toBeInstanceOf(ProviderQuotaExceededError);
    expect(inner.fetch).toHaveBeenCalledTimes(2);
  });

  it("counts cache misses rather than repeated HTTP consumers", async () => {
    const inner: ProfileProvider = { fetch: vi.fn(async (url) => profile(url)) };
    const budgeted = new ColdExtractionBudgetProvider(inner, 1);
    const provider = new CacheProvider(budgeted, 60_000);

    await expect(provider.fetch("https://www.linkedin.com/in/one/"))
      .resolves.toMatchObject({ name: "Test Person" });
    await expect(provider.fetch("https://www.linkedin.com/in/one/"))
      .resolves.toMatchObject({ name: "Test Person" });
    await expect(provider.fetch("https://www.linkedin.com/in/two/"))
      .rejects.toBeInstanceOf(ProviderQuotaExceededError);
    expect(inner.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid budgets", () => {
    const inner: ProfileProvider = { fetch: async (url) => profile(url) };
    expect(() => new ColdExtractionBudgetProvider(inner, 0)).toThrow(RangeError);
  });

  it("does not spend cold-extraction credits on rejected queue overflow", async () => {
    const completions: Array<() => void> = [];
    const inner: ProfileProvider = {
      fetch: vi.fn((url: string) => new Promise<ReturnType<typeof profile>>((resolve) => {
        completions.push(() => resolve(profile(url)));
      })),
    };
    const budgeted = new ColdExtractionBudgetProvider(inner, 5);
    const limited = new ConcurrencyProvider(budgeted, 1, 4);
    const provider = new CacheProvider(limited, 60_000);
    const requests = Array.from({ length: 100 }, (_, index) =>
      provider.fetch(`https://www.linkedin.com/in/burst-${index}/`).then(
        () => "fulfilled" as const,
        (error: unknown) => error,
      ));

    for (let index = 0; index < 5; index += 1) {
      await vi.waitFor(() => expect(completions).toHaveLength(1));
      completions.shift()?.();
    }

    const results = await Promise.all(requests);
    expect(results.filter((result) => result === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result instanceof ProviderBusyError)).toHaveLength(95);
    await expect(provider.fetch("https://www.linkedin.com/in/after-budget/"))
      .rejects.toBeInstanceOf(ProviderQuotaExceededError);
    expect(inner.fetch).toHaveBeenCalledTimes(5);
  });

  it("does not spend cold-extraction credits while the circuit is open", async () => {
    let now = 1_000;
    const inner: ProfileProvider = {
      fetch: vi.fn()
        .mockRejectedValueOnce(new ProviderProtectionError())
        .mockImplementation(async (url: string) => profile(url)),
    };
    const budgeted = new ColdExtractionBudgetProvider(inner, 2);
    const provider = new CircuitBreakerProvider(budgeted, 1_000, () => now);

    await expect(provider.fetch("https://www.linkedin.com/in/one/"))
      .rejects.toBeInstanceOf(ProviderProtectionError);
    for (let index = 0; index < 10; index += 1) {
      await expect(provider.fetch(`https://www.linkedin.com/in/open-${index}/`))
        .rejects.toBeInstanceOf(ProviderCircuitOpenError);
    }
    now = 2_001;
    await expect(provider.fetch("https://www.linkedin.com/in/two/"))
      .resolves.toMatchObject({ name: "Test Person" });
    expect(inner.fetch).toHaveBeenCalledTimes(2);
  });
});
