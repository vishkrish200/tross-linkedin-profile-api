export type AppConfig = {
  host: string;
  port: number;
  logLevel: string;
  apiKey?: string;
  cacheTtlMs: number;
  rateLimitMax: number;
  rateLimitWindow: string;
  linkedinStorageStatePath?: string;
  linkedinStorageStateBase64?: string;
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
    ...(env.LINKEDIN_STORAGE_STATE_PATH
      ? { linkedinStorageStatePath: env.LINKEDIN_STORAGE_STATE_PATH }
      : {}),
    ...(env.LINKEDIN_STORAGE_STATE_B64
      ? { linkedinStorageStateBase64: env.LINKEDIN_STORAGE_STATE_B64 }
      : {}),
  };
}
