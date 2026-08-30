import { setTimeout as delay } from "node:timers/promises";

type Wait = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

const defaultWait: Wait = async (milliseconds, signal) => {
  await delay(milliseconds, undefined, signal ? { signal } : undefined);
};

export class LinkedInRequestLimiter {
  private readonly starts: number[] = [];
  private lock: Promise<void> = Promise.resolve();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs = 60_000,
    private readonly minimumIntervalMs = 0,
    private readonly now: () => number = Date.now,
    private readonly wait: Wait = defaultWait,
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1) {
      throw new RangeError("Upstream request limit must be a positive integer");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1) {
      throw new RangeError("Upstream request window must be a positive integer");
    }
    if (!Number.isInteger(minimumIntervalMs) || minimumIntervalMs < 0) {
      throw new RangeError("Upstream request interval must be a non-negative integer");
    }
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    let release!: () => void;
    const previous = this.lock;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    let ownsTurn = false;

    try {
      await this.waitForTurn(previous, signal);
      ownsTurn = true;
      while (true) {
        if (signal?.aborted) throw signal.reason;
        const now = this.now();
        while (this.starts.length && this.starts[0]! <= now - this.windowMs) {
          this.starts.shift();
        }
        const intervalWait = this.starts.length
          ? Math.max(0, this.starts.at(-1)! + this.minimumIntervalMs - now)
          : 0;
        const windowWait = this.starts.length >= this.maxRequests
          ? Math.max(0, this.starts[0]! + this.windowMs - now)
          : 0;
        const waitMs = Math.max(intervalWait, windowWait);
        if (waitMs === 0) {
          this.starts.push(now);
          return;
        }
        await this.wait(waitMs, signal);
      }
    } finally {
      if (ownsTurn) {
        release();
      } else {
        // Preserve queue ordering even though the cancelled caller is allowed
        // to return immediately to its client.
        void previous.then(release);
      }
    }
  }

  private async waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) return await previous;
    if (signal.aborted) throw signal.reason;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      void previous.then(() => {
        cleanup();
        resolve();
      });
    });
  }
}
