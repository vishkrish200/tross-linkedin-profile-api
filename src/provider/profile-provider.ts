import type { Profile } from "../domain/profile.js";

export type ProfileFetchOptions = {
  signal?: AbortSignal;
};

export interface ProfileProvider {
  fetch(profileUrl: string, options?: ProfileFetchOptions): Promise<Profile>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(message = "The LinkedIn session is not configured") {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderAuthenticationError extends Error {
  constructor(message = "The LinkedIn session is missing, expired, or challenged") {
    super(message);
    this.name = "ProviderAuthenticationError";
  }
}

export class ProviderFetchError extends Error {
  constructor(message = "LinkedIn profile retrieval failed") {
    super(message);
    this.name = "ProviderFetchError";
  }
}

export class ProviderProfileUnavailableError extends Error {
  constructor(message = "LinkedIn profile is unavailable to the configured session") {
    super(message);
    this.name = "ProviderProfileUnavailableError";
  }
}

export class ProviderProtectionError extends ProviderFetchError {
  constructor(message = "LinkedIn rate-limited or challenged the direct request") {
    super(message);
    this.name = "ProviderProtectionError";
  }
}

export class ProviderCircuitOpenError extends ProviderFetchError {
  constructor(message = "LinkedIn requests are paused after a protection signal") {
    super(message);
    this.name = "ProviderCircuitOpenError";
  }
}

export class ProviderQuotaExceededError extends Error {
  constructor(message = "The public demo cold-extraction budget is exhausted") {
    super(message);
    this.name = "ProviderQuotaExceededError";
  }
}

export class ProviderBusyError extends Error {
  constructor(message = "Too many distinct uncached profiles are already being processed") {
    super(message);
    this.name = "ProviderBusyError";
  }
}
