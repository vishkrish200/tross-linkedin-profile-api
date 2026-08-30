import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import {
  buildApiDocumentationHtml,
  buildOpenApiDocument,
  publicRepositoryUrl,
} from "./api-documentation.js";
import { normalizeLinkedInProfileUrl, InvalidLinkedInProfileUrlError } from "./domain/linkedin-url.js";
import { profileRequestSchema, profileSchema } from "./domain/profile.js";
import {
  ProviderAuthenticationError,
  ProviderBusyError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  ProviderProfileUnavailableError,
  ProviderQuotaExceededError,
  type ProfileProvider,
} from "./provider/profile-provider.js";

export type BuildAppOptions = {
  provider: ProfileProvider;
  accessMode?: "bearer" | "public-demo";
  apiKey?: string;
  apiKeys?: readonly string[];
  logger?: FastifyServerOptions["logger"];
  bodyLimit?: number;
  rateLimitMax?: number;
  unauthorizedRateLimitMax?: number;
  rateLimitWindow?: string;
  publicDemoExpiresAt?: number;
  publicDemoPerClientRateLimitMax?: number;
  publicDemoGlobalRateLimitMax?: number;
  publicDemoRateLimitWindow?: string;
  publicDemoMaxColdExtractions?: number;
  maxQueuedDistinctProfiles?: number;
  revision?: string;
  now?: () => number;
};

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function validBearerToken(authorization: string | undefined, apiKeys: readonly string[]): boolean {
  const credential = /^Bearer +(.+)$/i.exec(authorization ?? "")?.[1] ?? "";
  const supplied = tokenDigest(credential);
  let matches = 0;
  for (const apiKey of apiKeys) {
    matches |= Number(timingSafeEqual(supplied, tokenDigest(apiKey)));
  }
  return matches === 1;
}

function anonymousClientKey(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const hops = typeof forwardedValue === "string"
    ? forwardedValue.split(",").map((value) => value.trim()).filter(Boolean)
    : [];
  // Google front ends append their verified hops to the right. This bucket is
  // only a fairness control; the global quota remains the security boundary.
  const networkIdentity = hops.length >= 2 ? hops.at(-2)! : (hops.at(-1) ?? request.ip);
  const userAgent = typeof request.headers["user-agent"] === "string"
    ? request.headers["user-agent"]
    : "unknown";
  return createHash("sha256").update(`${networkIdentity}\0${userAgent}`).digest("hex");
}

function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
) {
  return reply.code(statusCode).send({ error, message });
}

function property(error: unknown, name: string): unknown {
  return typeof error === "object" && error !== null && name in error
    ? error[name as keyof typeof error]
    : undefined;
}

