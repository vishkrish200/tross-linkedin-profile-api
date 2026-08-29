import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { ProfileProvider } from "../src/provider/profile-provider.js";

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
    const app = await buildApp({ provider, revision: "test-revision" });

    const discovery = await app.inject({ method: "GET", url: "/" });
    expect(discovery.statusCode).toBe(200);
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
