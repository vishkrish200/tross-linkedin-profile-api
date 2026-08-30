import { randomBytes } from "node:crypto";
import {
  countSectionItems,
  countDeclaredSectionItems,
  extractAboutComponentRequest,
  extractIdentity,
  extractProfileFromResponses,
  isKnownEmptyAboutComponent,
  sectionPageSignature,
  sectionLimitWarning,
  type LinkedInResponses,
  type LinkedInSection,
} from "./extract-profile.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  ProviderProtectionError,
  type ProfileFetchOptions,
  type ProfileProvider,
} from "./profile-provider.js";

export type LinkedInApiProviderConfig = {
  cookie?: string;
  csrfToken?: string;
  userAgent?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  spanId?: () => string;
  requestLimiter?: { acquire(signal?: AbortSignal): Promise<void> };
};

type SectionConfig = {
  pagerId: string;
  screenId: string;
};

const pageSize = 10;
const maxPages = 5;

function isKnownEmptySectionResponse(content: string): boolean {
  return /Nothing to see for now/i.test(content);
}

function assertNoProtectionPage(content: string): void {
  const isHtmlDocument = /<!doctype\s+html|<html\b|<body\b|<form\b/i.test(content);
  if (!isHtmlDocument) return;

  const loginForm = /<form\b[^>]*(?:id|class)=["'][^"']*\blogin__form\b[^"']*["']/i.test(content);
  const authwallLink = /<(?:a|form)\b[^>]*(?:href|action)=["'][^"']*\/authwall(?:[/?#][^"']*)?["']/i.test(content);
  if (loginForm || authwallLink) {
    throw new ProviderAuthenticationError();
  }

  const challengeTarget = /<(?:a|form|iframe|script)\b[^>]*(?:href|action|src)=["'][^"']*(?:checkpoint\/challenge|consent\.linkedin\.com)[^"']*["']/i.test(content);
  const captchaMarkup = /g-recaptcha|(?:id|class|name)=["'][^"']*\bcaptcha\b[^"']*["']/i.test(content);
  const verificationTitle = /<title[^>]*>\s*(?:security verification|consent)(?:\s*\|\s*LinkedIn)?\s*<\/title>/i.test(content);
  const verificationHeading = /<h[1-3][^>]*>\s*(?:security verification|consent)\s*<\/h[1-3]>/i.test(content);
  if (challengeTarget || captchaMarkup || (verificationTitle && verificationHeading)) {
    throw new ProviderProtectionError();
  }
}

type ResponseKind = "profile" | "rsc";

function assertExpectedContentType(response: Response, kind: ResponseKind): void {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const allowed = kind === "profile"
    ? new Set(["text/html", "application/xhtml+xml"])
    : new Set(["text/x-component", "application/octet-stream"]);
  if (!contentType || !allowed.has(contentType)) {
    throw new ProviderFetchError(`LinkedIn returned an unexpected ${kind} content type`);
  }
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderFetchError("LinkedIn response exceeded the configured size limit");
  }
  if (!response.body) return "";

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ProviderFetchError("LinkedIn response exceeded the configured size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (Number.isFinite(contentLength)
    && contentLength > 0
    && !response.headers.has("content-encoding")
    && total < contentLength) {
    throw new ProviderFetchError("LinkedIn returned a truncated response body");
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } catch {
    throw new ProviderFetchError("LinkedIn returned a malformed UTF-8 response body");
  }
}

const sections: Record<LinkedInSection, SectionConfig> = {
  experience: {
    pagerId: "com.linkedin.sdui.pagers.profile.details.experience",
    screenId: "com.linkedin.sdui.flagshipnav.profile.ProfileExperienceDetails",
  },
  education: {
    pagerId: "com.linkedin.sdui.pagers.profile.details.education",
    screenId: "com.linkedin.sdui.flagshipnav.profile.ProfileEducationDetails",
  },
  skills: {
    pagerId: "com.linkedin.sdui.pagers.profile.details.skills",
    screenId: "com.linkedin.sdui.flagshipnav.profile.ProfileSkillDetails",
  },
  certifications: {
    pagerId: "com.linkedin.sdui.pagers.profile.details.certifications",
    screenId: "com.linkedin.sdui.flagshipnav.profile.ProfileCertificationDetails",
  },
  languages: {
    pagerId: "com.linkedin.sdui.pagers.profile.details.languages",
    screenId: "com.linkedin.sdui.flagshipnav.profile.ProfileLanguageDetails",
  },
};

function cookieValue(cookie: string, name: string): string | undefined {
  const entry = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  const value = entry?.slice(name.length + 1).trim().replace(/^"|"$/g, "");
  return value || undefined;
}

function publicIdentifier(profileUrl: string): string {
  const match = new URL(profileUrl).pathname.match(/^\/in\/([^/]+)\/?$/);
  if (!match?.[1]) throw new ProviderFetchError("The normalized profile URL has no public identifier");
  return decodeURIComponent(match[1]);
}

function sectionPayload(
  section: LinkedInSection,
  vanityName: string,
  profileId: string,
  start: number,
): Record<string, unknown> {
  return {
    vanityName,
    profileId,
    start,
    count: pageSize,
    ...(section === "skills" ? { filter: "ProfileSkillCategory_ALL" } : {}),
    ...(section === "education" ? {
      detailSectionReplaceableComponentRef:
        `com.linkedin.sdui.profile.card.ref${profileId}EducationDetailsSection`,
    } : {}),
  };
}

function sectionBody(
  section: LinkedInSection,
  vanityName: string,
  profileId: string,
  start: number,
): Record<string, unknown> {
  const config = sections[section];
  const requestedArguments = {
    $type: "proto.sdui.actions.requests.RequestedArguments",
    requestedStateKeys: [],
    payload: sectionPayload(section, vanityName, profileId, start),
    requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
  };
  return {
    pagerId: config.pagerId,
    clientArguments: {
      ...requestedArguments,
      states: [],
      screenId: config.screenId,
      knownTemplateIds: [],
    },
    paginationRequest: {
      $type: "proto.sdui.actions.requests.PaginationRequest",
      pagerId: config.pagerId,
      trigger: {
        $case: "itemDistanceTrigger",
        itemDistanceTrigger: {
          $type: "proto.sdui.actions.requests.ItemDistanceTrigger",
          preloadDistance: 3,
          preloadLength: 250,
        },
      },
      retryCount: 0,
      requestedArguments,
    },
  };
}

export class LinkedInApiProvider implements ProfileProvider {
  constructor(private readonly config: LinkedInApiProviderConfig) {
    if (config.maxResponseBytes !== undefined
      && (!Number.isInteger(config.maxResponseBytes) || config.maxResponseBytes < 1)) {
      throw new RangeError("LinkedIn response size limit must be a positive integer");
    }
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}) {
    const cookie = this.config.cookie?.trim();
    if (!cookie) throw new ProviderNotConfiguredError("LINKEDIN_COOKIE is not configured");

    const csrfToken = this.config.csrfToken?.trim() || cookieValue(cookie, "JSESSIONID");
    if (!csrfToken) {
      throw new ProviderNotConfiguredError(
        "LINKEDIN_CSRF_TOKEN is not configured and JSESSIONID is absent from LINKEDIN_COOKIE",
      );
    }

    const vanityName = publicIdentifier(profileUrl);
    const baseUrl = this.config.baseUrl ?? "https://www.linkedin.com";
    const request = this.config.fetchImpl ?? fetch;
    const userAgent = this.config.userAgent
      ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const commonHeaders = {
      "accept-language": "en-US,en;q=0.9",
      cookie,
      "csrf-token": csrfToken,
      "user-agent": userAgent,
    };

    const perform = async (url: URL, init: RequestInit): Promise<Response> => {
      let response: Response;
      try {
        await this.config.requestLimiter?.acquire(options.signal);
        const requestTimeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 20_000);
        const signal = options.signal
          ? AbortSignal.any([options.signal, requestTimeout])
          : requestTimeout;
        response = await request(url, {
          ...init,
          redirect: "manual",
          signal,
        });
      } catch (error) {
        if (options.signal?.aborted && options.signal.reason instanceof Error) {
          throw options.signal.reason;
        }
        throw new ProviderFetchError(error instanceof Error ? error.message : undefined);
      }
      const location = response.headers.get("location") ?? "";
      if ([401, 403].includes(response.status) || /\/login|\/checkpoint|authwall/i.test(location)) {
        throw new ProviderAuthenticationError();
      }
      if (response.status === 429 || response.status === 999) {
        throw new ProviderProtectionError();
      }
      if (!response.ok) throw new ProviderFetchError(`LinkedIn returned ${response.status}`);
      return response;
    };

    const readResponse = async (response: Response, kind: ResponseKind): Promise<string> => {
      let content: string;
      try {
        content = await readLimitedResponse(response, this.config.maxResponseBytes ?? 5_000_000);
      } catch (error) {
        if (options.signal?.aborted && options.signal.reason instanceof Error) {
          throw options.signal.reason;
        }
        if (error instanceof ProviderFetchError) throw error;
        throw new ProviderFetchError(error instanceof Error ? error.message : undefined);
      }
      assertNoProtectionPage(content);
      assertExpectedContentType(response, kind);
      return content;
    };

    const profileEndpoint = new URL(`/in/${encodeURIComponent(vanityName)}/`, baseUrl);
    const profileResponse = await perform(profileEndpoint, {
      method: "GET",
      headers: { ...commonHeaders, accept: "text/html,application/xhtml+xml" },
    });
    const profileHtml = await readResponse(profileResponse, "profile");
    const identity = extractIdentity(profileHtml);
    if (!identity.profileId) {
      throw new ProviderFetchError("LinkedIn's profile page did not contain a profile identifier");
    }

    const profileCardResponses: string[] = [];
    const aboutComponent = extractAboutComponentRequest(profileHtml);
    if (aboutComponent === null) {
      throw new ProviderFetchError("LinkedIn returned an unrecognized profile-card response shape");
    }
    if (aboutComponent) {
      const endpoint = new URL("/flagship-web/rsc-action/actions/component", baseUrl);
      endpoint.searchParams.set("componentId", aboutComponent.componentId);
      endpoint.searchParams.set("sduiid", aboutComponent.componentId);
      endpoint.searchParams.set(
        "parentSpanId",
        this.config.spanId?.() ?? randomBytes(8).toString("base64"),
      );
      const response = await perform(endpoint, {
        method: "POST",
        headers: {
          ...commonHeaders,
          accept: "text/x-component",
          "content-type": "application/json",
          referer: profileEndpoint.toString(),
          "x-li-rsc-stream": "true",
        },
        body: JSON.stringify({ clientArguments: aboutComponent.clientArguments }),
      });
      profileCardResponses.push(await readResponse(response, "rsc"));
    }
    if (aboutComponent
      && !extractIdentity(profileHtml, profileCardResponses).about
      && !profileCardResponses.some(isKnownEmptyAboutComponent)) {
      throw new ProviderFetchError("LinkedIn's About component did not contain parsable biography text");
    }

    const responses: LinkedInResponses = {
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
    };
    const extractionWarnings: string[] = [];

    for (const section of Object.keys(sections) as LinkedInSection[]) {
      const pageSignatures = new Set<string>();
      for (let page = 0; page < maxPages; page += 1) {
        const endpoint = new URL("/flagship-web/rsc-action/actions/pagination", baseUrl);
        endpoint.searchParams.set("sduiid", sections[section].pagerId);
        endpoint.searchParams.set(
          "parentSpanId",
          this.config.spanId?.() ?? randomBytes(8).toString("base64"),
        );
        const response = await perform(endpoint, {
          method: "POST",
          headers: {
            ...commonHeaders,
            accept: "text/x-component",
            "content-type": "application/json",
            referer: new URL(`/in/${encodeURIComponent(vanityName)}/details/${section}/`, baseUrl).toString(),
            "x-li-rsc-stream": "true",
          },
          body: JSON.stringify(sectionBody(section, vanityName, identity.profileId, page * pageSize)),
        });
        const content = await readResponse(response, "rsc");
        responses[section].push(content);
        const itemCount = countSectionItems(section, content);
        const declaredItemCount = countDeclaredSectionItems(content);
        if (declaredItemCount > itemCount) {
          throw new ProviderFetchError(
            `LinkedIn declared ${declaredItemCount} ${section} items but the parser recovered ${itemCount}`,
          );
        }
        if (itemCount === 0 && !isKnownEmptySectionResponse(content)) {
          throw new ProviderFetchError(`LinkedIn returned an unrecognized ${section} response shape`);
        }
        if (itemCount > 0) {
          const signature = sectionPageSignature(section, content);
          if (pageSignatures.has(signature)) {
            throw new ProviderFetchError(`LinkedIn repeated a ${section} pagination page`);
          }
          pageSignatures.add(signature);
        }
        if (page === maxPages - 1 && itemCount >= pageSize) {
          extractionWarnings.push(sectionLimitWarning(section));
        }
        if (itemCount < pageSize) break;
      }
    }

    const profile = extractProfileFromResponses(
      profileHtml,
      responses,
      profileUrl,
      this.config.now?.() ?? new Date(),
      profileCardResponses,
      extractionWarnings,
    );
    if (!profile.name && !profile.experience.length && !profile.education.length) {
      throw new ProviderFetchError("LinkedIn's response did not contain profile data");
    }
    return profile;
  }
}
