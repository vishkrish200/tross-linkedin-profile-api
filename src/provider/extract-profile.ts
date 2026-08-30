import { createHash } from "node:crypto";
import {
  PROFILE_IMAGE_LIMIT,
  PROFILE_SECTION_ITEM_LIMIT,
  type Certification,
  type Education,
  type Experience,
  type Language,
  type Profile,
} from "../domain/profile.js";
import {
  countDeclaredSectionItems,
  experienceKey,
  extractCertifications,
  extractEducation,
  extractExperience,
  extractLanguages,
  extractSkills,
} from "./extract-profile-sections.js";
import {
  clean,
  findRecord,
  flightStreams,
  isRecord,
  parseRows,
  semanticRows,
  unique,
  type FlightRow,
} from "./react-flight.js";

export {
  countDeclaredSectionItems,
  extractCertifications,
  extractEducation,
  extractExperience,
  extractLanguages,
  extractSkills,
};

export type LinkedInSection =
  | "experience"
  | "education"
  | "skills"
  | "certifications"
  | "languages";

export type LinkedInResponses = Record<LinkedInSection, string[]>;

export function sectionLimitWarning(section: LinkedInSection): string {
  return `${section} reached the ${PROFILE_SECTION_ITEM_LIMIT}-item safety limit and may be truncated.`;
}

type Identity = {
  profileId?: string;
  name?: string;
  headline?: string;
  location?: string;
  about?: string;
  profileImages: string[];
};

export type LinkedInComponentRequest = {
  componentId: string;
  clientArguments: Record<string, unknown>;
};

// undefined means the layout has no matching lazy-card wrapper; null means the
// wrapper exists but LinkedIn changed the request contract.
export function extractAboutComponentRequest(
  profileHtml: string,
): LinkedInComponentRequest | null | undefined {
  const rows = parseRows(profileHtml);
  let wrapper: Record<string, unknown> | undefined;
  for (const value of rows.values()) {
    wrapper = findRecord(value, rows, (record) =>
      typeof record.componentKey === "string"
      && record.componentKey.startsWith("profileCardsAboveActivityTopcardOnly"));
    if (wrapper) break;
  }
  if (!wrapper) return undefined;

  const asyncContent = findRecord(wrapper, rows, (record) =>
    record.$case === "asyncContent" && isRecord(record.asyncContent))?.asyncContent;
  if (!isRecord(asyncContent)
    || typeof asyncContent.newComponentId !== "string"
    || !isRecord(asyncContent.requestedArguments)) return null;

  const requestedArguments = asyncContent.requestedArguments;
  const requestedStateKeys = requestedArguments.requestedStateKeys;
  if (requestedStateKeys !== undefined
    && (!Array.isArray(requestedStateKeys) || requestedStateKeys.length > 0)) return null;

  let screenId = "com.linkedin.sdui.flagshipnav.profile.Profile";
  for (const value of rows.values()) {
    const screen = findRecord(value, rows, (record) =>
      typeof record.screenId === "string" && record.screenId.endsWith(".profile.Profile"));
    if (screen && typeof screen.screenId === "string") {
      screenId = screen.screenId;
      break;
    }
  }

  return {
    componentId: asyncContent.newComponentId,
    clientArguments: {
      ...(requestedArguments.payload !== undefined
        ? { payload: requestedArguments.payload }
        : {}),
      states: [],
      ...(requestedArguments.requestMetadata !== undefined
        ? { requestMetadata: requestedArguments.requestMetadata }
        : {}),
      screenId,
      knownTemplateIds: [],
    },
  };
}

function looksLikePronouns(value: string): boolean {
  const pronoun = /^(?:he|him|his|she|her|hers|they|them|theirs|ze|zir|zie|hir|xe|xem)$/i;
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 3 && parts.every((part) => pronoun.test(part));
}

function validAbout(
  value: string | undefined,
  minimumLength = 40,
  rejectPageBoilerplate = true,
): value is string {
  return Boolean(
    value
    && value.length >= minimumLength
    && (!rejectPageBoilerplate
      || !/Talent Solutions|Marketing Solutions|Privacy & Terms/i.test(value)),
  );
}

