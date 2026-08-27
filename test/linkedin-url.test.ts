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
    "not a url",
  ])("rejects unsafe or non-profile input: %s", (input) => {
    expect(() => normalizeLinkedInProfileUrl(input)).toThrow();
  });
});
