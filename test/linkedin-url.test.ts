import { describe, expect, it } from "vitest";
import { normalizeLinkedInProfileUrl } from "../src/domain/linkedin-url.js";

describe("normalizeLinkedInProfileUrl", () => {
  it("canonicalizes a LinkedIn profile URL", () => {
    expect(normalizeLinkedInProfileUrl("https://linkedin.com/in/vishnu2krishnan?trk=test#about")).toBe(
      "https://www.linkedin.com/in/vishnu2krishnan/",
    );
  });

  it.each([
    "http://www.linkedin.com/in/person",
    "https://linkedin.example/in/person",
    "https://www.linkedin.com/company/example",
    "https://www.linkedin.com/in/",
    "https://www.linkedin.com/in/%/",
    "https://www.linkedin.com/in/person%2Fextra/",
    "https://www.linkedin.com/in/person%5Cextra/",
    "https://www.linkedin.com/in/person%252Fextra/",
    "https://www.linkedin.com/in/person%3Fquery/",
    "https://www.linkedin.com/in/person%23fragment/",
    "https://www.linkedin.com/in/person%00control/",
    "https://www.linkedin.com/in/person@example/",
    "https://user:password@www.linkedin.com/in/person/",
    "https://www.linkedin.com:444/in/person/",
    `https://www.linkedin.com/in/${"a".repeat(101)}/`,
    "not a url",
  ])("rejects unsafe or non-profile input: %s", (input) => {
    expect(() => normalizeLinkedInProfileUrl(input)).toThrow();
  });

  it("preserves a valid percent-encoded Unicode public identifier", () => {
    expect(normalizeLinkedInProfileUrl("https://www.linkedin.com/in/%E6%B5%8B%E8%AF%95/"))
      .toBe("https://www.linkedin.com/in/%E6%B5%8B%E8%AF%95/");
  });
});
