import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { buildLoggerOptions } from "./logging.js";
import { CacheProvider } from "./provider/cache-provider.js";
import { CircuitBreakerProvider } from "./provider/circuit-breaker-provider.js";
import { ColdExtractionBudgetProvider } from "./provider/cold-extraction-budget-provider.js";
import { ConcurrencyProvider } from "./provider/concurrency-provider.js";
import { DeadlineProvider } from "./provider/deadline-provider.js";
import { LinkedInApiProvider } from "./provider/linkedin-api-provider.js";
import { UpstreamRequestLimiter } from "./provider/upstream-request-limiter.js";

const config = loadConfig();
const requestLimiter = new UpstreamRequestLimiter(
  config.linkedinRequestsPerMinute,
  60_000,
  config.linkedinMinRequestIntervalMs,
);
const linkedinProvider = new LinkedInApiProvider({
  ...(config.linkedinCookie ? { cookie: config.linkedinCookie } : {}),
  ...(config.linkedinCsrfToken ? { csrfToken: config.linkedinCsrfToken } : {}),
  ...(config.linkedinUserAgent ? { userAgent: config.linkedinUserAgent } : {}),
  requestTimeoutMs: config.linkedinRequestTimeoutMs,
  maxResponseBytes: config.linkedinMaxResponseBytes,
  requestLimiter,
});
const protectedProvider = new CircuitBreakerProvider(
  linkedinProvider,
  config.linkedinBreakerCooldownMs,
);
const budgetedProvider = config.accessMode === "public-demo"
  ? new ColdExtractionBudgetProvider(
      protectedProvider,
      config.publicDemoMaxColdExtractions,
    )
  : protectedProvider;
const concurrentProvider = new ConcurrencyProvider(
  budgetedProvider,
  config.linkedinMaxConcurrency,
  config.linkedinMaxQueueSize,
);
const upstreamProvider = new DeadlineProvider(
  concurrentProvider,
  config.linkedinExtractionTimeoutMs,
);
const provider = new CacheProvider(
  upstreamProvider,
  config.cacheTtlMs,
  Date.now,
  config.cacheMaxEntries,
);
const app = await buildApp({
  provider,
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
