import type { Profile } from "../domain/profile.js";
import {
  ProviderBusyError,
  type ProfileFetchOptions,
  type ProfileProvider,
} from "./profile-provider.js";

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class ConcurrencyProvider implements ProfileProvider {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly inner: ProfileProvider,
    private readonly limit: number,
    private readonly maxQueueSize = Number.MAX_SAFE_INTEGER,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Concurrency limit must be a positive integer");
    }
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 0) {
      throw new RangeError("Queue size must be a non-negative integer");
    }
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}): Promise<Profile> {
    await this.acquire(options.signal);
    try {
      return await this.inner.fetch(profileUrl, options);
    } finally {
      this.release();
    }
  }

  private async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    if (this.waiters.length >= this.maxQueueSize) {
      throw new ProviderBusyError();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason);
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
    });
  }

  private release(): void {
    while (this.waiters.length) {
      const next = this.waiters.shift()!;
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      if (next.signal?.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      next.resolve();
      return;
    }
    this.active -= 1;
  }
}
