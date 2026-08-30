import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { normalizeLinkedInProfileUrl } from "../src/domain/linkedin-url.js";
import { PROFILE_SECTION_ITEM_LIMIT, profileSchema } from "../src/domain/profile.js";

const matrixFile = process.env.PROFILE_MATRIX_FILE;
if (!matrixFile) throw new Error("PROFILE_MATRIX_FILE is required");

const matrix = z.array(z.object({
  case: z.number().int().positive(),
  url: z.string(),
})).min(1).parse(JSON.parse(await readFile(matrixFile, "utf8")))
  .map((entry) => ({ ...entry, url: normalizeLinkedInProfileUrl(entry.url) }));
if (new Set(matrix.map((entry) => entry.case)).size !== matrix.length
  || new Set(matrix.map((entry) => entry.url)).size !== matrix.length) {
  throw new Error("The matrix must contain unique case labels and full profile URLs");
}

const endpoint = process.env.PROFILE_API_URL ?? "http://127.0.0.1:3000/v1/profiles";
const headers = {
  "content-type": "application/json",
  ...(process.env.API_KEY ? { authorization: `Bearer ${process.env.API_KEY}` } : {}),
};
let attempted = 0;
let passed = 0;

for (const entry of matrix) {
  // Keep the canary low-frequency in addition to the API's own request limiter.
  if (attempted > 0) await delay(20_000);
  attempted += 1;
  const started = performance.now();
  let response: Response | undefined;
  let body: unknown;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: entry.url }),
      signal: AbortSignal.timeout(60_000),
    });
    body = await response.json();
  } catch {
    console.log(JSON.stringify({
      case: entry.case,
      ...(response ? { status: response.status } : {}),
      error: response ? "invalid_json_response" : "request_failed",
      elapsedMs: Math.round(performance.now() - started),
      stopped: true,
    }));
    process.exitCode = 1;
    break;
  }
  const elapsedMs = Math.round(performance.now() - started);
  const envelope = z.object({ data: profileSchema }).safeParse(body);
  if (!response.ok || !envelope.success) {
    const error = z.object({ error: z.string() }).safeParse(body);
    console.log(JSON.stringify({
      case: entry.case,
      status: response.status,
      error: error.success ? error.data.error : "invalid_response_contract",
      elapsedMs,
      stopped: true,
    }));
    process.exitCode = 1;
    break;
  }

  passed += 1;
  const profile = envelope.data.data;
  console.log(JSON.stringify({
    case: entry.case,
    status: response.status,
    elapsedMs,
    fields: {
      name: Boolean(profile.name),
      headline: Boolean(profile.headline),
      location: Boolean(profile.location),
      about: Boolean(profile.about),
    },
    counts: {
      experience: profile.experience.length,
      education: profile.education.length,
      skills: profile.skills.length,
      certifications: profile.certifications.length,
      languages: profile.languages.length,
      profileImages: profile.profileImages.length,
      warnings: profile.warnings.length,
    },
    possiblyTruncatedSections: profile.warnings
      .filter((warning) => warning.includes(`${PROFILE_SECTION_ITEM_LIMIT}-item safety limit`))
      .map((warning) => warning.split(" ", 1)[0]),
  }));
}

console.log(JSON.stringify({ total: matrix.length, attempted, passed }));
