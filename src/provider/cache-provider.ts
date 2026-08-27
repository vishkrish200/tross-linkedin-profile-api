import type { Profile } from "../domain/profile.js";
import type { ProfileProvider } from "./profile-provider.js";

type CacheEntry = {
  expiresAt: number;
  value: Profile;
};

export class CacheProvider implements ProfileProvider {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly inner: ProfileProvider,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async fetch(profileUrl: string): Promise<Profile> {
    const cached = this.entries.get(profileUrl);
    if (cached && cached.expiresAt > this.now()) {
      return cached.value;
    }

    const value = await this.inner.fetch(profileUrl);
    this.entries.set(profileUrl, {
      expiresAt: this.now() + this.ttlMs,
      value,
    });
    return value;
  }
}
