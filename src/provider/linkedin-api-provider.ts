import { randomBytes } from "node:crypto";
import {
  countSectionItems,
  extractIdentity,
  extractProfileFromResponses,
  type LinkedInResponses,
  type LinkedInSection,
} from "./extract-profile.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  type ProfileProvider,
} from "./profile-provider.js";

export type LinkedInApiProviderConfig = {
  cookie?: string;
  csrfToken?: string;
  userAgent?: string;
  requestTimeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  spanId?: () => string;
};

type SectionConfig = {
  pagerId: string;
  screenId: string;
};

const pageSize = 10;
const maxPages = 5;
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
  constructor(private readonly config: LinkedInApiProviderConfig) {}

  async fetch(profileUrl: string) {
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
        response = await request(url, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? 20_000),
        });
      } catch (error) {
        throw new ProviderFetchError(error instanceof Error ? error.message : undefined);
      }
      const location = response.headers.get("location") ?? "";
      if ([401, 403].includes(response.status) || /\/login|\/checkpoint|authwall/i.test(location)) {
        throw new ProviderAuthenticationError();
      }
      if (response.status === 429 || response.status === 999) {
        throw new ProviderFetchError("LinkedIn rate-limited or challenged the direct request");
      }
      if (!response.ok) throw new ProviderFetchError(`LinkedIn returned ${response.status}`);
      return response;
    };

    const profileEndpoint = new URL(`/in/${encodeURIComponent(vanityName)}/`, baseUrl);
    const profileResponse = await perform(profileEndpoint, {
      method: "GET",
      headers: { ...commonHeaders, accept: "text/html,application/xhtml+xml" },
    });
    const profileHtml = await profileResponse.text();
    const identity = extractIdentity(profileHtml);
    if (!identity.profileId) {
      throw new ProviderFetchError("LinkedIn's profile page did not contain a profile identifier");
    }

    const responses: LinkedInResponses = {
      experience: [],
      education: [],
      skills: [],
      certifications: [],
      languages: [],
    };

    for (const section of Object.keys(sections) as LinkedInSection[]) {
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
        const content = await response.text();
        responses[section].push(content);
        if (countSectionItems(section, content) < pageSize) break;
      }
    }

    const profile = extractProfileFromResponses(
      profileHtml,
      responses,
      profileUrl,
      this.config.now?.() ?? new Date(),
    );
    if (!profile.name && !profile.experience.length && !profile.education.length) {
      throw new ProviderFetchError("LinkedIn's response did not contain profile data");
    }
    return profile;
  }
}
