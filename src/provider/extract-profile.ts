import { createHash } from "node:crypto";
import { PROFILE_SECTION_ITEM_LIMIT } from "../domain/profile.js";
import type {
  Certification,
  Education,
  Experience,
  Language,
  Profile,
} from "../domain/profile.js";

type FlightRow = { id: string; values: string[] };

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

function clean(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function unique<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function flightStreams(input: string): string[] {
  const script = /<script[^>]+id=["']rehydrate-data["'][^>]*>([\s\S]*?)<\/script>/i.exec(input)?.[1];
  if (!script) return [input];
  const assignment = /^\s*window\.__como_rehydration__\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(script)?.[1];
  if (!assignment) return [];
  try {
    const parsed = JSON.parse(assignment) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function parseRows(input: string): Map<string, unknown> {
  const rows = new Map<string, unknown>();
  for (const line of flightStreams(input).flatMap((stream) => stream.split("\n"))) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const payload = line.slice(separator + 1);
    if (!payload.startsWith("[") && !payload.startsWith("{")) continue;
    try {
      rows.set(line.slice(0, separator).toLowerCase(), JSON.parse(payload));
    } catch {
      // React Flight also emits non-JSON row kinds that this extractor does not need.
    }
  }
  return rows;
}

function collectSemanticText(
  value: unknown,
  rows: Map<string, unknown>,
  output: string[],
  seen = new Set<string>(),
  depth = 0,
): void {
  if (depth > 80) return;
  if (typeof value === "string") {
    const reference = /^\$L?([0-9a-f]+)$/i.exec(value)?.[1]?.toLowerCase();
    if (reference && !seen.has(reference)) {
      seen.add(reference);
      collectSemanticText(rows.get(reference), rows, output, seen, depth + 1);
      seen.delete(reference);
      return;
    }
    const normalized = clean(value);
    if (normalized && !normalized.startsWith("$")) output.push(normalized);
    return;
  }
  if (!Array.isArray(value)) return;
  if (value[0] === "$" && value.length >= 4) {
    const props = value[3] && typeof value[3] === "object" && !Array.isArray(value[3])
      ? value[3] as Record<string, unknown>
      : undefined;
    const textProps = props?.textProps && typeof props.textProps === "object"
      ? props.textProps as Record<string, unknown>
      : undefined;
    // LinkedIn's lazy profile cards (including About) currently render their
    // first payload through initialContent instead of children.
    const content = [textProps?.children, props?.children, props?.initialContent]
      .find((candidate) => candidate !== undefined
        && candidate !== null
        && candidate !== ""
        && (!Array.isArray(candidate) || candidate.length > 0));
    collectSemanticText(
      content,
      rows,
      output,
      seen,
      depth + 1,
    );
    return;
  }
  value.forEach((item) => collectSemanticText(item, rows, output, seen, depth + 1));
}

function semanticRows(input: string): { rows: Map<string, unknown>; values: FlightRow[] } {
  const rows = parseRows(input);
  const values = [...rows].map(([id, value]) => {
    const output: string[] = [];
    collectSemanticText(value, rows, output);
    return { id, values: output.filter((item, index) => item !== output[index - 1]) };
  }).filter((row) => row.values.length);
  return { rows, values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findRecord(
  value: unknown,
  rows: Map<string, unknown>,
  predicate: (record: Record<string, unknown>) => boolean,
  seenReferences = new Set<string>(),
  seenObjects = new Set<object>(),
  depth = 0,
): Record<string, unknown> | undefined {
  if (depth > 80) return undefined;
  if (typeof value === "string") {
    const reference = /^\$L?([0-9a-f]+)$/i.exec(value)?.[1]?.toLowerCase();
    if (!reference || seenReferences.has(reference)) return undefined;
    seenReferences.add(reference);
    return findRecord(
      rows.get(reference),
      rows,
      predicate,
      seenReferences,
      seenObjects,
      depth + 1,
    );
  }
  if (!value || typeof value !== "object" || seenObjects.has(value)) return undefined;
  seenObjects.add(value);
  if (isRecord(value) && predicate(value)) return value;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const result = findRecord(
      child,
      rows,
      predicate,
      seenReferences,
      seenObjects,
      depth + 1,
    );
    if (result) return result;
  }
  return undefined;
}

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

function entityCollectionGroups(input: string): string[][] {
  let bestGroups: string[][] = [];
  for (const row of semanticRows(input).values) {
    const groups: string[][] = [];
    let current: string[] | undefined;
    for (const value of row.values) {
      let isItemMarker = false;
      try {
        const metadata = JSON.parse(value) as unknown;
        isItemMarker = isRecord(metadata)
          && typeof metadata.semanticId === "string"
          && metadata.semanticId.startsWith("entity-collection-item");
      } catch {
        // Ordinary rendered text is not metadata.
      }
      if (isItemMarker) {
        if (current?.length) groups.push(current);
        current = [];
      } else if (current && !/^\d+\.\d+\.\d+(?:-\d+)?$/.test(value)) {
        current.push(value);
      }
    }
    if (current?.length) groups.push(current);
    if (groups.length > bestGroups.length) bestGroups = groups;
  }
  return bestGroups;
}

function collectionSemanticId(value: unknown): string | undefined {
  if (isRecord(value)
    && typeof value.semanticId === "string"
    && value.semanticId.startsWith("entity-collection-item")) return value.semanticId;
  if (typeof value !== "string" || !value.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed)
      && typeof parsed.semanticId === "string"
      && parsed.semanticId.startsWith("entity-collection-item")
      ? parsed.semanticId
      : undefined;
  } catch {
    return undefined;
  }
}

export function countDeclaredSectionItems(input: string): number {
  const rows = parseRows(input);
  const ids = new Set<string>();
  const seenReferences = new Set<string>();
  const seenObjects = new Set<object>();
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 100) return;
    if (typeof value === "string") {
      const reference = /^\$L?([0-9a-f]+)$/i.exec(value)?.[1]?.toLowerCase();
      if (reference && !seenReferences.has(reference)) {
        seenReferences.add(reference);
        visit(rows.get(reference), depth + 1);
        seenReferences.delete(reference);
      }
      const semanticId = collectionSemanticId(value);
      if (semanticId) ids.add(semanticId);
      return;
    }
    if (!value || typeof value !== "object" || seenObjects.has(value)) return;
    seenObjects.add(value);
    const semanticId = collectionSemanticId(value);
    if (semanticId) ids.add(semanticId);
    const children = Array.isArray(value) ? value : Object.values(value);
    children.forEach((child) => visit(child, depth + 1));
  };
  for (const value of rows.values()) visit(value);
  return ids.size;
}

function credentialTarget(value: string): string | undefined {
  try {
    const redirect = new URL(value);
    if (redirect.protocol !== "https:"
      || !/(?:^|\.)linkedin\.com$/i.test(redirect.hostname)
      || redirect.pathname !== "/safety/go/") return undefined;
    const target = new URL(redirect.searchParams.get("url") ?? "");
    return ["http:", "https:"].includes(target.protocol) && !target.username && !target.password
      ? target.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function rowCredentialUrls(value: unknown, rows: Map<string, unknown>): Array<string | undefined> {
  const markerOrder: string[] = [];
  const urls = new Map<string, string>();
  const seenReferences = new Set<string>();
  const seenObjects = new Set<object>();
  let marker: string | undefined;

  const visit = (candidate: unknown, depth = 0): void => {
    if (depth > 100) return;
    if (typeof candidate === "string") {
      const reference = /^\$L?([0-9a-f]+)$/i.exec(candidate)?.[1]?.toLowerCase();
      if (reference && !seenReferences.has(reference)) {
        seenReferences.add(reference);
        visit(rows.get(reference), depth + 1);
        seenReferences.delete(reference);
        return;
      }
      const semanticId = collectionSemanticId(candidate);
      if (semanticId) {
        marker = semanticId;
        if (!markerOrder.includes(semanticId)) markerOrder.push(semanticId);
      }
      const url = credentialTarget(candidate);
      if (marker && url && !urls.has(marker)) urls.set(marker, url);
      return;
    }
    if (!candidate || typeof candidate !== "object" || seenObjects.has(candidate)) return;
    seenObjects.add(candidate);
    const semanticId = collectionSemanticId(candidate);
    if (semanticId) {
      marker = semanticId;
      if (!markerOrder.includes(semanticId)) markerOrder.push(semanticId);
    }
    const children = Array.isArray(candidate) ? candidate : Object.values(candidate);
    children.forEach((child) => visit(child, depth + 1));
  };

  visit(value);
  return markerOrder.map((semanticId) => urls.get(semanticId));
}

function credentialUrls(input: string): Array<string | undefined> {
  const rows = parseRows(input);
  let best: Array<string | undefined> = [];
  for (const value of rows.values()) {
    const candidates = rowCredentialUrls(value, rows);
    if (candidates.filter(Boolean).length > best.filter(Boolean).length) best = candidates;
  }
  return best;
}

function looksLikePronouns(value: string): boolean {
  const pronoun = /^(?:he|him|his|she|her|hers|they|them|theirs|ze|zir|zie|hir|xe|xem)$/i;
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 3 && parts.every((part) => pronoun.test(part));
}

function validAbout(value: string | undefined, minimumLength = 40): value is string {
  return Boolean(
    value
    && value.length >= minimumLength
    && !/Talent Solutions|Marketing Solutions|Privacy & Terms/i.test(value),
  );
}

function aboutFromValues(
  values: string[],
  aboutIndex: number,
  minimumLength = 40,
): string | undefined {
  const candidates = values.slice(aboutIndex + 1);
  const possibleBoundary = candidates.findIndex((value) => /^(?:Top skills|Featured|Activity)$/i.test(value));
  // A one-word biography can legitimately equal a neighboring section label.
  // Treat it as a boundary only when there is preceding biography content or
  // following section content to support that interpretation.
  const boundary = possibleBoundary === 0 && candidates.length === 1 ? -1 : possibleBoundary;
  const content = boundary >= 0 ? candidates.slice(0, boundary) : candidates;
  const about = clean(content.join("\n"));
  return validAbout(about, minimumLength) ? about : undefined;
}

function aboutFromRows(rows: FlightRow[], minimumLength = 40): string | undefined {
  for (let index = 0; index < rows.length; index += 1) {
    const aboutIndex = rows[index]?.values.indexOf("About") ?? -1;
    if (aboutIndex < 0) continue;
    const inline = aboutFromValues(rows[index]!.values, aboutIndex, minimumLength);
    if (inline) return inline;
    for (const candidate of rows.slice(index + 1, index + 5)) {
      const value = clean(candidate.values.join("\n"));
      if (validAbout(value, minimumLength)) return value;
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
  if (depth > 80) return;
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
  );
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

export function extractIdentity(profileHtml: string, profileCardResponses: string[] = []): Identity {
  const decoded = flightStreams(profileHtml).join("\n");
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(profileHtml)?.[1]);
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
  // contain intentionally short biographies. Keep the minimum-length guard
  // only for the legacy page fallback, where unrelated navigation/footer
  // labels can also be named "About".
  const about = aboutFromRows(profileCardRows, 1) ?? aboutFromRows(parsed.values);

  return {
    ...(profileId ? { profileId } : {}),
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    profileImages: identityImageUrls(headerRow, parsed.rows, decoded),
  };
}

function looksLikeDate(value: string | undefined): boolean {
  return Boolean(value && /(?:19|20)\d{2}|Present/i.test(value) && /[-–·]/.test(value));
}

function looksLikeStandaloneDate(value: string | undefined): boolean {
  return Boolean(value && /^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+)?(?:19|20)\d{2}$/i.test(value));
}

function withoutDuration(value: string): string {
  const parts = value.split(/\s+·\s+/);
  if (parts.length > 1 && /^(?:\d+\s+)?(?:yrs?|mos?|years?|months?|less than a year)/i.test(parts.at(-1) ?? "")) {
    parts.pop();
  }
  return parts.join(" · ");
}

function splitOrganization(value: string): { organization?: string; kind?: string } {
  const parts = value.split(/\s+·\s+/).map((part) => clean(part)).filter(Boolean) as string[];
  const kind = parts.length > 1 && isEmploymentType(parts.at(-1)) ? parts.pop() : undefined;
  return {
    ...(parts.length ? { organization: parts.join(" · ") } : {}),
    ...(kind ? { kind } : {}),
  };
}

function isEmploymentType(value: string | undefined): value is string {
  return Boolean(value && /^(?:Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Apprenticeship|Seasonal)$/i.test(value));
}

function normalizeLocation(value: string | undefined): string | undefined {
  const parts = value?.split(/\s+·\s+/).map((part) => clean(part)).filter(Boolean) as string[] | undefined;
  if (!parts?.length) return undefined;
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : parts.join(" · ");
}

function semanticValues(value: unknown, rows: Map<string, unknown>): string[] {
  const output: string[] = [];
  collectSemanticText(value, rows, output);
  return output.filter((item, index) => item !== output[index - 1]);
}

function experienceDescription(values: string[]): string | undefined {
  const skillsIndex = values.findIndex((value) => /^Skills:$/i.test(value));
  const descriptionValues = skillsIndex >= 0 ? values.slice(0, skillsIndex) : values;
  return clean(descriptionValues.join("\n"));
}

function employmentType(values: string[]): string | undefined {
  const match = values
    .flatMap((value) => value.split(/\s+·\s+/))
    .map((value) => clean(value))
    .find(isEmploymentType);
  return match;
}

function looksLikeDescription(value: string | undefined): boolean {
  return Boolean(value && (value.length > 120 || /[.!?](?:\s|$)/u.test(value)));
}

function groupedExperience(values: string[]): Experience[] {
  const dateIndexes = values
    .map((value, index) => looksLikeDate(value) ? index : -1)
    .filter((index) => index >= 0);
  if (!dateIndexes.length) {
    const [title, organizationLine, possibleLocation, ...details] = values;
    if (!title) return [];
    const organization = splitOrganization(organizationLine ?? "");
    const location = possibleLocation && !looksLikeDescription(possibleLocation)
      ? normalizeLocation(possibleLocation)
      : undefined;
    const description = experienceDescription([
      ...(!location && possibleLocation ? [possibleLocation] : []),
      ...details,
    ]);
    return [{
      title,
      ...(organization.organization ? { company: organization.organization } : {}),
      ...(organization.kind ? { employmentType: organization.kind } : {}),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    }];
  }

  if (dateIndexes[0] === 1) {
    const [title, date, possibleLocation, ...details] = values;
    if (!title || !date) return [];
    const location = possibleLocation && !looksLikeDescription(possibleLocation)
      ? normalizeLocation(possibleLocation)
      : undefined;
    const description = experienceDescription([
      ...(!location && possibleLocation ? [possibleLocation] : []),
      ...details,
    ]);
    return [{
      title,
      dateRange: withoutDuration(date),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    }];
  }

  // Some collection responses still contain a conventional flat entry.
  if (dateIndexes[0] === 2) {
    const [title, organizationLine, date, locationOrDescription, ...details] = values;
    const organization = splitOrganization(organizationLine ?? "");
    const rawLocation = locationOrDescription && !looksLikeDescription(locationOrDescription)
      ? locationOrDescription
      : undefined;
    const description = experienceDescription([
      ...(!rawLocation && locationOrDescription ? [locationOrDescription] : []),
      ...details,
    ]);
    const location = normalizeLocation(rawLocation);
    return title ? [{
      title,
      ...(organization.organization ? { company: organization.organization } : {}),
      ...(organization.kind ? { employmentType: organization.kind } : {}),
      ...(date ? { dateRange: withoutDuration(date) } : {}),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    }] : [];
  }

  // LinkedIn groups several roles at one company into one collection item.
  // Each role title immediately precedes its date; the company metadata sits
  // before the first title/date pair.
  const company = clean(values[0]);
  const firstDateIndex = dateIndexes[0]!;
  const kind = employmentType(values.slice(1, Math.max(1, firstDateIndex - 1)));
  return dateIndexes.map((dateIndex, roleIndex): Experience | undefined => {
    const title = clean(values[dateIndex - 1]);
    const date = clean(values[dateIndex]);
    if (!title || !date || /^Skills:$/i.test(title)) return undefined;

    const nextDateIndex = dateIndexes[roleIndex + 1];
    const roleEnd = nextDateIndex === undefined ? values.length : nextDateIndex - 1;
    const afterDate = values.slice(dateIndex + 1, roleEnd);
    const rawLocation = afterDate[0]
      && !/^Skills:$/i.test(afterDate[0])
      && !looksLikeDescription(afterDate[0])
      ? afterDate[0]
      : undefined;
    const description = experienceDescription(afterDate.slice(rawLocation ? 1 : 0));
    const location = normalizeLocation(rawLocation);
    return {
      title,
      ...(company ? { company } : {}),
      ...(kind ? { employmentType: kind } : {}),
      dateRange: withoutDuration(date),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    };
  }).filter((value): value is Experience => Boolean(value));
}

function experienceMatchKey(value: Experience): string {
  return `${value.title}|${value.company ?? ""}|${value.dateRange ?? ""}`;
}

function experienceKey(value: Experience): string {
  return [
    experienceMatchKey(value),
    value.employmentType ?? "",
    value.location ?? "",
    value.description ?? "",
  ].join("|");
}

function mergeExperience(collection: Experience, flat: Experience | undefined): Experience {
  if (!flat) return collection;
  const collectionDescription = clean([
    ...(!flat.location && collection.location ? [collection.location] : []),
    ...(collection.description ? [collection.description] : []),
  ].join("\n"));
  return {
    title: flat.title,
    ...(flat.company ?? collection.company ? { company: flat.company ?? collection.company } : {}),
    ...(flat.employmentType ?? collection.employmentType
      ? { employmentType: flat.employmentType ?? collection.employmentType }
      : {}),
    ...(flat.dateRange ?? collection.dateRange ? { dateRange: flat.dateRange ?? collection.dateRange } : {}),
    ...(flat.location ? { location: flat.location } : {}),
    ...(collectionDescription ?? flat.description
      ? { description: collectionDescription ?? flat.description }
      : {}),
  };
}

export function extractExperience(input: string): Experience[] {
  const parsed = semanticRows(input);
  const itemRows = parsed.values.filter((row) =>
    row.id !== "0"
    && !row.values[0]?.startsWith("{")
    && row.values.length >= 3
    && looksLikeDate(row.values[2]));
  const itemIds = new Set(itemRows.map((row) => row.id));
  const flatExperience = unique(itemRows.map((row) => {
    const [title, organizationLine, date, locationOrDescription, ...inlineDetails] = row.values;
    const organization = splitOrganization(organizationLine ?? "");
    const nextId = (Number.parseInt(row.id, 16) + 1).toString(16);
    const nextValues = itemIds.has(nextId) ? [] : semanticValues(parsed.rows.get(nextId), parsed.rows);
    const rawLocation = locationOrDescription && !looksLikeDescription(locationOrDescription)
      ? locationOrDescription
      : undefined;
    const description = experienceDescription([
      ...(!rawLocation && locationOrDescription ? [locationOrDescription] : []),
      ...inlineDetails,
      ...nextValues.filter((value) => value !== title && value !== "Experience"),
    ]);
    const location = normalizeLocation(rawLocation);
    return {
      title: title!,
      ...(organization.organization ? { company: organization.organization } : {}),
      ...(organization.kind ? { employmentType: organization.kind } : {}),
      ...(date ? { dateRange: withoutDuration(date) } : {}),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    };
  }), experienceKey);
  const flatByKey = new Map<string, Experience[]>();
  for (const value of flatExperience) {
    const key = experienceMatchKey(value);
    flatByKey.set(key, [...(flatByKey.get(key) ?? []), value]);
  }
  const collectionExperience = entityCollectionGroups(input)
    .flatMap(groupedExperience)
    .map((value) => mergeExperience(value, flatByKey.get(experienceMatchKey(value))?.shift()));
  const unmatchedFlatExperience = [...flatByKey.values()].flat();
  return unique([...collectionExperience, ...unmatchedFlatExperience], experienceKey);
}

export function extractEducation(input: string): Education[] {
  const collectionGroups = entityCollectionGroups(input);
  if (collectionGroups.length) {
    return unique(collectionGroups.map((values): Education | undefined => {
      const school = clean(values[0]);
      if (!school) return undefined;
      const details = values.slice(1);
      const date = details.find((value) => looksLikeDate(value) || looksLikeStandaloneDate(value));
      const degreeLine = details.find((value) =>
        value !== date && !/^Grade:|^Activities and societies:/i.test(value));
      const separator = degreeLine?.indexOf(", ") ?? -1;
      const degree = separator >= 0 ? clean(degreeLine?.slice(0, separator)) : clean(degreeLine);
      const fieldOfStudy = separator >= 0 ? clean(degreeLine?.slice(separator + 2)) : undefined;
      const description = clean(details
        .filter((value) => value !== date && value !== degreeLine)
        .join("\n"));
      return {
        school,
        ...(degree ? { degree } : {}),
        ...(fieldOfStudy ? { fieldOfStudy } : {}),
        ...(date ? { dateRange: withoutDuration(date) } : {}),
        ...(description ? { description } : {}),
      };
    }).filter((value): value is Education => Boolean(value)), (value) => [
      value.school,
      value.degree ?? "",
      value.fieldOfStudy ?? "",
      value.dateRange ?? "",
      value.description ?? "",
    ].join("|"));
  }

  const parsed = semanticRows(input);
  const itemRows = parsed.values.filter((row) =>
    row.id !== "0"
    && !row.values[0]?.startsWith("{")
    && row.values.length >= 3
    && looksLikeDate(row.values[2]));
  const itemIds = new Set(itemRows.map((row) => row.id));
  return unique(itemRows.map((row) => {
    const [school, degreeLine, date] = row.values;
    const separator = degreeLine?.indexOf(", ") ?? -1;
    const degree = separator >= 0 ? clean(degreeLine?.slice(0, separator)) : clean(degreeLine);
    const fieldOfStudy = separator >= 0 ? clean(degreeLine?.slice(separator + 2)) : undefined;
    const descriptionParts: string[] = [];
    for (let offset = 1; offset <= 2; offset += 1) {
      const candidateId = (Number.parseInt(row.id, 16) + offset).toString(16);
      if (itemIds.has(candidateId)) break;
      const candidate = semanticValues(parsed.rows.get(candidateId), parsed.rows);
      if (candidate.some((value) => /^Grade:|activities|score|coursework/i.test(value))) {
        descriptionParts.push(...candidate);
      }
    }
    const description = clean(descriptionParts.join("\n"));
    return {
      school: school!,
      ...(degree ? { degree } : {}),
      ...(fieldOfStudy ? { fieldOfStudy } : {}),
      ...(date ? { dateRange: withoutDuration(date) } : {}),
      ...(description ? { description } : {}),
    };
  }), (value) => [
    value.school,
    value.degree ?? "",
    value.fieldOfStudy ?? "",
    value.dateRange ?? "",
    value.description ?? "",
  ].join("|"));
}

function firstPageItemRows(input: string): FlightRow[] {
  const parsed = semanticRows(input);
  if (parsed.values.some((row) => row.values.includes("Nothing to see for now"))) return [];
  const seen = new Set<string>();
  const seenFirstValues = new Set<string>();
  const items: FlightRow[] = [];
  for (const row of parsed.values) {
    if (row.id === "0") continue;
    const first = clean(row.values[0]);
    if (!first || first.startsWith("{") || first === "Skills" || first === "Languages" || first === "Licenses & certifications") {
      continue;
    }
    const key = row.values
      .map((value) => value.normalize("NFKC").toLowerCase())
      .join("|");
    if (seen.has(key)) continue;
    const firstKey = first.normalize("NFKC").toLowerCase();
    // LinkedIn commonly emits a one-value text echo after the richer item row.
    // Skip that echo without terminating the page, because valid items can
    // follow it and duplicate certification names may carry distinct metadata.
    if (row.values.length === 1 && seenFirstValues.has(firstKey)) continue;
    seen.add(key);
    seenFirstValues.add(firstKey);
    items.push(row);
  }
  return items;
}

export function extractSkills(input: string): string[] {
  return firstPageItemRows(input).map((row) => row.values[0]!).filter(Boolean);
}

export function extractCertifications(input: string): Certification[] {
  const collectionGroups = entityCollectionGroups(input);
  const itemValues = collectionGroups.length
    ? collectionGroups
    : firstPageItemRows(input).map((row) => row.values);
  const urls = credentialUrls(input);
  return itemValues.map((values, index) => {
    const [name, ...allDetails] = values;
    const skillsIndex = allDetails.findIndex((value) => /^Skills:$/i.test(value));
    const details = skillsIndex >= 0 ? allDetails.slice(0, skillsIndex) : allDetails;
    const issuedRaw = details.find((value) => /^Issued\b|^Expires\b/i.test(value));
    const credentialIdRaw = details.find((value) => /^Credential ID\b/i.test(value));
    const issuer = details.find((value) => value !== issuedRaw && value !== credentialIdRaw && !/^Show credential$/i.test(value));
    const issued = issuedRaw ? clean(issuedRaw.replace(/^Issued\s*/i, "")) : undefined;
    const credentialId = credentialIdRaw ? clean(credentialIdRaw.replace(/^Credential ID\s*/i, "")) : undefined;
    return {
      name: name!,
      ...(issuer ? { issuer } : {}),
      ...(issued ? { issued } : {}),
      ...(credentialId ? { credentialId } : {}),
      ...(urls[index] ? { credentialUrl: urls[index] } : {}),
    };
  });
}

export function extractLanguages(input: string): Language[] {
  const collectionGroups = entityCollectionGroups(input);
  if (collectionGroups.length) {
    return collectionGroups.map(([name, proficiency]) => ({
      name: name!,
      ...(proficiency ? { proficiency } : {}),
    })).filter((language) => Boolean(language.name));
  }
  return firstPageItemRows(input).map((row) => ({
    name: row.values[0]!,
    ...(row.values[1] ? { proficiency: row.values[1] } : {}),
  }));
}

export function countSectionItems(section: LinkedInSection, input: string): number {
  if (section === "experience") return extractExperience(input).length;
  if (section === "education") return extractEducation(input).length;
  if (section === "skills") return extractSkills(input).length;
  if (section === "certifications") return extractCertifications(input).length;
  return extractLanguages(input).length;
}

export function sectionPageSignature(section: LinkedInSection, input: string): string {
  const values = section === "experience" ? extractExperience(input)
    : section === "education" ? extractEducation(input)
      : section === "skills" ? extractSkills(input)
        : section === "certifications" ? extractCertifications(input)
          : extractLanguages(input);
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
  let experience = unique(responses.experience.flatMap(extractExperience), (value) =>
    experienceKey(value));
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
