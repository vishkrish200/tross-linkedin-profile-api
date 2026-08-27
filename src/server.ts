import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { CacheProvider } from "./provider/cache-provider.js";
import { LinkedInApiProvider } from "./provider/linkedin-api-provider.js";

const config = loadConfig();
const linkedinProvider = new LinkedInApiProvider({
  ...(config.linkedinCookie ? { cookie: config.linkedinCookie } : {}),
  ...(config.linkedinCsrfToken ? { csrfToken: config.linkedinCsrfToken } : {}),
  ...(config.linkedinUserAgent ? { userAgent: config.linkedinUserAgent } : {}),
  requestTimeoutMs: config.linkedinRequestTimeoutMs,
});
const provider = new CacheProvider(linkedinProvider, config.cacheTtlMs);
const app = await buildApp({
  provider,
  ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  logger: { level: config.logLevel },
  rateLimitMax: config.rateLimitMax,
  rateLimitWindow: config.rateLimitWindow,
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
