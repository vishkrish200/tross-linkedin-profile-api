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

type Identity = {
  profileId?: string;
  name?: string;
  headline?: string;
  location?: string;
  about?: string;
  profileImages: string[];
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
    collectSemanticText(textProps?.children ?? props?.children, rows, output, seen, depth + 1);
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
    && /profile-displayphoto/i.test(value.rootUrl)
    && Array.isArray(value.imageRenditions)) {
    const renditions = value.imageRenditions
      .filter((rendition): rendition is Record<string, unknown> => isRecord(rendition))
      .filter((rendition) => typeof rendition.suffixUrl === "string")
      .sort((left, right) => Number(left.width ?? 0) - Number(right.width ?? 0));
    for (const rendition of renditions) {
      const url = `${value.rootUrl}${rendition.suffixUrl as string}`;
      try {
        if (new URL(url).protocol === "https:") output.push(url);
      } catch {
        // Ignore malformed upstream image renditions.
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
    .filter((url) => /profile-displayphoto/i.test(url))
    .filter((url) => {
      try {
        return new URL(url).protocol === "https:" && !/[-_]$/.test(url);
      } catch {
        return false;
      }
    });
  const firstGroup = urls[0]?.split("/profile-displayphoto")[0];
  return unique(
    firstGroup ? urls.filter((url) => url.startsWith(`${firstGroup}/profile-displayphoto`)) : [],
    (url) => url,
  );
}

export function extractIdentity(profileHtml: string): Identity {
  const decoded = flightStreams(profileHtml).join("\n");
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(profileHtml)?.[1]);
  const name = title?.replace(/\s*\|\s*LinkedIn\s*$/i, "").trim() || undefined;
  const profileId = /"profileId":"([^"]+)"/.exec(decoded)?.[1];
  const parsed = semanticRows(profileHtml);
  const rows = parsed.values;
  const headerRow = rows.find((row) => row.values.length > 1 && row.values.includes("Contact info"));
  const contactValueIndex = headerRow?.values.indexOf("Contact info") ?? -1;
  const headerValues = contactValueIndex > 0
    ? headerRow!.values.slice(0, contactValueIndex).filter((value) =>
      value !== name
      && value !== "·"
      && !/^·\s*(?:1st|2nd|3rd)$/i.test(value))
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

  let about: string | undefined;
  for (let index = 0; index < rows.length && !about; index += 1) {
    if (rows[index]?.values.length !== 1 || rows[index]?.values[0] !== "About") continue;
    for (const candidate of rows.slice(index + 1, index + 5)) {
      const value = clean(candidate.values.join("\n"));
      if (value && value.length >= 40 && !/Talent Solutions|Marketing Solutions|Privacy & Terms/i.test(value)) {
        about = value;
        break;
      }
    }
  }

  const profileImages: string[] = [];
  if (headerRow) {
    structuredImageUrls(parsed.rows.get(headerRow.id), parsed.rows, profileImages);
  }

  return {
    ...(profileId ? { profileId } : {}),
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    profileImages: unique(profileImages.length ? profileImages : validImageUrls(decoded), (url) => url),
  };
}

