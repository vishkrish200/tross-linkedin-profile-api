import { describe, expect, it } from "vitest";
import {
  countSectionItems,
  extractIdentity,
  extractProfileFromResponses,
} from "../src/provider/extract-profile.js";
import {
  certificationsFlight,
  educationFlight,
  experienceFlight,
  languagesFlight,
  profileHtml,
  skillsFlight,
} from "./fixtures/profile-responses.js";

describe("LinkedIn React Flight extraction", () => {
  it("extracts identity and the transient profile id from the direct profile page", () => {
    expect(extractIdentity(profileHtml)).toEqual({
      profileId: "profile-example",
      name: "Vishnu Example",
      headline: "Software Engineer building agentic systems",
      location: "Bengaluru, Karnataka, India",
      about: "I build reliable products and evaluation systems for agentic software.",
      profileImages: ["https://media.example.test/profile-displayphoto-scale_400_400/example.jpg"],
    });
  });

  it("maps RSC section responses into the stable public schema", () => {
    const profile = extractProfileFromResponses(
      profileHtml,
      {
        experience: [experienceFlight],
        education: [educationFlight],
        skills: [skillsFlight],
        certifications: [certificationsFlight],
        languages: [languagesFlight],
      },
      "https://www.linkedin.com/in/vishnu-example/",
      new Date("2026-08-28T00:00:00.000Z"),
    );

    expect(profile).toEqual({
      sourceUrl: "https://www.linkedin.com/in/vishnu-example/",
      fetchedAt: "2026-08-28T00:00:00.000Z",
      name: "Vishnu Example",
      headline: "Software Engineer building agentic systems",
      location: "Bengaluru, Karnataka, India",
      about: "I build reliable products and evaluation systems for agentic software.",
      experience: [{
        title: "Senior Software Engineer",
        company: "Example Labs",
        employmentType: "Full-time",
        dateRange: "Jan 2024 - Present",
        location: "Bengaluru, India · Hybrid",
        description: "• Built dependable agent systems. • Added deterministic evaluations.",
      }],
      education: [{
        school: "Example Institute",
        degree: "Bachelor of Technology",
        fieldOfStudy: "Computer Science",
        dateRange: "2018 – 2022",
      }],
      skills: ["TypeScript", "Distributed Systems"],
      certifications: [{
        name: "Cloud Engineer",
        issuer: "Example Cloud",
        issued: "Jan 2025",
        credentialId: "EXAMPLE-123",
      }],
      languages: [{ name: "English", proficiency: "Professional working proficiency" }],
      profileImages: ["https://media.example.test/profile-displayphoto-scale_400_400/example.jpg"],
      warnings: [],
    });
  });

  it("reports the number of first-page section items for pagination", () => {
    expect(countSectionItems("experience", experienceFlight)).toBe(1);
    expect(countSectionItems("education", educationFlight)).toBe(1);
    expect(countSectionItems("skills", skillsFlight)).toBe(2);
  });
});
