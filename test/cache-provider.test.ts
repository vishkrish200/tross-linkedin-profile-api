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
      fetch: vi.fn((_sourceUrl: string) => new Promise<Profile>((resolve) => {
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

  it("evicts the least recently used entry at the configured bound", async () => {
    const inner = { fetch: vi.fn(async (url: string) => profile(url)) };
    const cache = new CacheProvider(inner, 60_000, Date.now, 2);
    const first = "https://www.linkedin.com/in/first/";
    const second = "https://www.linkedin.com/in/second/";
    const third = "https://www.linkedin.com/in/third/";

    await cache.fetch(first);
    await cache.fetch(second);
    await cache.fetch(first);
    await cache.fetch(third);
    await cache.fetch(second);

    expect(inner.fetch).toHaveBeenCalledTimes(4);
  });

  it("remains bounded across a large stream of unique profile slugs", async () => {
    const inner = { fetch: vi.fn(async (url: string) => profile(url)) };
    const cache = new CacheProvider(inner, 60_000, Date.now, 32);
    const urls = Array.from({ length: 1_000 }, (_, index) =>
      `https://www.linkedin.com/in/profile-${index}/`);

    for (const url of urls) await cache.fetch(url);
    await cache.fetch(urls.at(-1)!);
    expect(inner.fetch).toHaveBeenCalledTimes(1_000);
    await cache.fetch(urls[0]!);
    expect(inner.fetch).toHaveBeenCalledTimes(1_001);
  });

  it("can disable completed-result caching while retaining in-flight coalescing", async () => {
    let complete!: (value: Profile) => void;
    const url = "https://www.linkedin.com/in/no-cache/";
    const inner = {
      fetch: vi.fn(() => new Promise<Profile>((resolve) => {
        complete = resolve;
      })),
    };
    const cache = new CacheProvider(inner, 0);
    const first = cache.fetch(url);
    const second = cache.fetch(url);
    complete(profile(url));
    await Promise.all([first, second]);
    expect(inner.fetch).toHaveBeenCalledTimes(1);

    const third = cache.fetch(url);
    complete(profile(url));
    await third;
    expect(inner.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid cache bounds", () => {
    const inner = { fetch: vi.fn() };
    expect(() => new CacheProvider(inner, -1)).toThrow(RangeError);
    expect(() => new CacheProvider(inner, 1, Date.now, 0)).toThrow(RangeError);
  });

  it("keeps shared work alive when only one coalesced caller cancels", async () => {
    let complete!: (value: Profile) => void;
    let upstreamSignal!: AbortSignal;
    const url = "https://www.linkedin.com/in/shared/";
    const inner = {
      fetch: vi.fn((_url: string, options = {}) => new Promise<Profile>((resolve) => {
        upstreamSignal = (options as { signal: AbortSignal }).signal;
        complete = resolve;
      })),
    };
    const cache = new CacheProvider(inner, 60_000);
    const firstController = new AbortController();
    const first = cache.fetch(url, { signal: firstController.signal });
    const second = cache.fetch(url);
    await vi.waitFor(() => expect(inner.fetch).toHaveBeenCalledTimes(1));
    firstController.abort(new Error("first caller left"));
    await expect(first).rejects.toThrow("first caller left");
    expect(upstreamSignal.aborted).toBe(false);
    complete(profile(url));
    await expect(second).resolves.toEqual(profile(url));
  });

  it("aborts shared work after every coalesced caller cancels", async () => {
    let upstreamSignal!: AbortSignal;
    const url = "https://www.linkedin.com/in/cancelled/";
    const inner = {
      fetch: vi.fn((_url: string, options = {}) => new Promise<Profile>((_resolve, reject) => {
        upstreamSignal = (options as { signal: AbortSignal }).signal;
        upstreamSignal.addEventListener("abort", () => reject(upstreamSignal.reason), { once: true });
      })),
    };
    const cache = new CacheProvider(inner, 60_000);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = cache.fetch(url, { signal: firstController.signal });
    const second = cache.fetch(url, { signal: secondController.signal });
    await vi.waitFor(() => expect(inner.fetch).toHaveBeenCalledTimes(1));
    firstController.abort(new Error("first left"));
    secondController.abort(new Error("second left"));
    await expect(first).rejects.toThrow("first left");
    await expect(second).rejects.toThrow("second left");
    expect(upstreamSignal.aborted).toBe(true);
  });
});
