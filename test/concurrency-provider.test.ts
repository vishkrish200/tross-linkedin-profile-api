import { setImmediate } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/domain/profile.js";
import { ConcurrencyProvider } from "../src/provider/concurrency-provider.js";

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
  });
});
