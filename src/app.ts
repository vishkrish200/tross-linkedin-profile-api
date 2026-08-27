import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
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
  logger?: boolean | { level: string };
  rateLimitMax?: number;
  rateLimitWindow?: string;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 10,
    timeWindow: options.rateLimitWindow ?? "1 minute",
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/v1/profiles", async (request, reply) => {
    if (options.apiKey) {
      const authorization = request.headers.authorization;
      if (authorization !== `Bearer ${options.apiKey}`) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "A valid bearer token is required",
        });
      }
    }

    try {
      const body = profileRequestSchema.parse(request.body);
      const profileUrl = normalizeLinkedInProfileUrl(body.url);
      const profile = profileSchema.parse(await options.provider.fetch(profileUrl));
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
    }
  });

  return app;
}
