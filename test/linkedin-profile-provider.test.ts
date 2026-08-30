import { describe, expect, it, vi } from "vitest";
import { LinkedInProfileProvider } from "../src/linkedin/profile-provider.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  ProviderProfileUnavailableError,
  ProviderProtectionError,
} from "../src/provider/profile-provider.js";
import {
  certificationsFlight,
  educationFlight,
  emptyFlight,
  explicitlyEmptyAboutComponentFlight,
  experienceFlight,
  languagesFlight,
  lazyAboutComponentFlight,
  lazyAboutProfileHtml,
  lazyAboutShapeDriftProfileHtml,
  profileHtml,
  partiallyParsedSkillsFlight,
  responseShapeDriftFlight,
  skillsPageFlight,
  skillsFlight,
} from "./fixtures/profile-responses.js";

const sectionResponses: Record<string, string> = {
  experience: experienceFlight,
  education: educationFlight,
  skills: skillsFlight,
  certifications: certificationsFlight,
  languages: languagesFlight,
};

function typedResponse(
  body: BodyInit | null,
  contentType: string,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", contentType);
  return new Response(body, { ...init, headers });
}

const htmlResponse = (body: BodyInit | null, init?: ResponseInit) =>
  typedResponse(body, "text/html", init);
const rscResponse = (body: BodyInit | null, init?: ResponseInit) =>
  typedResponse(body, "text/x-component", init);

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

