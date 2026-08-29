import type { Profile } from "../domain/profile.js";
import type { ProfileFetchOptions, ProfileProvider } from "./profile-provider.js";

type CacheEntry = {
  expiresAt: number;
  value: Profile;
};

type InFlightEntry = {
  promise: Promise<Profile>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
};

export class CacheProvider implements ProfileProvider {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, InFlightEntry>();

  constructor(
    private readonly inner: ProfileProvider,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 250,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new RangeError("Cache TTL must be a non-negative number");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("Cache maximum entries must be a positive integer");
    }
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}): Promise<Profile> {
    const now = this.now();
    this.pruneExpired(now);
    const cached = this.entries.get(profileUrl);
    if (cached && cached.expiresAt > now) {
      // Refresh insertion order so Map acts as a compact LRU.
      this.entries.delete(profileUrl);
      this.entries.set(profileUrl, cached);
      return cached.value;
    }

    const pending = this.inFlight.get(profileUrl);
    if (pending) return this.consume(pending, options.signal);

    const controller = new AbortController();
    const entry: InFlightEntry = {
      promise: Promise.resolve(undefined as unknown as Profile),
      controller,
      consumers: 0,
      settled: false,
    };
    let upstream: Promise<Profile>;
    try {
      upstream = Promise.resolve(this.inner.fetch(profileUrl, { signal: controller.signal }));
    } catch (error) {
      upstream = Promise.reject(error);
    }
    const request = upstream
      .then((value) => {
        if (this.ttlMs > 0) {
          this.entries.delete(profileUrl);
          while (this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
          }
          this.entries.set(profileUrl, {
            expiresAt: this.now() + this.ttlMs,
            value,
          });
        }
        return value;
      })
      .finally(() => {
        entry.settled = true;
        this.inFlight.delete(profileUrl);
      });
    entry.promise = request;
    this.inFlight.set(profileUrl, entry);
    return this.consume(entry, options.signal);
  }

  private consume(entry: InFlightEntry, signal?: AbortSignal): Promise<Profile> {
    entry.consumers += 1;
    return new Promise<Profile>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        entry.consumers -= 1;
        if (entry.consumers === 0 && !entry.settled) {
          entry.controller.abort(new Error("All callers cancelled the shared extraction"));
        }
      };
      const onAbort = () => {
        cleanup();
        release();
        reject(signal?.reason);
      };
      const cleanup = () => signal?.removeEventListener("abort", onAbort);

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (value) => {
          cleanup();
          release();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          release();
          reject(error);
        },
      );
    });
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
