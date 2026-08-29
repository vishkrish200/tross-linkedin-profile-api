import type { Profile } from "../domain/profile.js";
import {
  ProviderAuthenticationError,
  ProviderCircuitOpenError,
  ProviderProtectionError,
  type ProfileFetchOptions,
  type ProfileProvider,
} from "./profile-provider.js";

export class CircuitBreakerProvider implements ProfileProvider {
  private openUntil = 0;
  private readonly active = new Set<AbortController>();

  constructor(
    private readonly inner: ProfileProvider,
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(cooldownMs) || cooldownMs < 1) {
      throw new RangeError("Circuit-breaker cooldown must be a positive integer");
    }
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}): Promise<Profile> {
    if (this.openUntil > this.now()) throw new ProviderCircuitOpenError();
    if (this.openUntil) this.openUntil = 0;

    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    this.active.add(controller);
    try {
      return await this.inner.fetch(profileUrl, { signal });
    } catch (error) {
      if (error instanceof ProviderAuthenticationError || error instanceof ProviderProtectionError) {
        this.openUntil = this.now() + this.cooldownMs;
        const circuitError = new ProviderCircuitOpenError();
        for (const active of this.active) {
          if (active !== controller) active.abort(circuitError);
        }
      }
      throw error;
    } finally {
      this.active.delete(controller);
    }
  }
}
