import { describe, expect, it } from "vitest";
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
});
