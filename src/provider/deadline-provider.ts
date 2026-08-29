import type { Profile } from "../domain/profile.js";
import {
  ProviderFetchError,
  type ProfileFetchOptions,
  type ProfileProvider,
} from "./profile-provider.js";

export class DeadlineProvider implements ProfileProvider {
  constructor(
    private readonly inner: ProfileProvider,
    private readonly timeoutMs: number,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new RangeError("Extraction deadline must be a positive integer");
    }
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}): Promise<Profile> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    try {
      return await this.inner.fetch(profileUrl, { signal });
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw new ProviderFetchError("LinkedIn profile retrieval exceeded the overall deadline");
      }
      throw error;
    }
  }
}
