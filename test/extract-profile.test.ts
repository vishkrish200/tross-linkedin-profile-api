import { describe, expect, it } from "vitest";
import {
  countSectionItems,
  extractCertifications,
  extractEducation,
  extractExperience,
  extractIdentity,
  extractLanguages,
  extractProfileFromResponses,
} from "../src/provider/extract-profile.js";
import {
  certificationsFlight,
  educationFlight,
  experienceFlight,
  groupedExperienceFlight,
  languagesFlight,
  liveShapedCertificationsFlight,
  liveShapedEducationWithoutDatesFlight,
  liveShapedLanguagesFlight,
  liveShapedProfileHtml,
  profileHtml,
  rootImageProfileHtml,
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

  it("extracts identity and complete image renditions from the current composite header shape", () => {
    expect(extractIdentity(liveShapedProfileHtml)).toEqual({
      profileId: "profile-live-shaped",
      name: "Example Person",
      headline: "Applied AI Engineer",
      location: "Example City, India",
      profileImages: [
        "https://media.example.test/profile-displayphoto-shrink_100_100/example-small.jpg",
        "https://media.example.test/profile-displayphoto-shrink_400_400/example-large.jpg",
      ],
    });
  });

  it("extracts profile images when they are attached to the root profile component", () => {
    expect(extractIdentity(rootImageProfileHtml)).toEqual({
      profileId: "profile-root-image",
      name: "Root Image Person",
      headline: "Root Image Engineer",
      location: "Example City, India",
      profileImages: [
        "https://media.example.test/profile-displayphoto-shrink_100_100/root-small.jpg",
        "https://media.example.test/profile-displayphoto-shrink_400_400/root-large.jpg",
      ],
    });
  });

  it("extracts multiple roles grouped under one company", () => {
    expect(extractExperience(groupedExperienceFlight)).toEqual([
      {
        title: "Senior Product Manager",
        company: "Example Company",
        employmentType: "Full-time",
        dateRange: "Jan 2023 - Present",
        location: "Remote",
        description: "Led the current product portfolio.",
      },
      {
        title: "Product Manager",
        company: "Example Company",
        employmentType: "Full-time",
        dateRange: "Jan 2020 - Dec 2022",
        location: "Example City, India · On-site",
        description: "Built the first version of the product.",
      },
    ]);
    expect(countSectionItems("experience", groupedExperienceFlight)).toBe(2);
  });

  it("groups current certification rows by LinkedIn collection metadata", () => {
    expect(extractCertifications(liveShapedCertificationsFlight)).toEqual([
      {
        name: "Machine Learning Associate",
        issuer: "Example Cloud",
        issued: "Nov 2024 · Expires Nov 2026",
      },
      {
        name: "Generative AI Professional",
        issuer: "Example Cloud",
        issued: "Oct 2024",
      },
    ]);
    expect(countSectionItems("certifications", liveShapedCertificationsFlight)).toBe(2);
  });

  it("keeps education entries when LinkedIn omits their date ranges", () => {
    expect(extractEducation(liveShapedEducationWithoutDatesFlight)).toEqual([
      {
        school: "Example University",
        degree: "BS",
        fieldOfStudy: "Quantitative Sciences; BA, Economics & Mathematics",
        description: "Activities and societies: - Student Council",
      },
      {
        school: "Example Summer School",
        degree: "Summer Program",
        fieldOfStudy: "Product Development",
      },
      {
        school: "Example International School",
        degree: "Cambridge AS & A Levels",
        dateRange: "Apr 2018",
        description: "Grade: 94%",
      },
    ]);
    expect(countSectionItems("education", liveShapedEducationWithoutDatesFlight)).toBe(3);
  });

  it("groups language proficiency with its language", () => {
    expect(extractLanguages(liveShapedLanguagesFlight)).toEqual([
      { name: "English", proficiency: "Native or bilingual proficiency" },
      { name: "Hindi", proficiency: "Native or bilingual proficiency" },
    ]);
    expect(countSectionItems("languages", liveShapedLanguagesFlight)).toBe(2);
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
