import type { Profile } from "../domain/profile.js";
import {
  ProviderQuotaExceededError,
  type ProfileFetchOptions,
  type ProfileProvider,
} from "./profile-provider.js";

export class ColdExtractionBudgetProvider implements ProfileProvider {
  private consumed = 0;

  constructor(
    private readonly inner: ProfileProvider,
    private readonly maximum: number,
  ) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new RangeError("Cold-extraction budget must be a positive integer");
    }
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}): Promise<Profile> {
    if (this.consumed >= this.maximum) {
      throw new ProviderQuotaExceededError();
    }
    this.consumed += 1;
    return await this.inner.fetch(profileUrl, options);
  }
}
