import { describe, expect, it, vi } from "vitest";
import { LinkedInApiProvider } from "../src/provider/linkedin-api-provider.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
} from "../src/provider/profile-provider.js";
import {
  certificationsFlight,
  educationFlight,
  emptyFlight,
  experienceFlight,
  languagesFlight,
  profileHtml,
  skillsFlight,
} from "./fixtures/profile-responses.js";

const sectionResponses: Record<string, string> = {
  experience: experienceFlight,
  education: educationFlight,
  skills: skillsFlight,
  certifications: certificationsFlight,
  languages: languagesFlight,
};

function successfulFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/in/vishnu-example/") {
      return new Response(profileHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    const pagerId = url.searchParams.get("sduiid") ?? "";
    const section = Object.keys(sectionResponses).find((key) => pagerId.endsWith(`.${key}`));
    return new Response(section ? sectionResponses[section] : emptyFlight, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  });
}

describe("LinkedInApiProvider", () => {
  it("calls the direct profile and RSC pagination endpoints with runtime session headers", async () => {
    const fetchImpl = successfulFetch();
    const provider = new LinkedInApiProvider({
      cookie: 'li_at=session-secret; JSESSIONID="ajax:csrf-secret"',
      baseUrl: "https://linkedin.example.test",
      fetchImpl,
      spanId: () => "span-id",
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });

    const profile = await provider.fetch("https://www.linkedin.com/in/vishnu-example/");
    expect(profile.name).toBe("Vishnu Example");
    expect(profile.skills).toEqual(["TypeScript", "Distributed Systems"]);
    expect(fetchImpl).toHaveBeenCalledTimes(6);

    const [profileUrl, profileInit] = fetchImpl.mock.calls[0]!;
    expect(String(profileUrl)).toBe("https://linkedin.example.test/in/vishnu-example/");
    expect(profileInit).toMatchObject({ method: "GET", redirect: "manual" });
    expect(profileInit?.headers).toMatchObject({
      cookie: 'li_at=session-secret; JSESSIONID="ajax:csrf-secret"',
      "csrf-token": "ajax:csrf-secret",
    });

    const [experienceUrl, experienceInit] = fetchImpl.mock.calls[1]!;
    expect(String(experienceUrl)).toContain("/flagship-web/rsc-action/actions/pagination");
    expect(String(experienceUrl)).toContain("sduiid=com.linkedin.sdui.pagers.profile.details.experience");
    expect(experienceInit).toMatchObject({ method: "POST", redirect: "manual" });
    expect(JSON.parse(String(experienceInit?.body))).toMatchObject({
      pagerId: "com.linkedin.sdui.pagers.profile.details.experience",
      clientArguments: {
        payload: {
          vanityName: "vishnu-example",
          profileId: "profile-example",
          start: 0,
          count: 10,
        },
      },
    });
  });

  it("fails before network access when no session cookie is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new LinkedInApiProvider({ fetchImpl });
    await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps LinkedIn authentication failures to the public provider error", async () => {
    const provider = new LinkedInApiProvider({
      cookie: 'li_at=expired; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toBeInstanceOf(
      ProviderAuthenticationError,
    );
  });

  it("rejects a successful profile page without LinkedIn's transient profile id", async () => {
    const provider = new LinkedInApiProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("<html><title>Example | LinkedIn</title></html>", { status: 200 }),
      ),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toBeInstanceOf(
      ProviderFetchError,
    );
  });
});