function aboutFromValues(
  values: string[],
  aboutIndex: number,
  minimumLength = 40,
  rejectPageBoilerplate = true,
): string | undefined {
  const candidates = values.slice(aboutIndex + 1);
  const possibleBoundary = candidates.findIndex((value) => /^(?:Top skills|Featured|Activity)$/i.test(value));
  // A one-word biography can legitimately equal a neighboring section label.
  // Treat it as a boundary only when there is preceding biography content or
  // following section content to support that interpretation.
  const boundary = possibleBoundary === 0 && candidates.length === 1 ? -1 : possibleBoundary;
  const content = boundary >= 0 ? candidates.slice(0, boundary) : candidates;
  const about = clean(content.join("\n"));
  return validAbout(about, minimumLength, rejectPageBoilerplate) ? about : undefined;
}

function aboutFromRows(
  rows: FlightRow[],
  minimumLength = 40,
  rejectPageBoilerplate = true,
): string | undefined {
  for (let index = 0; index < rows.length; index += 1) {
    const aboutIndex = rows[index]?.values.indexOf("About") ?? -1;
    if (aboutIndex < 0) continue;
    const inline = aboutFromValues(
      rows[index]!.values,
      aboutIndex,
      minimumLength,
      rejectPageBoilerplate,
    );
    if (inline) return inline;
    for (const candidate of rows.slice(index + 1, index + 5)) {
      if (/^(?:Top skills|Featured|Activity)$/i.test(candidate.values[0] ?? "")) break;
      const value = clean(candidate.values.join("\n"));
      if (validAbout(value, minimumLength, rejectPageBoilerplate)) return value;
    }
  }
  return undefined;
}

export function isKnownEmptyAboutComponent(input: string): boolean {
  const parsed = semanticRows(input);
  const hasExplicitEmptySlot = (value: unknown, depth = 0): boolean => {
    if (depth > 40 || !value || typeof value !== "object") return false;
    if (Array.isArray(value)
      && value[0] === "$"
      && isRecord(value[3])
      && typeof value[3]["data-sdui-component"] === "string"
      && Array.isArray(value[3].children)
      && value[3].children[0] === false) {
      return true;
    }
    const children = Array.isArray(value) ? value : Object.values(value);
    return children.some((child) => hasExplicitEmptySlot(child, depth + 1));
  };
  return parsed.values.length === 0
    && [...parsed.rows.values()].some((value) => hasExplicitEmptySlot(value));
}

