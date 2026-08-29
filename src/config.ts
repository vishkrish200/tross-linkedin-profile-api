export type AppConfig = {
  host: string;
  port: number;
  logLevel: string;
  apiKey?: string;
  apiKeyPrevious?: string;
  allowUnauthenticatedLocal: boolean;
  requestBodyLimitBytes: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  rateLimitMax: number;
  unauthorizedRateLimitMax: number;
  rateLimitWindow: string;
  linkedinCookie?: string;
  linkedinCsrfToken?: string;
  linkedinUserAgent?: string;
  linkedinRequestTimeoutMs: number;
  linkedinMaxResponseBytes: number;
  linkedinExtractionTimeoutMs: number;
  linkedinMaxConcurrency: number;
  linkedinBreakerCooldownMs: number;
  linkedinRequestsPerMinute: number;
  linkedinMinRequestIntervalMs: number;
};

function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiKey = env.API_KEY?.trim() ? env.API_KEY : undefined;
  const apiKeyPrevious = env.API_KEY_PREVIOUS?.trim() ? env.API_KEY_PREVIOUS : undefined;
  const allowUnauthenticatedLocal = env.ALLOW_UNAUTHENTICATED_LOCAL === "true";
  if (!apiKey && (!allowUnauthenticatedLocal || env.NODE_ENV === "production")) {
    throw new Error(
      "API_KEY is required; set ALLOW_UNAUTHENTICATED_LOCAL=true only for local development",
    );
  }

  return {
    host: env.HOST || "0.0.0.0",
    port: integer(env, "PORT", 3000, 1, 65_535),
    logLevel: env.LOG_LEVEL || "info",
    ...(apiKey ? { apiKey } : {}),
    ...(apiKeyPrevious ? { apiKeyPrevious } : {}),
    allowUnauthenticatedLocal,
    requestBodyLimitBytes: integer(env, "REQUEST_BODY_LIMIT_BYTES", 8_192, 1_024, 65_536),
    cacheTtlMs: integer(env, "CACHE_TTL_SECONDS", 900, 0, 86_400) * 1000,
    cacheMaxEntries: integer(env, "CACHE_MAX_ENTRIES", 250, 1, 10_000),
    rateLimitMax: integer(env, "RATE_LIMIT_MAX", 10, 1, 10_000),
    unauthorizedRateLimitMax: integer(env, "UNAUTHORIZED_RATE_LIMIT_MAX", 30, 1, 10_000),
    rateLimitWindow: env.RATE_LIMIT_WINDOW || "1 minute",
    ...(env.LINKEDIN_COOKIE ? { linkedinCookie: env.LINKEDIN_COOKIE } : {}),
    ...(env.LINKEDIN_CSRF_TOKEN ? { linkedinCsrfToken: env.LINKEDIN_CSRF_TOKEN } : {}),
    ...(env.LINKEDIN_USER_AGENT ? { linkedinUserAgent: env.LINKEDIN_USER_AGENT } : {}),
    linkedinRequestTimeoutMs: integer(env, "LINKEDIN_REQUEST_TIMEOUT_MS", 20_000, 250, 120_000),
    linkedinMaxResponseBytes: integer(
      env,
      "LINKEDIN_MAX_RESPONSE_BYTES",
      5_000_000,
      65_536,
      20_000_000,
    ),
    linkedinExtractionTimeoutMs: integer(
      env,
      "LINKEDIN_EXTRACTION_TIMEOUT_MS",
      25_000,
      1_000,
      120_000,
    ),
    linkedinMaxConcurrency: integer(env, "LINKEDIN_MAX_CONCURRENCY", 2, 1, 20),
    linkedinBreakerCooldownMs: integer(
      env,
      "LINKEDIN_BREAKER_COOLDOWN_SECONDS",
      900,
      1,
      86_400,
    ) * 1000,
    linkedinRequestsPerMinute: integer(env, "LINKEDIN_REQUESTS_PER_MINUTE", 60, 1, 600),
    linkedinMinRequestIntervalMs: integer(
      env,
      "LINKEDIN_MIN_REQUEST_INTERVAL_MS",
      100,
      0,
      60_000,
    ),
  };
}
