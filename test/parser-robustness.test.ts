import { describe, expect, it } from "vitest";
import { profileSchema } from "../src/domain/profile.js";
import {
  countSectionItems,
  extractAboutComponentRequest,
  extractCertifications,
  extractEducation,
  extractExperience,
  extractLanguages,
  extractProfileFromResponses,
  extractSkills,
} from "../src/provider/extract-profile.js";
import { profileHtml, skillsFlight } from "./fixtures/profile-responses.js";

const emptyResponses = {
  experience: [],
  education: [],
  skills: [],
  certifications: [],
  languages: [],
};

function nestedElement(depth: number): unknown {
  let value: unknown = "unreachable text";
  for (let index = 0; index < depth; index += 1) {
    value = ["$", "div", null, { children: value }];
  }
  return value;
}

describe("adversarial React Flight parsing", () => {
  it("bounds malformed, missing, duplicate, cyclic-adjacent, and deeply nested structures", () => {
    const variants = [
      "",
      "garbage without rows",
      "0:[\"$\",\"div\",null,{\"children\":\"$dead\"}]",
      [
        "0:[\"$\",\"div\",null,{\"children\":[\"$1\",\"$1\"]}]",
        "1:[\"$\",\"p\",null,{\"children\":[\"Repeated\"]}]",
      ].join("\n"),
      `0:${JSON.stringify(nestedElement(120))}`,
      "0:[not-json",
      "zz:[\"$\",\"p\",null,{\"children\":[\"Non-hex row\"]}]",
      "<script id=\"rehydrate-data\">window.__como_rehydration__ = not-json;</script>",
      skillsFlight.replaceAll("\n", "\r\n"),
    ];

    for (const input of variants) {
      const outputs = [
        extractExperience(input),
        extractEducation(input),
        extractSkills(input),
        extractCertifications(input),
        extractLanguages(input),
      ];
      for (const output of outputs) expect(output.length).toBeLessThanOrEqual(100);
      for (const section of ["experience", "education", "skills", "certifications", "languages"] as const) {
        expect(countSectionItems(section, input)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps deterministic mutations schema-valid and never invents profile identity", () => {
    const mutations = [
      skillsFlight.slice(1),
      skillsFlight.slice(0, -1),
      skillsFlight.replace(/:/g, "::"),
      `${skillsFlight}\n${skillsFlight}`,
      `unknown-row-kind\n${skillsFlight}`,
      skillsFlight.replace("TypeScript", "$missing"),
    ];

    for (const mutation of mutations) {
      const profile = extractProfileFromResponses(
        profileHtml,
        { ...emptyResponses, skills: [mutation] },
        "https://www.linkedin.com/in/vishnu-example/",
        new Date("2026-08-29T00:00:00.000Z"),
      );
      expect(() => profileSchema.parse(profile)).not.toThrow();
      expect(profile.name).toBe("Vishnu Example");
      expect(profile.skills.length).toBeLessThanOrEqual(20);
    }
  });

  it("fails safely on malformed lazy-card wrappers", () => {
    const malformed = [
      "",
      "0:{}",
      "0:[\"$\",\"LazyCard\",null,{\"componentKey\":\"profileCardsAboveActivityTopcardOnlyx\"}]",
      `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify(["0:$missing"])};</script>`,
    ];
    for (const input of malformed) {
      expect(() => extractAboutComponentRequest(input)).not.toThrow();
    }
  });
});