function structuredImageUrls(
  value: unknown,
  rows: Map<string, unknown>,
  output: string[],
  seenReferences = new Set<string>(),
  seenObjects = new Set<object>(),
  depth = 0,
): void {
  if (depth > 80 || output.length >= PROFILE_IMAGE_LIMIT) return;
  if (typeof value === "string") {
    const reference = /^\$L?([0-9a-f]+)$/i.exec(value)?.[1]?.toLowerCase();
    if (reference && !seenReferences.has(reference)) {
      seenReferences.add(reference);
      structuredImageUrls(
        rows.get(reference),
        rows,
        output,
        seenReferences,
        seenObjects,
        depth + 1,
      );
      seenReferences.delete(reference);
    }
    return;
  }
  if (!value || typeof value !== "object" || seenObjects.has(value)) return;
  seenObjects.add(value);

  if (isRecord(value)
    && typeof value.rootUrl === "string"
    && /profile-(?:display|framed)photo/i.test(value.rootUrl)
    && Array.isArray(value.imageRenditions)) {
    const renditions = value.imageRenditions
      .filter((rendition): rendition is Record<string, unknown> => isRecord(rendition))
      .filter((rendition) => typeof rendition.suffixUrl === "string")
      .sort((left, right) => Number(left.width ?? 0) - Number(right.width ?? 0));
    let root: URL | undefined;
    try {
      root = new URL(value.rootUrl);
      if (root.protocol !== "https:" || root.username || root.password) root = undefined;
    } catch {
      root = undefined;
    }
    if (root) {
      for (const rendition of renditions) {
        if (output.length >= PROFILE_IMAGE_LIMIT) break;
        const suffix = rendition.suffixUrl as string;
        if (suffix.includes("\\")
          || [...suffix].some((character) => character.charCodeAt(0) <= 0x20)) continue;
        const candidate = `${root.toString()}${suffix}`;
        try {
          const url = new URL(candidate);
          if (url.protocol === "https:"
            && url.origin === root.origin
            && !url.username
            && !url.password) {
            output.push(url.toString());
          }
        } catch {
          // Ignore malformed upstream image renditions.
        }
      }
    }
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  children.forEach((child) => structuredImageUrls(
    child,
    rows,
    output,
    seenReferences,
    seenObjects,
    depth + 1,
  ));
}

function validImageUrls(decoded: string): string[] {
  const urls = [...decoded.matchAll(/https:\/\/[^"\\\s<>]+/g)]
    .map((match) => match[0])
    .filter((url) => /profile-(?:display|framed)photo/i.test(url))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:"
          && !parsed.username
          && !parsed.password
          && !/[-_]$/.test(url);
      } catch {
        return false;
      }
    });
  const firstGroup = urls[0]?.split(/\/profile-(?:display|framed)photo/i)[0];
  return unique(
    firstGroup ? urls.filter((url) => url.startsWith(`${firstGroup}/profile-`)) : [],
    (url) => url,
  ).slice(0, PROFILE_IMAGE_LIMIT);
}

function identityImageUrls(
  headerRow: FlightRow | undefined,
  rows: Map<string, unknown>,
  decoded: string,
): string[] {
  const headerImages: string[] = [];
  if (headerRow) structuredImageUrls(rows.get(headerRow.id), rows, headerImages);
  if (headerImages.length) return unique(headerImages, (url) => url);

  // In LinkedIn's current profile response the photo can be a sibling of the
  // text header beneath the root Flight row, so it is not always reachable
  // from the row containing "Contact info". Header-attached framed photos are
  // intentionally handled above because they are the asset visible in the UI.
  const rootImages: string[] = [];
  structuredImageUrls(rows.get("0"), rows, rootImages);
  if (rootImages.length) return unique(rootImages, (url) => url);

  return validImageUrls(decoded);
}

const titleEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeHtmlText(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|apos|gt|lt|nbsp|quot));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
      if (named) return titleEntities[named.toLowerCase()] ?? entity;
      const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", decimal ? 10 : 16);
      return Number.isInteger(codePoint)
        && codePoint > 0
        && codePoint <= 0x10_FFFF
        && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

export function extractIdentity(profileHtml: string, profileCardResponses: string[] = []): Identity {
  const decoded = flightStreams(profileHtml).join("\n");
  const rawTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(profileHtml)?.[1];
  const title = clean(rawTitle ? decodeHtmlText(rawTitle) : undefined);
  const name = title?.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim() || undefined;
  const profileId = /"profileId":"([^"]+)"/.exec(decoded)?.[1];
  const parsed = semanticRows(profileHtml);
  const profileCardRows = profileCardResponses.flatMap((response) => semanticRows(response).values);
  const rows = [...parsed.values, ...profileCardRows];
  const headerRow = rows.find((row) => row.values.length > 1 && row.values.includes("Contact info"));
  const contactValueIndex = headerRow?.values.indexOf("Contact info") ?? -1;
  const headerValues = contactValueIndex > 0
    ? headerRow!.values.slice(0, contactValueIndex).filter((value) =>
      value !== name
      && value !== "·"
      && !/^·\s*(?:1st|2nd|3rd)$/i.test(value)
      && !looksLikePronouns(value))
    : [];
  const standaloneContactIndex = rows.findIndex((row) =>
    row.values.length === 1 && row.values[0] === "Contact info");
  const headline = clean(
    headerValues[0]
      ?? (standaloneContactIndex >= 3 ? rows[standaloneContactIndex - 3]?.values[0] : undefined),
  );
  const location = clean(
    headerValues.length > 1
      ? headerValues.at(-1)
      : (standaloneContactIndex >= 1 ? rows[standaloneContactIndex - 1]?.values[0] : undefined),
  );

  // The separately requested card is the authoritative About surface and can
  // contain intentionally short biographies or phrases that also appear in
  // LinkedIn's page footer. Apply the boilerplate filter only to the page-level
  // fallback, where unrelated navigation text is ambiguous.
  const about = aboutFromRows(profileCardRows, 1, false) ?? aboutFromRows(parsed.values);

  return {
    ...(profileId ? { profileId } : {}),
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    profileImages: identityImageUrls(headerRow, parsed.rows, decoded).slice(0, PROFILE_IMAGE_LIMIT),
  };
}

