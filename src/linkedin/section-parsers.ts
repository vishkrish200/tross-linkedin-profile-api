import type {
  Certification,
  Education,
  Experience,
  Language,
} from "../domain/profile.js";
import {
  clean,
  isRecord,
  parseRows,
  semanticRows,
  semanticValues,
  unique,
  type FlightRow,
} from "./react-flight-parser.js";

// Shared entity-collection decoding used by LinkedIn's section pages.
type EntityCollectionGroup = {
  semanticId: string;
  values: string[];
};

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

function entityCollectionGroups(input: string): EntityCollectionGroup[] {
  let bestGroups: EntityCollectionGroup[] = [];
  for (const row of semanticRows(input).values) {
    const groups: EntityCollectionGroup[] = [];
    let current: EntityCollectionGroup | undefined;
    for (const value of row.values) {
      const semanticId = collectionSemanticId(value);
      if (semanticId) {
        if (current?.values.length) groups.push(current);
        current = { semanticId, values: [] };
      } else if (current && !/^\d+\.\d+\.\d+(?:-\d+)?$/.test(value)) {
        current.values.push(value);
      }
    }
    if (current?.values.length) groups.push(current);
    if (groups.length > bestGroups.length) bestGroups = groups;
  }
  return bestGroups;
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

// Certification credential links are joined by LinkedIn semantic identity,
// never by array position.
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

type CredentialUrlIndex = {
  bySemanticId: Map<string, string>;
};

function rowCredentialUrls(value: unknown, rows: Map<string, unknown>): CredentialUrlIndex {
  const bySemanticId = new Map<string, string>();
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
      }
      const url = credentialTarget(candidate);
      if (marker && url && !bySemanticId.has(marker)) bySemanticId.set(marker, url);
      return;
    }
    if (!candidate || typeof candidate !== "object" || seenObjects.has(candidate)) return;
    seenObjects.add(candidate);
    const semanticId = collectionSemanticId(candidate);
    if (semanticId) {
      marker = semanticId;
    }
    const children = Array.isArray(candidate) ? candidate : Object.values(candidate);
    children.forEach((child) => visit(child, depth + 1));
  };

  visit(value);
  return { bySemanticId };
}

function credentialUrls(input: string): CredentialUrlIndex {
  const rows = parseRows(input);
  let best: CredentialUrlIndex = { bySemanticId: new Map() };
  for (const value of rows.values()) {
    const candidates = rowCredentialUrls(value, rows);
    if (candidates.bySemanticId.size > best.bySemanticId.size) best = candidates;
  }
  return best;
}

// Experience and education parsing.
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

function experienceDescription(values: string[]): string | undefined {
  const skillsIndex = values.findIndex((value) => /^Skills:$/i.test(value));
  const descriptionValues = skillsIndex >= 0 ? values.slice(0, skillsIndex) : values;
  return clean(descriptionValues.join("\n"));
}

function employmentType(values: string[]): string | undefined {
  return values
    .flatMap((value) => value.split(/\s+·\s+/))
    .map((value) => clean(value))
    .find(isEmploymentType);
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

export function experienceKey(value: Experience): string {
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

export function parseExperienceSection(input: string): Experience[] {
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
    .flatMap(({ values }) => groupedExperience(values))
    .map((value) => mergeExperience(value, flatByKey.get(experienceMatchKey(value))?.shift()));
  const unmatchedFlatExperience = [...flatByKey.values()].flat();
  return unique([...collectionExperience, ...unmatchedFlatExperience], experienceKey);
}

export function parseEducationSection(input: string): Education[] {
  const collectionGroups = entityCollectionGroups(input);
  if (collectionGroups.length) {
    return unique(collectionGroups.map(({ values }): Education | undefined => {
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

// Skills, certifications, and languages share LinkedIn's flatter list shape.
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

export function parseSkillsSection(input: string): string[] {
  return firstPageItemRows(input).map((row) => row.values[0]!).filter(Boolean);
}

export function parseCertificationsSection(input: string): Certification[] {
  const collectionGroups = entityCollectionGroups(input);
  const urls = credentialUrls(input);
  const items = collectionGroups.length
    ? collectionGroups.map(({ semanticId, values }) => ({
        values,
        credentialUrl: urls.bySemanticId.get(semanticId),
      }))
    : firstPageItemRows(input).map((row) => ({
        values: row.values,
        credentialUrl: undefined,
      }));
  return items.map(({ values, credentialUrl }) => {
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
      ...(credentialUrl ? { credentialUrl } : {}),
    };
  });
}

export function parseLanguagesSection(input: string): Language[] {
  const collectionGroups = entityCollectionGroups(input);
  if (collectionGroups.length) {
    return collectionGroups.map(({ values: [name, proficiency] }) => ({
      name: name!,
      ...(proficiency ? { proficiency } : {}),
    })).filter((language) => Boolean(language.name));
  }
  return firstPageItemRows(input).map((row) => ({
    name: row.values[0]!,
    ...(row.values[1] ? { proficiency: row.values[1] } : {}),
  }));
}
