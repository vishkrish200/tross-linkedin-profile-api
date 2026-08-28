import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/domain/profile.js";
import { CacheProvider } from "../src/provider/cache-provider.js";

function profile(sourceUrl: string, fetchedAt = "2026-08-28T00:00:00.000Z"): Profile {
  return {
    sourceUrl,
    fetchedAt,
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    profileImages: [],
    warnings: [],
  };
}

describe("CacheProvider", () => {
  it("coalesces simultaneous misses for the same profile", async () => {
    let complete!: (value: Profile) => void;
    const inner = {
      fetch: vi.fn((sourceUrl: string) => new Promise<Profile>((resolve) => {
        complete = resolve;
      })),
    };
    const cache = new CacheProvider(inner, 60_000);
    const url = "https://www.linkedin.com/in/example/";

    const requests = Array.from({ length: 10 }, () => cache.fetch(url));
    expect(inner.fetch).toHaveBeenCalledTimes(1);
    complete(profile(url));

    await expect(Promise.all(requests)).resolves.toHaveLength(10);
    await cache.fetch(url);
    expect(inner.fetch).toHaveBeenCalledTimes(1);
  });

  it("expires completed entries and fetches them again", async () => {
    let now = 1_000;
    const url = "https://www.linkedin.com/in/example/";
    const inner = {
      fetch: vi.fn(async () => profile(url, new Date(now).toISOString())),
    };
    const cache = new CacheProvider(inner, 500, () => now);

    await cache.fetch(url);
    await cache.fetch(url);
    expect(inner.fetch).toHaveBeenCalledTimes(1);

    now = 1_501;
    await cache.fetch(url);
    expect(inner.fetch).toHaveBeenCalledTimes(2);
  });

  it("clears a rejected in-flight request so it can be retried", async () => {
    const url = "https://www.linkedin.com/in/example/";
    const inner = {
      fetch: vi.fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce(profile(url)),
    };
    const cache = new CacheProvider(inner, 60_000);

    await expect(Promise.all([
      cache.fetch(url),
      cache.fetch(url),
    ])).rejects.toThrow("temporary failure");
    await expect(cache.fetch(url)).resolves.toEqual(profile(url));
    expect(inner.fetch).toHaveBeenCalledTimes(2);
  });
});