describe("LinkedInProfileProvider", () => {
  it("calls the direct profile and RSC pagination endpoints with runtime session headers", async () => {
    const fetchImpl = successfulFetch();
    const provider = new LinkedInProfileProvider({
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

  it("loads and extracts the lazy About profile card through the component action", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/lazy-about-person/") {
        return htmlResponse(lazyAboutProfileHtml, { status: 200 });
      }
      if (url.pathname.endsWith("/rsc-action/actions/component")) {
        return rscResponse(lazyAboutComponentFlight, { status: 200 });
      }
      return rscResponse(emptyFlight, { status: 200 });
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      baseUrl: "https://linkedin.example.test",
      fetchImpl,
      spanId: () => "span-id",
    });

    const profile = await provider.fetch("https://www.linkedin.com/in/lazy-about-person/");
    expect(profile.about).toBe(
      "I build dependable systems and test them with carefully designed, reproducible evaluations.",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    const [componentUrl, componentInit] = fetchImpl.mock.calls[1]!;
    expect(String(componentUrl)).toContain("/flagship-web/rsc-action/actions/component");
    expect(String(componentUrl)).toContain("componentId=com.linkedin.sdui.profile.card.about");
    expect(componentInit).toMatchObject({ method: "POST", redirect: "manual" });
    expect(JSON.parse(String(componentInit?.body))).toEqual({
      clientArguments: {
        payload: { vanityName: "lazy-about-person" },
        states: [],
        requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
        screenId: "com.linkedin.sdui.flagshipnav.profile.Profile",
        knownTemplateIds: [],
      },
    });
  });

  it("fails loud when an advertised About component no longer contains parsable text", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/lazy-about-person/") return htmlResponse(lazyAboutProfileHtml);
      if (url.pathname.endsWith("/rsc-action/actions/component")) {
        return rscResponse("0:[\"$\",\"div\",null,{\"children\":[\"About\"]}]");
      }
      return rscResponse(emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      baseUrl: "https://linkedin.example.test",
      fetchImpl,
    });

    await expect(provider.fetch("https://www.linkedin.com/in/lazy-about-person/"))
      .rejects.toThrow("About component did not contain parsable biography text");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts an advertised About card that is explicitly empty before neighboring cards", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/lazy-about-person/") return htmlResponse(lazyAboutProfileHtml);
      if (url.pathname.endsWith("/rsc-action/actions/component")) {
        return rscResponse(explicitlyEmptyAboutComponentFlight);
      }
      return rscResponse(emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      baseUrl: "https://linkedin.example.test",
      fetchImpl,
    });

    const profile = await provider.fetch("https://www.linkedin.com/in/lazy-about-person/");
    expect(profile.about).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it("fails closed when the lazy profile-card request contract changes shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      htmlResponse(lazyAboutShapeDriftProfileHtml, { status: 200 }),
    );
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
    });

    await expect(provider.fetch("https://www.linkedin.com/in/lazy-about-person/")).rejects.toMatchObject({
      name: "ProviderFetchError",
      message: "LinkedIn returned an unrecognized profile-card response shape",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails before network access when no session cookie is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new LinkedInProfileProvider({ fetchImpl });
    await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([401, 403])("maps LinkedIn HTTP %s to the authentication error", async (status) => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=expired; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status })),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toBeInstanceOf(
      ProviderAuthenticationError,
    );
  });

  it.each(["/login?sessionExpired=1", "/checkpoint/challenge/"])(
    "maps an authentication redirect to the authentication error: %s",
    async (location) => {
      const provider = new LinkedInProfileProvider({
        cookie: 'li_at=expired; JSESSIONID="ajax:csrf"',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(null, { status: 302, headers: { location } }),
        ),
      });
      await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toBeInstanceOf(
        ProviderAuthenticationError,
      );
    },
  );

  it.each([429, 999])("maps LinkedIn HTTP %s to a non-retrying fetch error", async (status) => {
    const response = status === 999
      ? { status, ok: false, headers: new Headers() } as Response
      : new Response(null, { status });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toBeInstanceOf(ProviderProtectionError);
  });

  it("detects an authentication wall returned with HTTP 200", async () => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=expired; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("<html><title>Sign in | LinkedIn</title><form class=\"login__form\"></form></html>"),
      ),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toBeInstanceOf(ProviderAuthenticationError);
  });

  it("detects a challenge page returned with HTTP 200", async () => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response([
          "<html><head><title>Security verification | LinkedIn</title></head><body>",
          "<h1>Security verification</h1>",
          '<form action="/checkpoint/challenge/"></form>',
          "</body></html>",
        ].join("")),
      ),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toBeInstanceOf(ProviderProtectionError);
  });

  it("detects a consent wall returned with HTTP 200", async () => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        htmlResponse([
          "<html><head><title>Consent | LinkedIn</title></head><body>",
          '<a href="https://consent.linkedin.com/"></a>',
          "</body></html>",
        ].join("")),
      ),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toBeInstanceOf(ProviderProtectionError);
  });

  it("does not treat ordinary profile text about security verification as a challenge", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") {
        return htmlResponse(profileHtml.replace(
          "</body>",
          "<p>I build tools for security verification.</p></body>",
        ));
      }
      return rscResponse(emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/"))
      .resolves.toMatchObject({ name: "Vishnu Example" });
  });

  it.each([
    ["a name containing consent", "<title>Ana Consentino | LinkedIn</title>"],
    ["a security-related headline", "<title>Bob - Security Verification Engineer | LinkedIn</title>"],
    ["a title that is also a protection label", "<title>Consent | LinkedIn</title>"],
  ])("does not classify %s as a protection page without structural evidence", async (_label, title) => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") {
        return htmlResponse(profileHtml
          .replace(/<title>[\s\S]*?<\/title>/, title)
          .replace("</body>", "<p>authwall login__form checkpoint/challenge</p></body>"));
      }
      return rscResponse(emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/"))
      .resolves.toMatchObject({ headline: "Software Engineer building agentic systems" });
  });

  it("does not treat ordinary RSC profile text containing authwall as an auth page", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      return rscResponse(
        pagerId.endsWith(".skills") ? skillsPageFlight("authwall", 1) : emptyFlight,
      );
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/"))
      .resolves.toMatchObject({ skills: ["authwall-1"] });
  });

  it("rejects an unexpected successful-response content type", async () => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(profileHtml, { headers: { "content-type": "application/json" } }),
      ),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toThrow("unexpected profile content type");
  });

  it("rejects a missing content type and malformed UTF-8", async () => {
    const missingType = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new TextEncoder().encode(profileHtml)),
      ),
    });
    await expect(missingType.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toThrow("unexpected profile content type");

    const malformed = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        htmlResponse(new Uint8Array([0xc3, 0x28])),
      ),
    });
    await expect(malformed.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toThrow("malformed UTF-8 response body");
  });

  it("rejects oversized and truncated successful responses", async () => {
    const oversized = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      maxResponseBytes: 64,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(htmlResponse(profileHtml)),
    });
    await expect(oversized.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toThrow("exceeded the configured size limit");

    const byteLength = new TextEncoder().encode(profileHtml).byteLength;
    const truncated = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(htmlResponse(profileHtml, {
        headers: { "content-length": String(byteLength + 10) },
      })),
    });
    await expect(truncated.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toThrow("truncated response body");
  });

  it("cancels an oversized response body before reading it", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      maxResponseBytes: 64,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(htmlResponse(body, {
        headers: { "content-length": "65" },
      })),
    });

    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toThrow("exceeded the configured size limit");
    expect(cancelled).toBe(true);
  });

  it("normalizes response-stream failures as provider fetch errors", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("upstream stream reset"));
      },
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(htmlResponse(body)),
    });

    await expect(provider.fetch("https://www.linkedin.com/in/example/"))
      .rejects.toMatchObject({
        name: "ProviderFetchError",
        message: "upstream stream reset",
      });
  });

  it("maps an upstream timeout to the non-retrying fetch error", async () => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new DOMException("The operation timed out", "TimeoutError")),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/example/")).rejects.toMatchObject({
      name: "ProviderFetchError",
      message: "The operation timed out",
    });
  });

  it("classifies an HTTP 404 profile response as unavailable", async () => {
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 })),
    });
    await expect(provider.fetch("https://www.linkedin.com/in/deleted-profile/"))
      .rejects.toBeInstanceOf(ProviderProfileUnavailableError);
  });

  it("classifies a soft unavailable profile page without hiding unknown shape drift", async () => {
    const unavailableHtml = profileHtml
      .replaceAll("profile-example", "")
      .replace("</body>", "<p>This profile is not available.</p></body>");
    const unavailable = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(htmlResponse(unavailableHtml)),
    });
    await expect(unavailable.fetch("https://www.linkedin.com/in/unavailable-profile/"))
      .rejects.toBeInstanceOf(ProviderProfileUnavailableError);

    const unknownShape = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        htmlResponse(profileHtml.replaceAll("profile-example", "")),
      ),
    });
    await expect(unknownShape.fetch("https://www.linkedin.com/in/unknown-shape/"))
      .rejects.toMatchObject({
        name: "ProviderFetchError",
        message: "LinkedIn's profile page did not contain a profile identifier",
      });
  });

  it("fails closed when a section response changes shape instead of treating it as empty", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") {
        return htmlResponse(profileHtml, { status: 200 });
      }
      const pagerId = url.searchParams.get("sduiid") ?? "";
      return rscResponse(
        pagerId.endsWith(".experience") ? responseShapeDriftFlight : emptyFlight,
        { status: 200 },
      );
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/")).rejects.toMatchObject({
      name: "ProviderFetchError",
      message: "LinkedIn returned an unrecognized experience response shape",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a later pagination page changes shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      if (!pagerId.endsWith(".skills")) return rscResponse(emptyFlight);
      const start = Number(JSON.parse(String(init?.body)).clientArguments.payload.start);
      return rscResponse(start === 0 ? skillsPageFlight("page-one") : responseShapeDriftFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/"))
      .rejects.toMatchObject({
        name: "ProviderFetchError",
        message: "LinkedIn returned an unrecognized skills response shape",
      });
  });

  it("fails closed when LinkedIn declares more items than the parser recovers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      return rscResponse(
        pagerId.endsWith(".skills") ? partiallyParsedSkillsFlight(10, 8) : emptyFlight,
      );
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/"))
      .rejects.toThrow("declared 10 skills items but the parser recovered 8");
  });

  it("rejects a repeated pagination page", async () => {
    const repeated = skillsPageFlight("repeated");
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      return rscResponse(pagerId.endsWith(".skills") ? repeated : emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    await expect(provider.fetch("https://www.linkedin.com/in/vishnu-example/"))
      .rejects.toMatchObject({
        name: "ProviderFetchError",
        message: "LinkedIn repeated a skills pagination page",
      });
  });

  it("marks a full fifth page as possibly truncated", async () => {
    const limiter = { acquire: vi.fn(async () => {}) };
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      if (!pagerId.endsWith(".skills")) return rscResponse(emptyFlight);
      const start = Number(JSON.parse(String(init?.body)).clientArguments.payload.start);
      return rscResponse(skillsPageFlight(`page-${start / 10}`));
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
      requestLimiter: limiter,
    });

    const profile = await provider.fetch("https://www.linkedin.com/in/vishnu-example/");
    expect(profile.skills).toHaveLength(50);
    expect(profile.warnings).toContain(
      "skills reached the 50-item safety limit and may be truncated.",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(10);
    expect(limiter.acquire).toHaveBeenCalledTimes(10);
  });

  it("hard-caps a section when upstream pages contain more than the requested page size", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      if (!pagerId.endsWith(".skills")) return rscResponse(emptyFlight);
      const start = Number(JSON.parse(String(init?.body)).clientArguments.payload.start);
      return rscResponse(skillsPageFlight(`oversized-${start}`, 12));
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    const profile = await provider.fetch("https://www.linkedin.com/in/vishnu-example/");
    expect(profile.skills).toHaveLength(50);
    expect(profile.warnings).toContain(
      "skills reached the 50-item safety limit and may be truncated.",
    );
  });

  it.each([
    [9, 9, false],
    [10, 10, false],
    [11, 11, false],
    [20, 20, false],
    [49, 49, false],
    [50, 50, true],
    [51, 50, true],
  ])("handles a %i-item section boundary without silent overclaiming", async (
    total,
    expected,
    truncated,
  ) => {
    const requestedStarts: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      if (!pagerId.endsWith(".skills")) return rscResponse(emptyFlight);
      const start = Number(JSON.parse(String(init?.body)).clientArguments.payload.start);
      requestedStarts.push(start);
      const count = Math.min(10, Math.max(0, total - start));
      return count > 0
        ? rscResponse(skillsPageFlight(`boundary-${start}`, count))
        : rscResponse(emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    const result = await provider.fetch("https://www.linkedin.com/in/vishnu-example/");
    expect(result.skills).toHaveLength(expected);
    expect(result.warnings.includes(
      "skills reached the 50-item safety limit and may be truncated.",
    )).toBe(truncated);
    expect(requestedStarts).toEqual(
      Array.from({ length: Math.min(5, Math.floor(total / 10) + 1) }, (_, index) => index * 10),
    );
  });

  it("deduplicates an item spanning page boundaries without dropping later items", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/in/vishnu-example/") return htmlResponse(profileHtml);
      const pagerId = url.searchParams.get("sduiid") ?? "";
      if (!pagerId.endsWith(".skills")) return rscResponse(emptyFlight);
      const start = Number(JSON.parse(String(init?.body)).clientArguments.payload.start);
      if (start === 0) return rscResponse(skillsPageFlight("first"));
      if (start === 10) {
        return rscResponse(skillsPageFlight("second", 3).replace("second-1", "first-1"));
      }
      return rscResponse(emptyFlight);
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    const result = await provider.fetch("https://www.linkedin.com/in/vishnu-example/");
    expect(result.skills).toHaveLength(12);
    expect(result.skills.at(-1)).toBe("second-3");
  });

  it("accepts an explicit empty-section marker", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return url.pathname === "/in/vishnu-example/"
        ? htmlResponse(profileHtml, { status: 200 })
        : rscResponse(emptyFlight, { status: 200 });
    });
    const provider = new LinkedInProfileProvider({
      cookie: 'li_at=session; JSESSIONID="ajax:csrf"',
      fetchImpl,
      baseUrl: "https://linkedin.example.test",
    });

    const profile = await provider.fetch("https://www.linkedin.com/in/vishnu-example/");
    expect(profile.name).toBe("Vishnu Example");
    expect(profile.experience).toEqual([]);
    expect(profile.education).toEqual([]);
    expect(profile.warnings).toEqual([
      "No experience entries were returned by LinkedIn.",
      "No education entries were returned by LinkedIn.",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("rejects a successful profile page without LinkedIn's transient profile id", async () => {
    const provider = new LinkedInProfileProvider({
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
