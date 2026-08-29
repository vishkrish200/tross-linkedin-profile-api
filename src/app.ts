import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import {
  apiDocumentationHtml,
  openApiDocument,
  publicRepositoryUrl,
} from "./api-documentation.js";
import { normalizeLinkedInProfileUrl, InvalidLinkedInProfileUrlError } from "./domain/linkedin-url.js";
import { profileRequestSchema, profileSchema } from "./domain/profile.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  type ProfileProvider,
} from "./provider/profile-provider.js";

export type BuildAppOptions = {
  provider: ProfileProvider;
  apiKey?: string;
  apiKeys?: readonly string[];
  logger?: FastifyServerOptions["logger"];
  bodyLimit?: number;
  rateLimitMax?: number;
  unauthorizedRateLimitMax?: number;
  rateLimitWindow?: string;
  revision?: string;
};

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function validBearerToken(authorization: string | undefined, apiKeys: readonly string[]): boolean {
  const supplied = tokenDigest(authorization ?? "");
  let matches = 0;
  for (const apiKey of apiKeys) {
    matches |= Number(timingSafeEqual(supplied, tokenDigest(`Bearer ${apiKey}`)));
  }
  return matches === 1;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: options.bodyLimit ?? 8_192,
  });

  await app.register(rateLimit, {
    global: false,
  });

  const apiKeys = [...new Set([
    ...(options.apiKey ? [options.apiKey] : []),
    ...(options.apiKeys ?? []),
  ].map((key) => key.trim()).filter(Boolean))];
  const activeRequests = new Set<AbortController>();

  app.addHook("preClose", async () => {
    const error = new ProviderFetchError("Service is shutting down");
    for (const controller of activeRequests) controller.abort(error);
  });

  const timeWindow = options.rateLimitWindow ?? "1 minute";
  const unauthorizedLimit = app.createRateLimit({
    max: options.unauthorizedRateLimitMax ?? 30,
    timeWindow,
    keyGenerator: (request) => request.ip,
  });
  const authenticatedLimit = app.rateLimit({
    max: options.rateLimitMax ?? 10,
    timeWindow,
    keyGenerator: () => "authenticated-profile-api",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/v1/profiles")) {
      reply.header("cache-control", "no-store");
      reply.header("x-content-type-options", "nosniff");
    }
  });

  app.get("/", async () => ({
    name: "LinkedIn Profile API",
    status: "ok",
    revision: options.revision ?? "local",
    runtime: "Direct LinkedIn HTTP/RSC; no browser",
    endpoints: {
      health: "/health",
      documentation: "/docs",
      openapi: "/openapi.json",
      profile: "POST /v1/profiles (Bearer token required)",
    },
    source: publicRepositoryUrl,
  }));

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/openapi.json", async (_request, reply) => reply
    .header("cache-control", "public, max-age=300")
    .send(openApiDocument));

  app.get("/docs", async (_request, reply) => reply
    .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
    .header("referrer-policy", "no-referrer")
    .header("x-content-type-options", "nosniff")
    .type("text/html; charset=utf-8")
    .send(apiDocumentationHtml));

  app.post("/v1/profiles", {
    onRequest: async (request, reply) => {
      if (apiKeys.length && !validBearerToken(request.headers.authorization, apiKeys)) {
        const limit = await unauthorizedLimit(request);
        if ("isExceeded" in limit && limit.isExceeded) {
          return reply
            .header("retry-after", limit.ttlInSeconds)
            .code(429)
            .send({
              error: "rate_limit_exceeded",
              message: "Too many unauthorized requests",
            });
        }
        return reply.code(401).send({
          error: "unauthorized",
          message: "A valid bearer token is required",
        });
      }
    },
    preHandler: authenticatedLimit,
  }, async (request, reply) => {
    const requestController = new AbortController();
    const cancel = () => requestController.abort(new ProviderFetchError("Client disconnected"));
    const cancelOnClose = () => {
      if (!reply.raw.writableFinished) cancel();
    };
    activeRequests.add(requestController);
    request.raw.once("aborted", cancel);
    reply.raw.once("close", cancelOnClose);

    try {
      const body = profileRequestSchema.parse(request.body);
      const profileUrl = normalizeLinkedInProfileUrl(body.url);
      const profile = profileSchema.parse(await options.provider.fetch(profileUrl, {
        signal: requestController.signal,
      }));
      return reply.code(200).send({ data: profile });
    } catch (error) {
      if (error instanceof ZodError || error instanceof InvalidLinkedInProfileUrlError) {
        return reply.code(400).send({
          error: "invalid_request",
          message: error instanceof InvalidLinkedInProfileUrlError ? error.message : "Expected JSON body: { url: string }",
        });
      }
      if (error instanceof ProviderNotConfiguredError) {
        return reply.code(503).send({ error: "provider_not_configured", message: error.message });
      }
      if (error instanceof ProviderAuthenticationError) {
        return reply.code(502).send({ error: "provider_authentication_failed", message: error.message });
      }
      if (error instanceof ProviderFetchError) {
        return reply.code(502).send({ error: "provider_fetch_failed", message: error.message });
      }
      request.log.error({ err: error }, "Unhandled profile request error");
      return reply.code(500).send({ error: "internal_error", message: "Unexpected server error" });
    } finally {
      request.raw.off("aborted", cancel);
      reply.raw.off("close", cancelOnClose);
      activeRequests.delete(requestController);
    }
  });

  return app;
}
