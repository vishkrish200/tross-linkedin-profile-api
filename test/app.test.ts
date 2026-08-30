import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import {
  ProviderBusyError,
  ProviderQuotaExceededError,
  type ProfileProvider,
} from "../src/provider/profile-provider.js";

const provider: ProfileProvider = {
  async fetch(sourceUrl) {
    return {
      sourceUrl,
      fetchedAt: "2026-08-27T00:00:00.000Z",
      name: "Test Person",
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
      profileImages: [],
      warnings: [],
    };
  },
};

describe("profile API", () => {
  it("provides a reviewer-friendly discovery surface", async () => {
    const app = await buildApp({
      provider,
      accessMode: "bearer",
      apiKey: "secret",
      revision: "test-revision",
    });

    const discovery = await app.inject({ method: "GET", url: "/" });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.headers["x-content-type-options"]).toBe("nosniff");
    expect(discovery.json()).toMatchObject({
      status: "ok",
      revision: "test-revision",
      runtime: "Direct LinkedIn HTTP/RSC; no browser",
      endpoints: {
        documentation: "/docs",
        openapi: "/openapi.json",
      },
    });

    const documentation = await app.inject({ method: "GET", url: "/docs" });
    expect(documentation.statusCode).toBe(200);
    expect(documentation.headers["content-type"]).toContain("text/html");
    expect(documentation.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(documentation.body).toContain("Profile data, without a browser runtime.");

    const specification = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(specification.statusCode).toBe(200);
    const openApi = specification.json();
    expect(openApi).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/v1/profiles": {
          post: { security: [{ bearerAuth: [] }] },
        },
      },
    });
    expect(openApi.components.schemas.Profile.properties.skills.maxItems).toBe(50);
    await app.close();
  });

  it("documents controlled public access without inventing reviewer credentials", async () => {
    const expiresAt = Date.parse("2026-09-08T18:29:59.000Z");
    const app = await buildApp({
      provider,
      accessMode: "public-demo",
      publicDemoExpiresAt: expiresAt,
      publicDemoPerClientRateLimitMax: 6,
      publicDemoGlobalRateLimitMax: 20,
      publicDemoRateLimitWindow: "1 hour",
      publicDemoMaxColdExtractions: 50,
      maxQueuedDistinctProfiles: 4,
      now: () => expiresAt - 1,
    });

    const discovery = (await app.inject({ method: "GET", url: "/" })).json();
    expect(discovery.access).toEqual({
      mode: "public-demo",
      expiresAt: "2026-09-08T18:29:59.000Z",
      perClientMax: 6,
      globalMax: 20,
      timeWindow: "1 hour",
      maxColdExtractions: 50,
      maxQueuedDistinctProfiles: 4,
    });

    const documentation = await app.inject({ method: "GET", url: "/docs" });
    expect(documentation.body).toContain("Controlled public demo");
    expect(documentation.body).not.toContain("authorization: Bearer");

    const openApi = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(openApi.paths["/v1/profiles"].post.security).toEqual([]);
    expect(openApi.paths["/"].get.security).toEqual([]);
    expect(openApi.paths["/health"].get.security).toEqual([]);
    expect(openApi.paths["/v1/profiles"].post.responses["410"]).toBeDefined();
    expect(openApi.paths["/v1/profiles"].post.responses["413"]).toBeDefined();
    expect(openApi.paths["/v1/profiles"].post.responses["415"]).toBeDefined();
    expect(openApi.paths["/v1/profiles"].post.responses["500"]).toBeDefined();
    expect(openApi.components.securitySchemes).toBeUndefined();
    await app.close();
  });

  it("closes public access automatically at the configured instant", async () => {
    const fetch = vi.fn(provider.fetch);
    const expiresAt = Date.parse("2026-09-08T18:29:59.000Z");
    const app = await buildApp({
      provider: { fetch },
      accessMode: "public-demo",
      publicDemoExpiresAt: expiresAt,
      now: () => expiresAt,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json().error).toBe("public_demo_closed");
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("applies a per-client fairness quota in public-demo mode", async () => {
    const app = await buildApp({
      provider,
      accessMode: "public-demo",
      publicDemoPerClientRateLimitMax: 2,
      publicDemoGlobalRateLimitMax: 10,
    });
    const request = (clientIp: string) => app.inject({
      method: "POST" as const,
      url: "/v1/profiles",
      headers: {
        "user-agent": "reviewer-test",
        "x-forwarded-for": `${clientIp}, 35.191.0.1`,
      },
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });

    expect((await request("203.0.113.1")).statusCode).toBe(200);
    expect((await request("203.0.113.1")).statusCode).toBe(200);
    expect((await request("203.0.113.1")).statusCode).toBe(429);
    expect((await request("203.0.113.2")).statusCode).toBe(200);
    await app.close();
  });

  it("keeps a global public-demo quota independent of caller identity", async () => {
    const app = await buildApp({
      provider,
      accessMode: "public-demo",
      publicDemoPerClientRateLimitMax: 10,
      publicDemoGlobalRateLimitMax: 2,
    });
    const request = (clientIp: string) => app.inject({
      method: "POST" as const,
      url: "/v1/profiles",
      headers: {
        "user-agent": `reviewer-${clientIp}`,
        "x-forwarded-for": `${clientIp}, 35.191.0.1`,
      },
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });

    expect((await request("203.0.113.1")).statusCode).toBe(200);
    expect((await request("203.0.113.2")).statusCode).toBe(200);
    expect((await request("203.0.113.3")).statusCode).toBe(429);
    await app.close();
  });

  it("admits a 100-request reviewer burst below the public-demo ingress limits", async () => {
    const app = await buildApp({
      provider,
      accessMode: "public-demo",
      publicDemoPerClientRateLimitMax: 120,
      publicDemoGlobalRateLimitMax: 180,
      publicDemoRateLimitWindow: "1 minute",
    });
    const responses = await Promise.all(Array.from({ length: 100 }, () => app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: {
        "user-agent": "reviewer-burst-test",
        "x-forwarded-for": "203.0.113.1, 35.191.0.1",
      },
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    })));

    expect(responses.every(({ statusCode }) => statusCode === 200)).toBe(true);
    await app.close();
  });

  it("maps an exhausted cold-extraction budget to a bounded public error", async () => {
    const app = await buildApp({
      accessMode: "public-demo",
      provider: {
        async fetch() {
          throw new ProviderQuotaExceededError();
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json().error).toBe("public_demo_budget_exhausted");
    await app.close();
  });

  it("returns a retryable overload response when the distinct-profile queue is full", async () => {
    const app = await buildApp({
      accessMode: "public-demo",
      provider: {
        async fetch() {
          throw new ProviderBusyError();
        },
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("5");
    expect(response.json()).toMatchObject({
      error: "provider_busy",
      message: expect.stringContaining("retry shortly"),
    });
    await app.close();
  });

  it("returns a normalized structured profile", async () => {
    const app = await buildApp({ provider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://linkedin.com/in/test-person?trk=abc" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        sourceUrl: "https://www.linkedin.com/in/test-person/",
        name: "Test Person",
      },
    });
    await app.close();
  });

  it("rejects non-LinkedIn URLs before invoking the provider", async () => {
    const app = await buildApp({ provider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://example.com/in/test-person" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_request");
    await app.close();
  });

  it.each(["not a url", "https://www.linkedin.com/in/", "https://www.linkedin.com/company/example/"])(
    "rejects malformed profile input: %s",
    async (url) => {
      const fetch = vi.fn(provider.fetch);
      const app = await buildApp({ provider: { fetch } });
      const response = await app.inject({
        method: "POST",
        url: "/v1/profiles",
        payload: { url },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe("invalid_request");
      expect(fetch).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it("enforces the optional bearer token", async () => {
    const app = await buildApp({ provider, apiKey: "secret" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts both current and previous keys during a bounded rotation window", async () => {
    const app = await buildApp({ provider, apiKeys: ["current-secret", "previous-secret"] });
    const request = async (token: string) => app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { authorization: `Bearer ${token}` },
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });

    expect((await request("current-secret")).statusCode).toBe(200);
    expect((await request("previous-secret")).statusCode).toBe(200);
    expect((await request("invalid-secret")).statusCode).toBe(401);
    await app.close();
  });

  it.each(["bearer secret", "BEARER   secret"])(
    "accepts the case-insensitive HTTP authentication scheme: %s",
    async (authorization) => {
      const app = await buildApp({ provider, apiKey: "secret" });
      const response = await app.inject({
        method: "POST",
        url: "/v1/profiles",
        headers: { authorization },
        payload: { url: "https://www.linkedin.com/in/test-person/" },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    },
  );

  it("does not let unauthorized requests consume the authenticated quota", async () => {
    const app = await buildApp({
      provider,
      apiKey: "secret",
      rateLimitMax: 2,
      unauthorizedRateLimitMax: 2,
    });
    const request = {
      method: "POST" as const,
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    };

    expect((await app.inject(request)).statusCode).toBe(401);
    expect((await app.inject(request)).statusCode).toBe(401);
    expect((await app.inject(request)).statusCode).toBe(429);
    expect((await app.inject({
      ...request,
      headers: { authorization: "Bearer secret" },
    })).statusCode).toBe(200);
    await app.close();
  });

  it("keeps health checks outside the profile quota", async () => {
    const app = await buildApp({ provider, apiKey: "secret", rateLimitMax: 1 });
    for (let index = 0; index < 5; index += 1) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
    expect((await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { authorization: "Bearer secret" },
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    })).statusCode).toBe(200);
    await app.close();
  });

  it("normalizes authenticated quota errors", async () => {
    const app = await buildApp({ provider, apiKey: "secret", rateLimitMax: 1 });
    const request = {
      method: "POST" as const,
      url: "/v1/profiles",
      headers: { authorization: "Bearer secret" },
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    };

    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: "rate_limit_exceeded",
      message: "Request quota exceeded",
    });
    expect(limited.headers["retry-after"]).toBeDefined();
    await app.close();
  });

  it("returns privacy-safe response headers", async () => {
    const app = await buildApp({ provider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  it("rejects oversized request bodies before invoking the provider", async () => {
    const fetch = vi.fn(provider.fetch);
    const app = await buildApp({ provider: { fetch }, bodyLimit: 1_024 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: `https://www.linkedin.com/in/${"a".repeat(2_000)}/` },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: "payload_too_large",
      message: "Request body exceeds the configured size limit",
    });
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("normalizes malformed JSON parser errors", async () => {
    const fetch = vi.fn(provider.fetch);
    const app = await buildApp({ provider: { fetch } });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_request",
      message: "Request body must be valid JSON",
    });
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires a JSON request content type after bearer authentication", async () => {
    const fetch = vi.fn(provider.fetch);
    const app = await buildApp({ provider: { fetch }, apiKey: "secret" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: {
        authorization: "Bearer secret",
        "content-type": "text/plain",
      },
      payload: "not-json",
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      error: "unsupported_media_type",
      message: "Content-Type must be application/json",
    });
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects unauthorized traffic before parsing its request body", async () => {
    const fetch = vi.fn(provider.fetch);
    const app = await buildApp({ provider: { fetch }, apiKey: "secret", bodyLimit: 1_024 });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: "x".repeat(2_000),
      headers: { "content-type": "text/plain" },
    });
    expect(response.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps malformed percent escapes to a client error", async () => {
    const app = await buildApp({ provider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/%/" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("treats malformed provider output as an upstream contract failure", async () => {
    const invalidProvider = {
      async fetch(sourceUrl: string) {
        return { ...await provider.fetch(sourceUrl), fetchedAt: "not-an-iso-timestamp" };
      },
    } as unknown as ProfileProvider;
    const app = await buildApp({ provider: invalidProvider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: "provider_fetch_failed",
      message: "LinkedIn response did not satisfy the public profile contract",
    });
    await app.close();
  });

  it("aborts active extraction work during graceful shutdown", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const waitingProvider: ProfileProvider = {
      async fetch(_sourceUrl, options = {}) {
        upstreamSignal = options.signal;
        return await new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
          });
        });
      },
    };
    const app = await buildApp({ provider: waitingProvider });
    const response = app.inject({
      method: "POST",
      url: "/v1/profiles",
      payload: { url: "https://www.linkedin.com/in/test-person/" },
    });
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());

    await app.close();
    expect(upstreamSignal?.aborted).toBe(true);
    await expect(response).resolves.toMatchObject({ statusCode: 502 });
  });
});
