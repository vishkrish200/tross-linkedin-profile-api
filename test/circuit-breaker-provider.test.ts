import { describe, expect, it, vi } from "vitest";
import type { Profile } from "../src/domain/profile.js";
import { CircuitBreakerProvider } from "../src/provider/circuit-breaker-provider.js";
import { ConcurrencyProvider } from "../src/provider/concurrency-provider.js";
import {
  ProviderAuthenticationError,
  ProviderCircuitOpenError,
  ProviderProtectionError,
  type ProfileFetchOptions,
} from "../src/provider/profile-provider.js";

function profile(sourceUrl: string): Profile {
  return {
    sourceUrl,
    fetchedAt: "2026-08-29T00:00:00.000Z",
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    profileImages: [],
    warnings: [],
  };
}

describe("CircuitBreakerProvider", () => {
  it("opens after a LinkedIn protection signal and blocks later network calls", async () => {
    const inner = { fetch: vi.fn().mockRejectedValue(new ProviderProtectionError()) };
    const breaker = new CircuitBreakerProvider(inner, 60_000);
    const url = "https://www.linkedin.com/in/example/";

    await expect(breaker.fetch(url)).rejects.toBeInstanceOf(ProviderProtectionError);
    await expect(breaker.fetch(url)).rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(inner.fetch).toHaveBeenCalledTimes(1);
  });

  it("also opens after an authentication rejection", async () => {
    const inner = { fetch: vi.fn().mockRejectedValue(new ProviderAuthenticationError()) };
    const breaker = new CircuitBreakerProvider(inner, 60_000);

    await expect(breaker.fetch("https://www.linkedin.com/in/expired/"))
      .rejects.toBeInstanceOf(ProviderAuthenticationError);
    await expect(breaker.fetch("https://www.linkedin.com/in/blocked/"))
      .rejects.toBeInstanceOf(ProviderCircuitOpenError);
    expect(inner.fetch).toHaveBeenCalledTimes(1);
  });

  it("prevents queued extractions from starting after the first protection signal", async () => {
    const inner = { fetch: vi.fn().mockRejectedValue(new ProviderProtectionError()) };
    const provider = new ConcurrencyProvider(
      new CircuitBreakerProvider(inner, 60_000),
      1,
    );

    const results = await Promise.allSettled([
      provider.fetch("https://www.linkedin.com/in/first/"),
      provider.fetch("https://www.linkedin.com/in/second/"),
      provider.fetch("https://www.linkedin.com/in/third/"),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(inner.fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts other active extractions when the circuit opens", async () => {
    let releaseProtection!: () => void;
    const inner = {
      fetch: vi.fn(async (url: string, options: ProfileFetchOptions = {}) => {
        if (url.endsWith("/first/")) {
          await new Promise<void>((resolve) => { releaseProtection = resolve; });
          throw new ProviderProtectionError();
        }
        return await new Promise<Profile>((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      }),
    };
    const provider = new CircuitBreakerProvider(inner, 60_000);
    const first = provider.fetch("https://www.linkedin.com/in/first/");
    const second = provider.fetch("https://www.linkedin.com/in/second/");
    await vi.waitFor(() => expect(inner.fetch).toHaveBeenCalledTimes(2));
    releaseProtection();

    await expect(first).rejects.toBeInstanceOf(ProviderProtectionError);
    await expect(second).rejects.toBeInstanceOf(ProviderCircuitOpenError);
  });

  it("closes after the configured cooldown", async () => {
    let now = 1_000;
    const url = "https://www.linkedin.com/in/example/";
    const inner = {
      fetch: vi.fn()
        .mockRejectedValueOnce(new ProviderProtectionError())
        .mockResolvedValueOnce(profile(url)),
    };
    const breaker = new CircuitBreakerProvider(inner, 500, () => now);
    await expect(breaker.fetch(url)).rejects.toBeInstanceOf(ProviderProtectionError);
    now = 1_501;
    await expect(breaker.fetch(url)).resolves.toEqual(profile(url));
  });
});
