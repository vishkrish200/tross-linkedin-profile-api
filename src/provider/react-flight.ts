export type FlightRow = { id: string; values: string[] };

export function clean(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

export function unique<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function flightStreams(input: string): string[] {
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

export function parseRows(input: string): Map<string, unknown> {
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
    collectSemanticText(content, rows, output, seen, depth + 1);
    return;
  }
  value.forEach((item) => collectSemanticText(item, rows, output, seen, depth + 1));
}

export function semanticRows(input: string): { rows: Map<string, unknown>; values: FlightRow[] } {
  const rows = parseRows(input);
  const values = [...rows].map(([id, value]) => {
    const output: string[] = [];
    collectSemanticText(value, rows, output);
    return { id, values: output.filter((item, index) => item !== output[index - 1]) };
  }).filter((row) => row.values.length);
  return { rows, values };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function findRecord(
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

export function semanticValues(value: unknown, rows: Map<string, unknown>): string[] {
  const output: string[] = [];
  collectSemanticText(value, rows, output);
  return output.filter((item, index) => item !== output[index - 1]);
}
