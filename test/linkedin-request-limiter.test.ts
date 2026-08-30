import { describe, expect, it } from "vitest";
import { LinkedInRequestLimiter } from "../src/linkedin/request-limiter.js";

describe("LinkedInRequestLimiter", () => {
  it("enforces both minimum spacing and a rolling request window", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new LinkedInRequestLimiter(
      2,
      1_000,
      100,
      () => now,
      async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    );

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(waits).toEqual([100, 900]);
  });

  it("honors cancellation while waiting", async () => {
    const controller = new AbortController();
    const limiter = new LinkedInRequestLimiter(
      1,
      1_000,
      0,
      () => 0,
      async (_milliseconds, signal) => await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    );
    await limiter.acquire();
    const waiting = limiter.acquire(controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(waiting).rejects.toThrow("cancelled");
  });

  it("honors cancellation while queued behind another limiter waiter", async () => {
    let now = 0;
    let releaseWait!: () => void;
    const limiter = new LinkedInRequestLimiter(
      1,
      1_000,
      0,
      () => now,
      async () => await new Promise<void>((resolve) => { releaseWait = resolve; }),
    );
    await limiter.acquire();
    const holding = limiter.acquire();
    const controller = new AbortController();
    const queued = limiter.acquire(controller.signal);
    controller.abort(new Error("left limiter queue"));

    await expect(queued).rejects.toThrow("left limiter queue");
    now = 1_001;
    releaseWait();
    await holding;
    now = 2_002;
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });

  it("rejects invalid limits", () => {
    expect(() => new LinkedInRequestLimiter(0)).toThrow(RangeError);
    expect(() => new LinkedInRequestLimiter(1, 0)).toThrow(RangeError);
    expect(() => new LinkedInRequestLimiter(1, 1_000, -1)).toThrow(RangeError);
  });
});
