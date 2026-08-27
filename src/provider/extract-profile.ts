import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  Certification,
  Education,
  Experience,
  Language,
  Profile,
} from "../domain/profile.js";

const whitespace = /\s+/g;
const dateSignal = /\b(?:19|20)\d{2}\b|\bPresent\b|\b(?:yr|yrs|mo|mos)\b/i;

function clean(value: string | undefined): string | undefined {
  const normalized = value?.replace(whitespace, " ").trim();
  return normalized || undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter((value): value is string => Boolean(value)))];
}

function firstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = clean($(selector).first().text());
    if (value) return value;
  }
  return undefined;
}

function section($: cheerio.CheerioAPI, id: string): cheerio.Cheerio<AnyNode> {
  const anchor = $(`#${id}`).first();
  if (!anchor.length) return $([]);
  const parentSection = anchor.closest("section");
  return parentSection.length ? parentSection : anchor.parent();
}

function itemLines($: cheerio.CheerioAPI, id: string): string[][] {
  const root = section($, id);
  if (!root.length) return [];

  let items = root.find("li.pvs-list__paged-list-item, li.artdeco-list__item");
  if (!items.length) items = root.find("li");

  const seen = new Set<string>();
  const output: string[][] = [];
  items.each((_, item) => {
    const lines = unique(
      $(item)
        .text()
        .split(/\r?\n/)
        .map((line) => line.replace(/Show credential|See more/gi, "")),
    );
    const key = lines.join("|");
    if (lines.length && !seen.has(key)) {
      seen.add(key);
      output.push(lines);
    }
  });
  return output;
}

function parseExperience(lines: string[]): Experience | undefined {
  const title = lines[0];
  if (!title) return undefined;
  const dateIndex = lines.findIndex((line, index) => index > 0 && dateSignal.test(line));
  const companyLine = lines[1];
  const [company, employmentType] = (companyLine ?? "").split(" · ").map(clean);
  const location = dateIndex >= 0 ? clean(lines[dateIndex + 1]) : undefined;
  const descriptionStart = dateIndex >= 0 ? dateIndex + (location ? 2 : 1) : 2;
  const description = clean(lines.slice(descriptionStart).join(" "));
  return {
    title,
    ...(company ? { company } : {}),
    ...(employmentType ? { employmentType } : {}),
    ...(dateIndex >= 0 && lines[dateIndex] ? { dateRange: lines[dateIndex] } : {}),
    ...(location ? { location } : {}),
    ...(description ? { description } : {}),
  };
}

function parseEducation(lines: string[]): Education | undefined {
  const school = lines[0];
  if (!school) return undefined;
  const dateIndex = lines.findIndex((line, index) => index > 0 && dateSignal.test(line));
  const degreeLine = dateIndex === 2 ? lines[1] : undefined;
  const [degree, fieldOfStudy] = (degreeLine ?? "").split(", ").map(clean);
  const description = clean(lines.slice(dateIndex >= 0 ? dateIndex + 1 : 2).join(" "));
  return {
    school,
    ...(degree ? { degree } : {}),
    ...(fieldOfStudy ? { fieldOfStudy } : {}),
    ...(dateIndex >= 0 && lines[dateIndex] ? { dateRange: lines[dateIndex] } : {}),
    ...(description ? { description } : {}),
  };
}

function parseCertification(lines: string[], href?: string): Certification | undefined {
  const name = lines[0];
  if (!name) return undefined;
  const issued = lines.find((line) => /^Issued\b/i.test(line));
  const credentialId = lines.find((line) => /^Credential ID\b/i.test(line));
  return {
    name,
    ...(lines[1] ? { issuer: lines[1] } : {}),
    ...(issued ? { issued } : {}),
    ...(credentialId ? { credentialId } : {}),
    ...(href?.startsWith("http") ? { credentialUrl: href } : {}),
  };
}

function parseLanguage(lines: string[]): Language | undefined {
  const name = lines[0];
  if (!name) return undefined;
  return { name, ...(lines[1] ? { proficiency: lines[1] } : {}) };
}

function aboutText($: cheerio.CheerioAPI): string | undefined {
  const root = section($, "about");
  if (!root.length) return undefined;
  const preferred = clean(root.find(".inline-show-more-text").first().text());
  if (preferred) return preferred;
  const text = clean(root.text());
  return clean(text?.replace(/^About\s*/i, "").replace(/see more/gi, ""));
}

export function extractProfileFromHtml(html: string, sourceUrl: string): Profile {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const name = firstText($, ["main h1", "h1.text-heading-xlarge", "meta[property='og:title']"]);
  const headline = firstText($, [
    "main .text-body-medium.break-words",
    ".pv-text-details__left-panel .text-body-medium",
  ]);
  const location = firstText($, [
    "main .text-body-small.inline.t-black--light.break-words",
    ".pv-text-details__left-panel .text-body-small",
  ]);

  const experience = itemLines($, "experience")
    .map(parseExperience)
    .filter((value): value is Experience => Boolean(value));
  const education = itemLines($, "education")
    .map(parseEducation)
    .filter((value): value is Education => Boolean(value));
  const skills = unique(itemLines($, "skills").map((lines) => lines[0]));

  const certificationRoot = section($, "licenses_and_certifications");
  const certificationLines = itemLines($, "licenses_and_certifications");
  const certificationLinks = certificationRoot
    .find("li.pvs-list__paged-list-item a[href], li.artdeco-list__item a[href]")
    .map((_, link) => $(link).attr("href"))
    .get();
  const certifications = certificationLines
    .map((lines, index) => parseCertification(lines, certificationLinks[index]))
    .filter((value): value is Certification => Boolean(value));

  const languages = itemLines($, "languages")
    .map(parseLanguage)
    .filter((value): value is Language => Boolean(value));

  const ogImage = $("meta[property='og:image']").attr("content");
  const profileImage = $("img.pv-top-card-profile-picture__image, img.pv-top-card-profile-picture__image--show")
    .first()
    .attr("src");
  const profileImages = unique([profileImage, ogImage]).filter((value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  });

  if (!name) warnings.push("Profile name was not found; the page markup may have changed.");
  if (!experience.length) warnings.push("No experience entries were visible in the rendered page.");
  if (!education.length) warnings.push("No education entries were visible in the rendered page.");

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(aboutText($) ? { about: aboutText($) } : {}),
    experience,
    education,
    skills,
    certifications,
    languages,
    profileImages,
    warnings,
  };
}
