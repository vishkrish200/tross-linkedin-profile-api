import type { Profile } from "../domain/profile.js";
import type { ProfileProvider } from "./profile-provider.js";

type CacheEntry = {
  expiresAt: number;
  value: Profile;
};

export class CacheProvider implements ProfileProvider {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<Profile>>();

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

    const pending = this.inFlight.get(profileUrl);
    if (pending) return pending;

    const request = this.inner.fetch(profileUrl)
      .then((value) => {
        this.entries.set(profileUrl, {
          expiresAt: this.now() + this.ttlMs,
          value,
        });
        return value;
      })
      .finally(() => {
        this.inFlight.delete(profileUrl);
      });
    this.inFlight.set(profileUrl, request);
    return request;
  }
}
