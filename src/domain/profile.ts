import { z } from "zod";

export const PROFILE_SECTION_ITEM_LIMIT = 50;
export const PROFILE_IMAGE_LIMIT = 50;

const optionalText = z.string().trim().min(1).optional();

export const experienceSchema = z.object({
  title: z.string().trim().min(1),
  company: optionalText,
  employmentType: optionalText,
  dateRange: optionalText,
  location: optionalText,
  description: optionalText,
});

export const educationSchema = z.object({
  school: z.string().trim().min(1),
  degree: optionalText,
  fieldOfStudy: optionalText,
  dateRange: optionalText,
  description: optionalText,
});

export const certificationSchema = z.object({
  name: z.string().trim().min(1),
  issuer: optionalText,
  issued: optionalText,
  credentialId: optionalText,
  credentialUrl: z.url().optional(),
});

export const languageSchema = z.object({
  name: z.string().trim().min(1),
  proficiency: optionalText,
});

export const profileSchema = z.object({
  sourceUrl: z.url(),
  fetchedAt: z.iso.datetime(),
  name: optionalText,
  headline: optionalText,
  location: optionalText,
  about: optionalText,
  experience: z.array(experienceSchema).max(PROFILE_SECTION_ITEM_LIMIT),
  education: z.array(educationSchema).max(PROFILE_SECTION_ITEM_LIMIT),
  skills: z.array(z.string().trim().min(1)).max(PROFILE_SECTION_ITEM_LIMIT),
  certifications: z.array(certificationSchema).max(PROFILE_SECTION_ITEM_LIMIT),
  languages: z.array(languageSchema).max(PROFILE_SECTION_ITEM_LIMIT),
  profileImages: z.array(z.url()).max(PROFILE_IMAGE_LIMIT),
  warnings: z.array(z.string()),
});

export const profileRequestSchema = z.object({
  url: z.string().trim().min(1),
});

export type Profile = z.infer<typeof profileSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type Language = z.infer<typeof languageSchema>;
