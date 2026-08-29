import { profileSchema } from "../src/domain/profile.js";
import { normalizeLinkedInProfileUrl } from "../src/domain/linkedin-url.js";
import { LinkedInApiProvider } from "../src/provider/linkedin-api-provider.js";

const profileUrl = process.env.PROFILE_URL;
if (!profileUrl) throw new Error("PROFILE_URL is required");

const provider = new LinkedInApiProvider({
  ...(process.env.LINKEDIN_COOKIE ? { cookie: process.env.LINKEDIN_COOKIE } : {}),
  ...(process.env.LINKEDIN_CSRF_TOKEN ? { csrfToken: process.env.LINKEDIN_CSRF_TOKEN } : {}),
  ...(process.env.LINKEDIN_USER_AGENT ? { userAgent: process.env.LINKEDIN_USER_AGENT } : {}),
});

const profile = profileSchema.parse(await provider.fetch(normalizeLinkedInProfileUrl(profileUrl)));
console.log(JSON.stringify({
  profileSlug: new URL(profile.sourceUrl).pathname.split("/").filter(Boolean).at(-1),
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
    .filter((warning) => warning.includes("50-item safety limit"))
    .map((warning) => warning.split(" ", 1)[0]),
}, null, 2));
