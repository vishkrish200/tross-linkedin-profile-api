import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractProfileFromHtml } from "../src/provider/extract-profile.js";

describe("extractProfileFromHtml", () => {
  it("maps visible profile sections into the public response schema", async () => {
    const html = await readFile(new URL("./fixtures/profile.html", import.meta.url), "utf8");
    const profile = extractProfileFromHtml(html, "https://www.linkedin.com/in/vishnu-example/");

    expect(profile).toMatchObject({
      name: "Vishnu Example",
      headline: "Software Engineer building agentic systems",
      location: "Bengaluru, Karnataka, India",
      about: "I build reliable products and evaluation systems.",
      experience: [
        {
          title: "Senior Software Engineer",
          company: "Example Labs",
          employmentType: "Full-time",
          dateRange: "Jan 2024 - Present · 2 yrs 8 mos",
          location: "Bengaluru, India",
        },
      ],
      education: [
        {
          school: "Example Institute",
          degree: "Bachelor of Technology",
          fieldOfStudy: "Computer Science",
          dateRange: "2018 - 2022",
        },
      ],
      skills: ["TypeScript", "Distributed Systems"],
      languages: [{ name: "English", proficiency: "Professional working proficiency" }],
      profileImages: ["https://media.example.test/profile.jpg"],
    });
    expect(profile.certifications[0]).toMatchObject({
      name: "Cloud Engineer",
      issuer: "Example Cloud",
      issued: "Issued Jan 2025",
    });
  });
});
