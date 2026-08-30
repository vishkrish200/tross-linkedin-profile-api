import { randomBytes } from "node:crypto";
import {
  countParsedSectionItems,
  hashParsedSectionPage,
  isKnownEmptyAboutComponent,
  parseAboutComponentRequest,
  parseLinkedInProfile,
  parseProfilePage,
  sectionLimitWarning,
  type LinkedInSectionPages,
  type LinkedInSection,
} from "./profile-parser.js";
import { countDeclaredSectionItems } from "./section-parsers.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  ProviderProfileUnavailableError,
  ProviderProtectionError,
  type ProfileFetchOptions,
  type ProfileProvider,
} from "../provider/profile-provider.js";

export type LinkedInProfileProviderConfig = {
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

const SECTION_PAGE_SIZE = 10;
const MAX_SECTION_PAGES = 5;

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

function isUnavailableProfilePage(content: string): boolean {
  return /profile (?:is not available|unavailable|not found)|this page (?:doesn.t exist|isn.t available)|page not found/i
    .test(content);
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

const sectionRequestConfig: Record<LinkedInSection, SectionConfig> = {
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

function profileSlug(profileUrl: string): string {
  const match = new URL(profileUrl).pathname.match(/^\/in\/([^/]+)\/?$/);
  if (!match?.[1]) throw new ProviderFetchError("The normalized profile URL has no public identifier");
  return decodeURIComponent(match[1]);
}

function buildSectionPayload(
  section: LinkedInSection,
  vanityName: string,
  profileId: string,
  start: number,
): Record<string, unknown> {
  return {
    vanityName,
    profileId,
    start,
    count: SECTION_PAGE_SIZE,
    ...(section === "skills" ? { filter: "ProfileSkillCategory_ALL" } : {}),
    ...(section === "education" ? {
      detailSectionReplaceableComponentRef:
        `com.linkedin.sdui.profile.card.ref${profileId}EducationDetailsSection`,
    } : {}),
  };
}

function buildSectionRequestBody(
  section: LinkedInSection,
  vanityName: string,
  profileId: string,
  start: number,
): Record<string, unknown> {
  const config = sectionRequestConfig[section];
  const requestedArguments = {
    $type: "proto.sdui.actions.requests.RequestedArguments",
    requestedStateKeys: [],
    payload: buildSectionPayload(section, vanityName, profileId, start),
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

type LinkedInRequestContext = {
  vanityName: string;
  baseUrl: string;
  profileEndpoint: URL;
  commonHeaders: Record<string, string>;
  request: typeof fetch;
  options: ProfileFetchOptions;
};

type FetchedSectionPages = {
  pages: LinkedInSectionPages;
  warnings: string[];
};

export class LinkedInProfileProvider implements ProfileProvider {
  constructor(private readonly config: LinkedInProfileProviderConfig) {
    if (config.maxResponseBytes !== undefined
      && (!Number.isInteger(config.maxResponseBytes) || config.maxResponseBytes < 1)) {
      throw new RangeError("LinkedIn response size limit must be a positive integer");
    }
  }

  private createRequestContext(
    profileUrl: string,
    options: ProfileFetchOptions,
  ): LinkedInRequestContext {
    const cookie = this.config.cookie?.trim();
    if (!cookie) throw new ProviderNotConfiguredError("LINKEDIN_COOKIE is not configured");

    const csrfToken = this.config.csrfToken?.trim() || cookieValue(cookie, "JSESSIONID");
    if (!csrfToken) {
      throw new ProviderNotConfiguredError(
        "LINKEDIN_CSRF_TOKEN is not configured and JSESSIONID is absent from LINKEDIN_COOKIE",
      );
    }

    const vanityName = profileSlug(profileUrl);
    const baseUrl = this.config.baseUrl ?? "https://www.linkedin.com";
    const userAgent = this.config.userAgent
      ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    return {
      vanityName,
      baseUrl,
      profileEndpoint: new URL(`/in/${encodeURIComponent(vanityName)}/`, baseUrl),
      commonHeaders: {
        "accept-language": "en-US,en;q=0.9",
        cookie,
        "csrf-token": csrfToken,
        "user-agent": userAgent,
      },
      request: this.config.fetchImpl ?? fetch,
      options,
    };
  }

  private async requestLinkedIn(
    context: LinkedInRequestContext,
    url: URL,
    init: RequestInit,
    kind: ResponseKind,
  ): Promise<string> {
    let response: Response;
    try {
      await this.config.requestLimiter?.acquire(context.options.signal);
      const requestTimeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 20_000);
      const signal = context.options.signal
        ? AbortSignal.any([context.options.signal, requestTimeout])
        : requestTimeout;
      response = await context.request(url, {
        ...init,
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (context.options.signal?.aborted && context.options.signal.reason instanceof Error) {
        throw context.options.signal.reason;
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
    if (kind === "profile" && [404, 410].includes(response.status)) {
      throw new ProviderProfileUnavailableError();
    }
    if (!response.ok) throw new ProviderFetchError(`LinkedIn returned ${response.status}`);

    let content: string;
    try {
      content = await readLimitedResponse(response, this.config.maxResponseBytes ?? 5_000_000);
    } catch (error) {
      if (context.options.signal?.aborted && context.options.signal.reason instanceof Error) {
        throw context.options.signal.reason;
      }
      if (error instanceof ProviderFetchError) throw error;
      throw new ProviderFetchError(error instanceof Error ? error.message : undefined);
    }
    assertNoProtectionPage(content);
    assertExpectedContentType(response, kind);
    return content;
  }

  private fetchProfilePage(context: LinkedInRequestContext): Promise<string> {
    return this.requestLinkedIn(context, context.profileEndpoint, {
      method: "GET",
      headers: { ...context.commonHeaders, accept: "text/html,application/xhtml+xml" },
    }, "profile");
  }

  private async fetchProfileCard(
    context: LinkedInRequestContext,
    profileHtml: string,
  ): Promise<string[]> {
    const aboutComponent = parseAboutComponentRequest(profileHtml);
    if (aboutComponent === null) {
      throw new ProviderFetchError("LinkedIn returned an unrecognized profile-card response shape");
    }
    if (!aboutComponent) return [];

    const endpoint = new URL("/flagship-web/rsc-action/actions/component", context.baseUrl);
    endpoint.searchParams.set("componentId", aboutComponent.componentId);
    endpoint.searchParams.set("sduiid", aboutComponent.componentId);
    endpoint.searchParams.set(
      "parentSpanId",
      this.config.spanId?.() ?? randomBytes(8).toString("base64"),
    );
    const response = await this.requestLinkedIn(context, endpoint, {
      method: "POST",
      headers: {
        ...context.commonHeaders,
        accept: "text/x-component",
        "content-type": "application/json",
        referer: context.profileEndpoint.toString(),
        "x-li-rsc-stream": "true",
      },
      body: JSON.stringify({ clientArguments: aboutComponent.clientArguments }),
    }, "rsc");
    if (!parseProfilePage(profileHtml, [response]).about
      && !isKnownEmptyAboutComponent(response)) {
      throw new ProviderFetchError("LinkedIn's About component did not contain parsable biography text");
    }
    return [response];
  }

  private async fetchSectionPages(
    context: LinkedInRequestContext,
    profileId: string,
  ): Promise<FetchedSectionPages> {
    const pages: LinkedInSectionPages = {
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
    };
    const warnings: string[] = [];

    for (const section of Object.keys(sectionRequestConfig) as LinkedInSection[]) {
      const pageHashes = new Set<string>();
      for (let page = 0; page < MAX_SECTION_PAGES; page += 1) {
        const endpoint = new URL(
          "/flagship-web/rsc-action/actions/pagination",
          context.baseUrl,
        );
        endpoint.searchParams.set("sduiid", sectionRequestConfig[section].pagerId);
        endpoint.searchParams.set(
          "parentSpanId",
          this.config.spanId?.() ?? randomBytes(8).toString("base64"),
        );
        const content = await this.requestLinkedIn(context, endpoint, {
          method: "POST",
          headers: {
            ...context.commonHeaders,
            accept: "text/x-component",
            "content-type": "application/json",
            referer: new URL(
              `/in/${encodeURIComponent(context.vanityName)}/details/${section}/`,
              context.baseUrl,
            ).toString(),
            "x-li-rsc-stream": "true",
          },
          body: JSON.stringify(buildSectionRequestBody(
            section,
            context.vanityName,
            profileId,
            page * SECTION_PAGE_SIZE,
          )),
        }, "rsc");
        pages[section].push(content);

        const parsedItemCount = countParsedSectionItems(section, content);
        const declaredItemCount = countDeclaredSectionItems(content);
        if (declaredItemCount > parsedItemCount) {
          throw new ProviderFetchError(
            `LinkedIn declared ${declaredItemCount} ${section} items but the parser recovered ${parsedItemCount}`,
          );
        }
        if (parsedItemCount === 0 && !isKnownEmptySectionResponse(content)) {
          throw new ProviderFetchError(`LinkedIn returned an unrecognized ${section} response shape`);
        }
        if (parsedItemCount > 0) {
          const hash = hashParsedSectionPage(section, content);
          if (pageHashes.has(hash)) {
            throw new ProviderFetchError(`LinkedIn repeated a ${section} pagination page`);
          }
          pageHashes.add(hash);
        }
        if (page === MAX_SECTION_PAGES - 1 && parsedItemCount >= SECTION_PAGE_SIZE) {
          warnings.push(sectionLimitWarning(section));
        }
        if (parsedItemCount < SECTION_PAGE_SIZE) break;
      }
    }
    return { pages, warnings };
  }

  async fetch(profileUrl: string, options: ProfileFetchOptions = {}) {
    const context = this.createRequestContext(profileUrl, options);
    const profileHtml = await this.fetchProfilePage(context);
    const profilePage = parseProfilePage(profileHtml);
    if (!profilePage.profileId) {
      if (isUnavailableProfilePage(profileHtml)) throw new ProviderProfileUnavailableError();
      throw new ProviderFetchError("LinkedIn's profile page did not contain a profile identifier");
    }

    const profileCardResponses = await this.fetchProfileCard(context, profileHtml);
    const sectionPages = await this.fetchSectionPages(context, profilePage.profileId);
    const profile = parseLinkedInProfile({
      profileHtml,
      sectionPages: sectionPages.pages,
      sourceUrl: profileUrl,
      fetchedAt: this.config.now?.() ?? new Date(),
      profileCardResponses,
      warnings: sectionPages.warnings,
    });
    if (!profile.name && !profile.experience.length && !profile.education.length) {
      throw new ProviderFetchError("LinkedIn's response did not contain profile data");
    }
    return profile;
  }
}
