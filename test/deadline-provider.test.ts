import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/domain/profile.js";
import { ConcurrencyProvider } from "../src/provider/concurrency-provider.js";
import { DeadlineProvider } from "../src/provider/deadline-provider.js";
import type { ProfileFetchOptions } from "../src/provider/profile-provider.js";

function profile(sourceUrl: string): Profile {
  return {
    sourceUrl,
    fetchedAt: "2026-08-29T00:00:00.000Z",
    experience: [], education: [], skills: [], certifications: [], languages: [],
    profileImages: [], warnings: [],
  };
}

describe("DeadlineProvider", () => {
  it("enforces one deadline and aborts the underlying extraction", async () => {
    const inner = {
      fetch: vi.fn((_url: string, options: ProfileFetchOptions = {}) =>
        new Promise<Profile>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        })),
    };
    const provider = new DeadlineProvider(inner, 10);
    await expect(provider.fetch("https://www.linkedin.com/in/slow/"))
      .rejects.toThrow("exceeded the overall deadline");
    expect(inner.fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("cancels a request while it is waiting for a concurrency slot", async () => {
    let finishFirst!: () => void;
    const inner = {
      fetch: vi.fn((url: string) => new Promise<Profile>((resolve) => {
        finishFirst = () => resolve(profile(url));
      })),
    };
    const provider = new DeadlineProvider(new ConcurrencyProvider(inner, 1), 15);
    const first = provider.fetch("https://www.linkedin.com/in/first/");
    const second = provider.fetch("https://www.linkedin.com/in/second/");
    await expect(second).rejects.toThrow("exceeded the overall deadline");
    expect(inner.fetch).toHaveBeenCalledTimes(1);
    finishFirst();
    await expect(first).resolves.toEqual(profile("https://www.linkedin.com/in/first/"));
  });

  it("rejects invalid deadlines", () => {
    expect(() => new DeadlineProvider({ fetch: vi.fn() }, 0)).toThrow(RangeError);
  });
});
