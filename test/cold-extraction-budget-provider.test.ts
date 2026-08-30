import { describe, expect, it, vi } from "vitest";
import { CacheProvider } from "../src/provider/cache-provider.js";
import { ColdExtractionBudgetProvider } from "../src/provider/cold-extraction-budget-provider.js";
import { ProviderQuotaExceededError, type ProfileProvider } from "../src/provider/profile-provider.js";

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
});
