import type { Profile } from "../domain/profile.js";

export interface ProfileProvider {
  fetch(profileUrl: string): Promise<Profile>;
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