function looksLikeDate(value: string | undefined): boolean {
  return Boolean(value && /(?:19|20)\d{2}|Present/i.test(value) && /[-–·]/.test(value));
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
  return {
    ...(parts[0] ? { organization: parts[0] } : {}),
    ...(parts[1] ? { kind: parts.slice(1).join(" · ") } : {}),
  };
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

export function extractExperience(input: string): Experience[] {
  const parsed = semanticRows(input);
  const itemRows = parsed.values.filter((row) =>
    row.id !== "0"
    && !row.values[0]?.startsWith("{")
    && row.values.length >= 3
    && looksLikeDate(row.values[2]));
  return unique(itemRows.map((row) => {
    const [title, organizationLine, date, rawLocation] = row.values;
    const organization = splitOrganization(organizationLine ?? "");
    const nextId = (Number.parseInt(row.id, 16) + 1).toString(16);
    const descriptionValues = semanticValues(parsed.rows.get(nextId), parsed.rows);
    const description = descriptionValues[0]?.startsWith("•")
      ? clean(descriptionValues.join("\n"))
      : undefined;
    const location = normalizeLocation(rawLocation);
    return {
      title: title!,
      ...(organization.organization ? { company: organization.organization } : {}),
      ...(organization.kind ? { employmentType: organization.kind } : {}),
      ...(date ? { dateRange: withoutDuration(date) } : {}),
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
    };
  }), (value) => `${value.title}|${value.company ?? ""}|${value.dateRange ?? ""}`);
}

export function extractEducation(input: string): Education[] {
  const parsed = semanticRows(input);
  const itemRows = parsed.values.filter((row) =>
    row.id !== "0"
    && !row.values[0]?.startsWith("{")
    && row.values.length >= 3
    && looksLikeDate(row.values[2]));
  const itemIds = new Set(itemRows.map((row) => row.id));
  return unique(itemRows.map((row) => {
    const [school, degreeLine, date] = row.values;
    const degreeParts = degreeLine?.split(/,\s+/, 2) ?? [];
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
      ...(degreeParts[0] ? { degree: degreeParts[0] } : {}),
      ...(degreeParts[1] ? { fieldOfStudy: degreeParts[1] } : {}),
      ...(date ? { dateRange: withoutDuration(date) } : {}),
      ...(description ? { description } : {}),
    };
  }), (value) => `${value.school}|${value.degree ?? ""}|${value.dateRange ?? ""}`);
}

function firstPageItemRows(input: string): FlightRow[] {
  const parsed = semanticRows(input);
  if (parsed.values.some((row) => row.values.includes("Nothing to see for now"))) return [];
  const seen = new Set<string>();
  const items: FlightRow[] = [];
  for (const row of parsed.values) {
    if (row.id === "0") continue;
    const first = clean(row.values[0]);
    if (!first || first.startsWith("{") || first === "Skills" || first === "Languages" || first === "Licenses & certifications") {
      continue;
    }
    const key = first.toLowerCase();
    if (seen.has(key)) break;
    seen.add(key);
    items.push(row);
  }
  return items;
}

export function extractSkills(input: string): string[] {
  return firstPageItemRows(input).map((row) => row.values[0]!).filter(Boolean);
}

export function extractCertifications(input: string): Certification[] {
  const collectionGroups: string[][] = [];
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
      } else if (current) {
        current.push(value);
      }
    }
    if (current?.length) groups.push(current);
    if (groups.length > collectionGroups.length) {
      collectionGroups.splice(0, collectionGroups.length, ...groups);
    }
  }

  const itemValues = collectionGroups.length
    ? collectionGroups
    : firstPageItemRows(input).map((row) => row.values);
  return itemValues.map((values) => {
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
    };
  });
}

export function extractLanguages(input: string): Language[] {
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

export function extractProfileFromResponses(
  profileHtml: string,
  responses: LinkedInResponses,
  sourceUrl: string,
  now: Date = new Date(),
): Profile {
  const identity = extractIdentity(profileHtml);
  const experience = unique(responses.experience.flatMap(extractExperience), (value) =>
    `${value.title}|${value.company ?? ""}|${value.dateRange ?? ""}`);
  const education = unique(responses.education.flatMap(extractEducation), (value) =>
    `${value.school}|${value.degree ?? ""}|${value.dateRange ?? ""}`);
  const skills = unique(responses.skills.flatMap(extractSkills), (value) => value.toLowerCase());
  const certifications = unique(responses.certifications.flatMap(extractCertifications), (value) =>
    `${value.name}|${value.issuer ?? ""}`);
  const languages = unique(responses.languages.flatMap(extractLanguages), (value) => value.name.toLowerCase());
  const warnings: string[] = [];
  if (!identity.name) warnings.push("Profile name was not present in LinkedIn's response.");
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
