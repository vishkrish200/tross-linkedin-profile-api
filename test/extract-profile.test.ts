import { describe, expect, it } from "vitest";
import { PROFILE_IMAGE_LIMIT } from "../src/domain/profile.js";
import {
  countSectionItems,
  extractAboutComponentRequest,
  extractCertifications,
  extractEducation,
  extractExperience,
  extractIdentity,
  extractLanguages,
  extractProfileFromResponses,
  isKnownEmptyAboutComponent,
} from "../src/provider/extract-profile.js";
import {
  adjacentSectionLabelAboutComponentFlight,
  certificationsFlight,
  boundaryWordAboutComponentFlight,
  careerBreakExperienceFlight,
  cyclicFlight,
  delimiterCompanyExperienceFlight,
  descriptionWithoutLocationExperienceFlight,
  duplicateSkillRowsFlight,
  educationFlight,
  emptyChildrenAboutComponentFlight,
  explicitlyEmptyAboutComponentFlight,
  experienceFlight,
  fallbackCredentialFlight,
  framedImageProfileHtml,
  groupedExperienceFlight,
  internationalAboutComponentFlight,
  languagesFlight,
  lazyAboutComponentFlight,
  lazyAboutProfileHtml,
  lazyAboutShapeDriftProfileHtml,
  liveShapedCertificationsFlight,
  liveShapedEducationWithoutDatesFlight,
  liveShapedLanguagesFlight,
  liveShapedProfileHtml,
  markerOnlyCertificationFlight,
  multiParagraphAboutComponentFlight,
  multipleDegreesEducationFlight,
  partialImageProfileHtml,
  plainDescriptionExperienceFlight,
  profileHtml,
  renewedCertificationsFlight,
  rootImageProfileHtml,
  sameCoreExperienceFlight,
  singleCharacterAboutComponentFlight,
  shortAboutComponentFlight,
  skillsFlight,
  unsafeImageProfileHtml,
  unsafeCredentialFlight,
  undatedExperienceFlight,
  whitespaceOnlyAboutComponentFlight,
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

  it("decodes HTML entities in the document-title name fallback", () => {
    const encoded = profileHtml
      .replace("<title>Vishnu Example", "<title>Vishnu &amp; Example &#x1F680;")
      .replace("Vishnu Example</title>", "Vishnu &amp; Example &#x1F680;</title>");
    expect(extractIdentity(encoded).name).toBe("Vishnu & Example 🚀");
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

  it("prefers a framed owner photo attached to the profile header", () => {
    expect(extractIdentity(framedImageProfileHtml).profileImages).toEqual([
      "https://media.example.test/profile-framedphoto-shrink_100_100/framed-small.jpg",
      "https://media.example.test/profile-framedphoto-shrink_560_560/framed-large.jpg",
    ]);
  });

  it("extracts About text from LinkedIn's lazy component-card shape", () => {
    expect(extractAboutComponentRequest(lazyAboutProfileHtml)).toEqual({
      componentId: "com.linkedin.sdui.profile.card.about",
      clientArguments: {
        payload: { vanityName: "lazy-about-person" },
        states: [],
        requestMetadata: { $type: "proto.sdui.common.RequestMetadata" },
        screenId: "com.linkedin.sdui.flagshipnav.profile.Profile",
        knownTemplateIds: [],
      },
    });
    expect(extractIdentity(lazyAboutProfileHtml, [lazyAboutComponentFlight])).toEqual({
      profileId: "profile-lazy-about",
      name: "Lazy About Person",
      headline: "Lazy About Engineer",
      location: "Example City, India",
      about: "I build dependable systems and test them with carefully designed, reproducible evaluations.",
      profileImages: [],
    });
  });

  it("joins every About paragraph before the Top skills boundary", () => {
    expect(extractIdentity(lazyAboutProfileHtml, [multiParagraphAboutComponentFlight]).about).toBe(
      "I build dependable systems for high-stakes workflows. "
      + "I validate those systems with deterministic evaluations and privacy-minimized live checks. "
      + "I document residual risks before recommending a release.",
    );
  });

  it("prefers an authoritative short About card over page-level About text", () => {
    expect(extractIdentity(profileHtml, [shortAboutComponentFlight]).about).toBe(
      "Build. Learn. Share.",
    );
  });

  it("preserves authoritative About text that mentions LinkedIn product names", () => {
    const productFocusedAbout = lazyAboutComponentFlight.replace(
      "I build dependable systems and test them with carefully designed, reproducible evaluations.",
      "I build Marketing Solutions and Talent Solutions for privacy-conscious teams.",
    );
    expect(extractIdentity(lazyAboutProfileHtml, [productFocusedAbout]).about).toBe(
      "I build Marketing Solutions and Talent Solutions for privacy-conscious teams.",
    );
  });

  it("uses initialContent when a lazy card advertises empty children", () => {
    expect(extractIdentity(lazyAboutProfileHtml, [emptyChildrenAboutComponentFlight]).about).toBe(
      "A dedicated initial-content biography remains authoritative when children is empty.",
    );
  });

  it("preserves short, international, and label-like biographies", () => {
    expect(extractIdentity(lazyAboutProfileHtml, [singleCharacterAboutComponentFlight]).about)
      .toBe("X");
    expect(extractIdentity(lazyAboutProfileHtml, [boundaryWordAboutComponentFlight]).about)
      .toBe("Featured");
    expect(extractIdentity(lazyAboutProfileHtml, [internationalAboutComponentFlight]).about)
      .toBe("Build carefully. مرحبا بالعالم 構築と検証 Cafe\u0301\u200B 🚀");
    expect(extractIdentity(lazyAboutProfileHtml, [whitespaceOnlyAboutComponentFlight]).about)
      .toBeUndefined();
  });

  it("distinguishes an explicitly empty About card from an unknown response", () => {
    expect(isKnownEmptyAboutComponent(explicitlyEmptyAboutComponentFlight)).toBe(true);
    expect(isKnownEmptyAboutComponent('0:["$","div",null,{"children":["About"]}]'))
      .toBe(false);
  });

  it("does not mistake an adjacent section label for About text", () => {
    expect(extractIdentity(
      lazyAboutProfileHtml,
      [adjacentSectionLabelAboutComponentFlight],
    ).about).toBeUndefined();
  });

  it("rejects non-HTTPS structured image candidates", () => {
    expect(extractIdentity(unsafeImageProfileHtml).profileImages).toEqual([]);
  });

  it("keeps only valid same-origin HTTPS image renditions", () => {
    expect(extractIdentity(partialImageProfileHtml).profileImages).toEqual([
      "https://media.example.test/profile-displayphoto-shrink_400_400/valid.jpg",
    ]);
  });

  it("caps structured profile-image output at the public schema limit", () => {
    const imageRenditions = Array.from({ length: PROFILE_IMAGE_LIMIT + 10 }, (_, index) => ({
      width: index + 1,
      suffixUrl: `${index + 1}_${index + 1}/image-${index}.jpg`,
    }));
    const stream = `0:${JSON.stringify(["$", "main", null, { children: [{
      source: {
        renderPayload: {
          rootUrl: "https://media.example.test/profile-displayphoto-shrink_",
          imageRenditions,
        },
      },
    }] }])}\n1:${JSON.stringify({ payload: {
      vanityName: "many-images",
      profileId: "profile-many-images",
    } })}`;
    const html = [
      "<!doctype html><html><head><title>Many Images | LinkedIn</title></head><body>",
      `<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([stream])};</script>`,
      "</body></html>",
    ].join("");

    expect(extractIdentity(html).profileImages).toHaveLength(PROFILE_IMAGE_LIMIT);
  });

  it("distinguishes a changed lazy-card contract from a layout without that wrapper", () => {
    expect(extractAboutComponentRequest(lazyAboutShapeDriftProfileHtml)).toBeNull();
    expect(extractAboutComponentRequest(profileHtml)).toBeUndefined();
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

  it("keeps description paragraphs out of location when the flat row has no location", () => {
    expect(extractExperience(descriptionWithoutLocationExperienceFlight)).toEqual([{
      title: "Research Engineer",
      company: "Example Research",
      employmentType: "Contract",
      dateRange: "Jan 2025 - Jun 2025",
      description: "Designed the first evaluation suite. Published reproducible results.",
    }]);
  });

  it("preserves same-title engagements that differ in location", () => {
    expect(extractExperience(sameCoreExperienceFlight)).toHaveLength(2);
    expect(extractExperience(sameCoreExperienceFlight).map((item) => item.location)).toEqual([
      "Remote",
      "Example City · Hybrid",
    ]);
  });

  it("preserves undated roles, career breaks, delimiter-bearing companies, and plain descriptions", () => {
    expect(extractExperience(undatedExperienceFlight)).toEqual([
      { title: "Independent Researcher" },
    ]);
    expect(extractExperience(delimiterCompanyExperienceFlight)).toEqual([{
      title: "Research Engineer",
      company: "Research · Development Labs",
      employmentType: "Contract",
      location: "Remote",
      description: "Designed a deterministic evaluation system without relying on a date range.",
    }]);
    expect(extractExperience(careerBreakExperienceFlight)).toEqual([{
      title: "Career Break",
      dateRange: "Jan 2024 - Jun 2024",
      description: "Focused on personal development and independent study.",
    }]);
    expect(extractExperience(plainDescriptionExperienceFlight)[0]?.description).toBe(
      "Designed resilient systems without bullet prefixes.",
    );
  });

  it("groups current certification rows by LinkedIn collection metadata", () => {
    expect(extractCertifications(liveShapedCertificationsFlight)).toEqual([
      {
        name: "Machine Learning Associate",
        issuer: "Example Cloud",
        issued: "Nov 2024 · Expires Nov 2026",
        credentialUrl: "https://credentials.example.test/cert/one",
      },
      {
        name: "Generative AI Professional",
        issuer: "Example Cloud",
        issued: "Oct 2024",
        credentialUrl: "http://credentials.example.test/cert/two",
      },
    ]);
    expect(countSectionItems("certifications", liveShapedCertificationsFlight)).toBe(2);
  });

  it("preserves renewed certifications with the same name and issuer", () => {
    const profile = extractProfileFromResponses(
      profileHtml,
      {
        experience: [], education: [], skills: [],
        certifications: [renewedCertificationsFlight], languages: [],
      },
      "https://www.linkedin.com/in/vishnu-example/",
    );
    expect(profile.certifications).toHaveLength(2);
    expect(profile.certifications.map((item) => item.credentialId)).toEqual([
      "RENEWAL-ONE",
      "RENEWAL-TWO",
    ]);
  });

  it("joins certification links by collection identity rather than array position", () => {
    expect(extractCertifications(markerOnlyCertificationFlight)).toEqual([
      {
        name: "Machine Learning Associate",
        issuer: "Example Cloud",
        issued: "Nov 2024",
        credentialUrl: "https://credentials.example.test/cert/one",
      },
      {
        name: "Systems Professional",
        issuer: "Example Cloud",
        issued: "Jan 2026",
        credentialUrl: "https://credentials.example.test/cert/three",
      },
    ]);
  });

  it("omits a credential URL when only a positional fallback is available", () => {
    expect(extractCertifications(fallbackCredentialFlight)).toEqual([
      {
        name: "First Certificate",
        issuer: "Example Issuer",
        issued: "Jan 2025",
      },
      {
        name: "Second Certificate",
        issuer: "Example Issuer",
        issued: "Jan 2026",
      },
    ]);
  });

  it("rejects unsafe or credential-bearing certification redirect targets", () => {
    expect(extractCertifications(unsafeCredentialFlight)).toEqual([
      {
        name: "Security Certificate",
        issuer: "Example Issuer",
        issued: "Jan 2025",
      },
      {
        name: "Identity Certificate",
        issuer: "Example Issuer",
        issued: "Feb 2025",
      },
    ]);
  });

  it("skips duplicate text echoes without truncating later items", () => {
    expect(countSectionItems("skills", duplicateSkillRowsFlight)).toBe(2);
  });

  it("bounds cyclic React Flight references without hanging", () => {
    expect(countSectionItems("skills", cyclicFlight)).toBe(0);
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

  it("preserves multiple degrees at one school and commas inside field names", () => {
    expect(extractEducation(multipleDegreesEducationFlight)).toEqual([
      {
        school: "Example University",
        degree: "Bachelor of Arts",
        fieldOfStudy: "Economics, Mathematics",
        dateRange: "2018 – 2022",
      },
      {
        school: "Example University",
        degree: "Master of Science",
        fieldOfStudy: "Computer Science",
        dateRange: "2022 – 2024",
      },
    ]);
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