type SectionValue = Experience | Education | string | Certification | Language;
const sectionExtractors: Record<LinkedInSection, (input: string) => SectionValue[]> = {
  experience: extractExperience,
  education: extractEducation,
  skills: extractSkills,
  certifications: extractCertifications,
  languages: extractLanguages,
};

export function countSectionItems(section: LinkedInSection, input: string): number {
  return sectionExtractors[section](input).length;
}

export function sectionPageSignature(section: LinkedInSection, input: string): string {
  const values = sectionExtractors[section](input);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function extractProfileFromResponses(
  profileHtml: string,
  responses: LinkedInResponses,
  sourceUrl: string,
  now: Date = new Date(),
  profileCardResponses: string[] = [],
  additionalWarnings: string[] = [],
): Profile {
  const identity = extractIdentity(profileHtml, profileCardResponses);
  let experience = unique(responses.experience.flatMap(extractExperience), experienceKey);
  let education = unique(responses.education.flatMap(extractEducation), (value) => [
    value.school,
    value.degree ?? "",
    value.fieldOfStudy ?? "",
    value.dateRange ?? "",
    value.description ?? "",
  ].join("|"));
  let skills = unique(
    responses.skills.flatMap(extractSkills),
    (value) => value.normalize("NFKC").toLowerCase(),
  );
  let certifications = unique(responses.certifications.flatMap(extractCertifications), (value) =>
    [
      value.name,
      value.issuer ?? "",
      value.issued ?? "",
      value.credentialId ?? "",
      value.credentialUrl ?? "",
    ].join("|"));
  let languages = unique(
    responses.languages.flatMap(extractLanguages),
    (value) => `${value.name.normalize("NFKC").toLowerCase()}|${value.proficiency ?? ""}`,
  );
  const warnings: string[] = [...new Set(additionalWarnings)];
  const capSection = <T>(section: LinkedInSection, values: T[]): T[] => {
    if (values.length <= PROFILE_SECTION_ITEM_LIMIT) return values;
    const warning = sectionLimitWarning(section);
    if (!warnings.includes(warning)) warnings.push(warning);
    return values.slice(0, PROFILE_SECTION_ITEM_LIMIT);
  };
  experience = capSection("experience", experience);
  education = capSection("education", education);
  skills = capSection("skills", skills);
  certifications = capSection("certifications", certifications);
  languages = capSection("languages", languages);
  if (!identity.name) warnings.push("Profile name was not present in LinkedIn's response.");
  if (!identity.headline) warnings.push("Profile headline was not present in LinkedIn's response.");
  if (!identity.location) warnings.push("Profile location was not present in LinkedIn's response.");
  if (!experience.length) warnings.push("No experience entries were returned by LinkedIn.");
  if (!education.length) warnings.push("No education entries were returned by LinkedIn.");

  return {
    sourceUrl,
    fetchedAt: now.toISOString(),
    ...(identity.name ? { name: identity.name } : {}),
    ...(identity.headline ? { headline: identity.headline } : {}),
    ...(identity.location ? { location: identity.location } : {}),
    ...(identity.about ? { about: identity.about } : {}),
    experience,
    education,
    skills,
    certifications,
    languages,
    profileImages: identity.profileImages,
    warnings,
  };
}
