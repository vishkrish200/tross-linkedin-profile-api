import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { CacheProvider } from "./provider/cache-provider.js";
import { PlaywrightLinkedInProvider } from "./provider/playwright-linkedin-provider.js";

const config = loadConfig();
const linkedinProvider = new PlaywrightLinkedInProvider({
  ...(config.linkedinStorageStatePath ? { storageStatePath: config.linkedinStorageStatePath } : {}),
  ...(config.linkedinStorageStateBase64 ? { storageStateBase64: config.linkedinStorageStateBase64 } : {}),
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
