import { buildApp } from "./app.js";
import { loadConfig, type AppConfig } from "./config.js";
import { LinkedInProfileProvider } from "./linkedin/profile-provider.js";
import { LinkedInRequestLimiter } from "./linkedin/request-limiter.js";
import { buildLoggerOptions } from "./logging.js";
import { CacheProvider } from "./provider/cache-provider.js";
import { CircuitBreakerProvider } from "./provider/circuit-breaker-provider.js";
import { ColdExtractionBudgetProvider } from "./provider/cold-extraction-budget-provider.js";
import { ConcurrencyProvider } from "./provider/concurrency-provider.js";
import { DeadlineProvider } from "./provider/deadline-provider.js";
import type { ProfileProvider } from "./provider/profile-provider.js";

function buildProfileProvider(config: AppConfig): ProfileProvider {
  const requestLimiter = new LinkedInRequestLimiter(
    config.linkedinRequestsPerMinute,
    60_000,
    config.linkedinMinRequestIntervalMs,
  );
  const linkedInProvider = new LinkedInProfileProvider({
    ...(config.linkedinCookie ? { cookie: config.linkedinCookie } : {}),
    ...(config.linkedinCsrfToken ? { csrfToken: config.linkedinCsrfToken } : {}),
    ...(config.linkedinUserAgent ? { userAgent: config.linkedinUserAgent } : {}),
    requestTimeoutMs: config.linkedinRequestTimeoutMs,
    maxResponseBytes: config.linkedinMaxResponseBytes,
    requestLimiter,
  });
  const budgetLimitedProvider = config.accessMode === "public-demo"
    ? new ColdExtractionBudgetProvider(
        linkedInProvider,
        config.publicDemoMaxColdExtractions,
      )
    : linkedInProvider;
  // Keep the breaker outside the budget so open-circuit rejections do not
  // consume cold-extraction credits without reaching LinkedIn.
  const circuitProtectedProvider = new CircuitBreakerProvider(
    budgetLimitedProvider,
    config.linkedinBreakerCooldownMs,
  );
  const concurrencyLimitedProvider = new ConcurrencyProvider(
    circuitProtectedProvider,
    config.linkedinMaxConcurrency,
    config.linkedinMaxQueueSize,
  );
  const deadlineLimitedProvider = new DeadlineProvider(
    concurrencyLimitedProvider,
    config.linkedinExtractionTimeoutMs,
  );
  return new CacheProvider(
    deadlineLimitedProvider,
    config.cacheTtlMs,
    Date.now,
    config.cacheMaxEntries,
  );
}

const config = loadConfig();
const profileProvider = buildProfileProvider(config);
const app = await buildApp({
  provider: profileProvider,
  accessMode: config.accessMode === "public-demo"
    || (!config.apiKey && config.allowUnauthenticatedLocal)
    ? "public-demo"
    : "bearer",
  apiKeys: [config.apiKey, config.apiKeyPrevious]
    .filter((value): value is string => Boolean(value)),
  logger: buildLoggerOptions(config.logLevel),
  bodyLimit: config.requestBodyLimitBytes,
  rateLimitMax: config.rateLimitMax,
  unauthorizedRateLimitMax: config.unauthorizedRateLimitMax,
  rateLimitWindow: config.rateLimitWindow,
  ...(config.publicDemoExpiresAt !== undefined
    ? { publicDemoExpiresAt: config.publicDemoExpiresAt }
    : {}),
  publicDemoPerClientRateLimitMax: config.publicDemoPerClientRateLimitMax,
  publicDemoGlobalRateLimitMax: config.publicDemoGlobalRateLimitMax,
  publicDemoRateLimitWindow: config.publicDemoRateLimitWindow,
  publicDemoMaxColdExtractions: config.publicDemoMaxColdExtractions,
  maxQueuedDistinctProfiles: config.linkedinMaxQueueSize,
  revision: process.env.K_REVISION ?? process.env.GIT_SHA ?? "local",
});

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Graceful shutdown started");
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error, signal }, "Graceful shutdown failed");
    process.exitCode = 1;
  }
};
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
