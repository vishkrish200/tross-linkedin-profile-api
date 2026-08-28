import type { Profile } from "../domain/profile.js";
import type { ProfileProvider } from "./profile-provider.js";

export class ConcurrencyProvider implements ProfileProvider {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly inner: ProfileProvider,
    private readonly limit: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Concurrency limit must be a positive integer");
    }
  }

  async fetch(profileUrl: string): Promise<Profile> {
    await this.acquire();
    try {
      return await this.inner.fetch(profileUrl);
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.active -= 1;
  }
}
