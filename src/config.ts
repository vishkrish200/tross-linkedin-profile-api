export type AppConfig = {
  host: string;
  port: number;
  logLevel: string;
  apiKey?: string;
  cacheTtlMs: number;
  rateLimitMax: number;
  rateLimitWindow: string;
  linkedinCookie?: string;
  linkedinCsrfToken?: string;
  linkedinUserAgent?: string;
  linkedinRequestTimeoutMs: number;
  linkedinMaxConcurrency: number;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST || "0.0.0.0",
    port: positiveInteger(env.PORT, 3000),
    logLevel: env.LOG_LEVEL || "info",
    ...(env.API_KEY ? { apiKey: env.API_KEY } : {}),
    cacheTtlMs: positiveInteger(env.CACHE_TTL_SECONDS, 900) * 1000,
    rateLimitMax: positiveInteger(env.RATE_LIMIT_MAX, 10),
    rateLimitWindow: env.RATE_LIMIT_WINDOW || "1 minute",
    ...(env.LINKEDIN_COOKIE ? { linkedinCookie: env.LINKEDIN_COOKIE } : {}),
    ...(env.LINKEDIN_CSRF_TOKEN ? { linkedinCsrfToken: env.LINKEDIN_CSRF_TOKEN } : {}),
    ...(env.LINKEDIN_USER_AGENT ? { linkedinUserAgent: env.LINKEDIN_USER_AGENT } : {}),
    linkedinRequestTimeoutMs: positiveInteger(env.LINKEDIN_REQUEST_TIMEOUT_MS, 20_000),
    linkedinMaxConcurrency: positiveInteger(env.LINKEDIN_MAX_CONCURRENCY, 2),
  };
}
