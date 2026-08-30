import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/domain/profile.js";
import { ConcurrencyProvider } from "../src/provider/concurrency-provider.js";
import { ProviderBusyError } from "../src/provider/profile-provider.js";

function profile(sourceUrl: string): Profile {
  return {
    sourceUrl,
    fetchedAt: "2026-08-28T00:00:00.000Z",
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    profileImages: [],
    warnings: [],
  };
}

describe("ConcurrencyProvider", () => {
  it("runs no more than the configured number of upstream requests", async () => {
    let active = 0;
    let maximumActive = 0;
    const completions: Array<() => void> = [];
    const inner = {
      fetch: vi.fn((sourceUrl: string) => new Promise<Profile>((resolve) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        completions.push(() => {
          active -= 1;
          resolve(profile(sourceUrl));
        });
      })),
    };
    const limited = new ConcurrencyProvider(inner, 2);
    const requests = Array.from({ length: 5 }, (_, index) =>
      limited.fetch(`https://www.linkedin.com/in/example-${index}/`));

    await setImmediate();
    expect(inner.fetch).toHaveBeenCalledTimes(2);
    completions.splice(0, 2).forEach((complete) => complete());

    await setImmediate();
    expect(inner.fetch).toHaveBeenCalledTimes(4);
    completions.splice(0, 2).forEach((complete) => complete());

    await setImmediate();
    expect(inner.fetch).toHaveBeenCalledTimes(5);
    completions.splice(0, 1).forEach((complete) => complete());

    await expect(Promise.all(requests)).resolves.toHaveLength(5);
    expect(maximumActive).toBe(2);
  });

  it("releases a slot when the upstream request fails", async () => {
    const url = "https://www.linkedin.com/in/example/";
    const inner = {
      fetch: vi.fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce(profile(url)),
    };
    const limited = new ConcurrencyProvider(inner, 1);

    const first = limited.fetch(url);
    const second = limited.fetch(url);
    await expect(first).rejects.toThrow("temporary failure");
    await expect(second).resolves.toEqual(profile(url));
    expect(inner.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid concurrency limits", () => {
    const inner = { fetch: vi.fn() };
    expect(() => new ConcurrencyProvider(inner, 0)).toThrow(RangeError);
    expect(() => new ConcurrencyProvider(inner, 1.5)).toThrow(RangeError);
    expect(() => new ConcurrencyProvider(inner, 1, -1)).toThrow(RangeError);
  });

  it("bounds the distinct-profile queue and releases capacity in FIFO order", async () => {
    const completions: Array<() => void> = [];
    const inner = {
      fetch: vi.fn((url: string) => new Promise<Profile>((resolve) => {
        completions.push(() => resolve(profile(url)));
      })),
    };
    const limited = new ConcurrencyProvider(inner, 1, 2);
    const first = limited.fetch("https://www.linkedin.com/in/first/");
    const second = limited.fetch("https://www.linkedin.com/in/second/");
    const third = limited.fetch("https://www.linkedin.com/in/third/");

    await expect(limited.fetch("https://www.linkedin.com/in/overflow/"))
      .rejects.toBeInstanceOf(ProviderBusyError);
    expect(inner.fetch).toHaveBeenCalledTimes(1);

    completions.shift()?.();
    await setImmediate();
    expect(inner.fetch).toHaveBeenCalledTimes(2);
    completions.shift()?.();
    await setImmediate();
    expect(inner.fetch).toHaveBeenCalledTimes(3);
    completions.shift()?.();
    await expect(Promise.all([first, second, third])).resolves.toHaveLength(3);
  });

  it("admits only active plus queued capacity from a 100-profile burst", async () => {
    const completions: Array<() => void> = [];
    const inner = {
      fetch: vi.fn((url: string) => new Promise<Profile>((resolve) => {
        completions.push(() => resolve(profile(url)));
      })),
    };
    const limited = new ConcurrencyProvider(inner, 1, 4);
    const requests = Array.from({ length: 100 }, (_, index) =>
      limited.fetch(`https://www.linkedin.com/in/burst-${index}/`).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ));

    for (let index = 0; index < 5; index += 1) {
      await setImmediate();
      expect(completions).toHaveLength(1);
      completions.shift()?.();
    }

    const results = await Promise.all(requests);
    expect(inner.fetch).toHaveBeenCalledTimes(5);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(5);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(95);
    expect(rejected.every(({ reason }) => reason instanceof ProviderBusyError)).toBe(true);
  });

  it("removes an aborted waiter without consuming a slot", async () => {
    let finish!: () => void;
    const url = "https://www.linkedin.com/in/example/";
    const inner = {
      fetch: vi.fn(() => new Promise<Profile>((resolve) => {
        finish = () => resolve(profile(url));
      })),
    };
    const limited = new ConcurrencyProvider(inner, 1);
    const first = limited.fetch(url);
    const controller = new AbortController();
    const waiting = limited.fetch("https://www.linkedin.com/in/waiting/", {
      signal: controller.signal,
    });
    controller.abort(new Error("cancelled"));
    await expect(waiting).rejects.toThrow("cancelled");
    finish();
    await first;
    expect(inner.fetch).toHaveBeenCalledTimes(1);
  });

  it("starts distinct queued profiles in FIFO order", async () => {
    const started: string[] = [];
    const completions: Array<() => void> = [];
    const inner = {
      fetch: vi.fn((url: string) => new Promise<Profile>((resolve) => {
        started.push(url);
        completions.push(() => resolve(profile(url)));
      })),
    };
    const limited = new ConcurrencyProvider(inner, 1);
    const urls = ["first", "second", "third"].map((slug) =>
      `https://www.linkedin.com/in/${slug}/`);
    const requests = urls.map((url) => limited.fetch(url));

    await setImmediate();
    expect(started).toEqual(urls.slice(0, 1));
    completions.shift()?.();
    await setImmediate();
    expect(started).toEqual(urls.slice(0, 2));
    completions.shift()?.();
    await setImmediate();
    expect(started).toEqual(urls);
    completions.shift()?.();
    await Promise.all(requests);
  });
});