function contentTypeError(error: unknown): {
  statusCode: number;
  error: string;
  message: string;
} | undefined {
  switch (property(error, "code")) {
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return {
        statusCode: 400,
        error: "invalid_request",
        message: "Request body must be valid JSON",
      };
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return {
        statusCode: 413,
        error: "payload_too_large",
        message: "Request body exceeds the configured size limit",
      };
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return {
        statusCode: 415,
        error: "unsupported_media_type",
        message: "Content-Type must be application/json",
      };
    default:
      return undefined;
  }
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
  const accessMode = options.accessMode ?? (apiKeys.length ? "bearer" : "public-demo");
  if (accessMode === "bearer" && apiKeys.length === 0) {
    throw new Error("Bearer access mode requires at least one API key");
  }
  const now = options.now ?? Date.now;
  const activeRequests = new Set<AbortController>();

  app.setErrorHandler((error, request, reply) => {
    const normalized = contentTypeError(error);
    if (normalized) {
      return sendError(
        reply,
        normalized.statusCode,
        normalized.error,
        normalized.message,
      );
    }

    const candidateStatusCode = property(error, "statusCode");
    const statusCode = typeof candidateStatusCode === "number"
      ? candidateStatusCode
      : undefined;
    if (statusCode === 429) {
      return sendError(reply, 429, "rate_limit_exceeded", "Request quota exceeded");
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return sendError(reply, statusCode, "invalid_request", "Request could not be processed");
    }

    request.log.error({ err: error }, "Unhandled request error");
    return sendError(reply, 500, "internal_error", "Unexpected server error");
  });

  app.setNotFoundHandler((_request, reply) => sendError(
    reply,
    404,
    "not_found",
    "Route not found",
  ));

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
  const publicDemoWindow = options.publicDemoRateLimitWindow ?? "1 minute";
  const publicDemoPerClientLimit = app.createRateLimit({
    max: options.publicDemoPerClientRateLimitMax ?? 120,
    timeWindow: publicDemoWindow,
    keyGenerator: anonymousClientKey,
  });
  const publicDemoGlobalLimit = app.createRateLimit({
    max: options.publicDemoGlobalRateLimitMax ?? 180,
    timeWindow: publicDemoWindow,
    keyGenerator: () => "public-demo-global",
  });
  const enforcePublicDemoLimits = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const clientLimit = await publicDemoPerClientLimit(request);
    if ("isExceeded" in clientLimit && clientLimit.isExceeded) {
      return reply
        .header("retry-after", clientLimit.ttlInSeconds)
        .code(429)
        .send({
          error: "rate_limit_exceeded",
          message: "The public demo per-client quota has been exceeded",
        });
    }
    const globalLimit = await publicDemoGlobalLimit(request);
    if ("isExceeded" in globalLimit && globalLimit.isExceeded) {
      return reply
        .header("retry-after", globalLimit.ttlInSeconds)
        .code(429)
        .send({
          error: "rate_limit_exceeded",
          message: "The public demo global quota has been exceeded",
        });
    }
  };
  const accessDescription = accessMode === "bearer"
    ? { mode: "bearer" as const }
    : {
        mode: "public-demo" as const,
        ...(options.publicDemoExpiresAt !== undefined
          ? { expiresAt: new Date(options.publicDemoExpiresAt).toISOString() }
          : {}),
        perClientMax: options.publicDemoPerClientRateLimitMax ?? 120,
        globalMax: options.publicDemoGlobalRateLimitMax ?? 180,
        timeWindow: publicDemoWindow,
        maxColdExtractions: options.publicDemoMaxColdExtractions ?? 100,
        maxQueuedDistinctProfiles: options.maxQueuedDistinctProfiles ?? 4,
      };
  const openApiDocument = buildOpenApiDocument(accessDescription);
  const apiDocumentationHtml = buildApiDocumentationHtml(accessDescription);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    if (request.url.startsWith("/v1/profiles")) {
      reply.header("cache-control", "no-store");
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
      profile: accessMode === "bearer"
        ? "POST /v1/profiles (Bearer token required)"
        : "POST /v1/profiles (Controlled public demo)",
    },
    access: accessDescription,
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
      if (accessMode === "public-demo"
        && options.publicDemoExpiresAt !== undefined
        && now() >= options.publicDemoExpiresAt) {
        return reply.code(410).send({
          error: "public_demo_closed",
          message: "The controlled public evaluation window has ended",
        });
      }
      if (accessMode === "bearer"
        && !validBearerToken(request.headers.authorization, apiKeys)) {
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
      const contentType = request.headers["content-type"];
      const contentTypeValue = Array.isArray(contentType) ? contentType[0] : contentType;
      if (!isJsonContentType(contentTypeValue)) {
        return sendError(
          reply,
          415,
          "unsupported_media_type",
          "Content-Type must be application/json",
        );
      }
    },
    preHandler: accessMode === "bearer"
      ? authenticatedLimit
      : enforcePublicDemoLimits,
  }, async (request, reply) => {
    const parsedBody = profileRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "Expected JSON body: { url: string }",
      });
    }
    let profileUrl: string;
    try {
      profileUrl = normalizeLinkedInProfileUrl(parsedBody.data.url);
    } catch (error) {
      if (error instanceof InvalidLinkedInProfileUrlError) {
        return reply.code(400).send({ error: "invalid_request", message: error.message });
      }
      throw error;
    }

    const requestController = new AbortController();
    const cancel = () => requestController.abort(new ProviderFetchError("Client disconnected"));
    const cancelOnClose = () => {
      if (!reply.raw.writableFinished) cancel();
    };
    activeRequests.add(requestController);
    request.raw.once("aborted", cancel);
    reply.raw.once("close", cancelOnClose);

    try {
      const result = profileSchema.safeParse(await options.provider.fetch(profileUrl, {
        signal: requestController.signal,
      }));
      if (!result.success) {
        request.log.error({
          issues: result.error.issues.map(({ code, path }) => ({ code, path })),
        }, "Profile provider violated the public response contract");
        throw new ProviderFetchError("LinkedIn response did not satisfy the public profile contract");
      }
      return reply.code(200).send({ data: result.data });
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        return reply.code(503).send({ error: "provider_not_configured", message: error.message });
      }
      if (error instanceof ProviderProfileUnavailableError) {
        return reply.code(404).send({ error: "profile_unavailable", message: error.message });
      }
      if (error instanceof ProviderQuotaExceededError) {
        return reply.code(429).send({
          error: "public_demo_budget_exhausted",
          message: error.message,
        });
      }
      if (error instanceof ProviderBusyError) {
        return reply
          .header("retry-after", 5)
          .code(429)
          .send({
            error: "provider_busy",
            message: `${error.message}; retry shortly`,
          });
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
