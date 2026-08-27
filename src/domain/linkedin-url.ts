const allowedHosts = new Set(["linkedin.com", "www.linkedin.com"]);

export class InvalidLinkedInProfileUrlError extends Error {
  constructor(message = "A public LinkedIn /in/ profile URL is required") {
    super(message);
    this.name = "InvalidLinkedInProfileUrlError";
  }
}

export function normalizeLinkedInProfileUrl(input: string): string {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new InvalidLinkedInProfileUrlError();
  }

  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new InvalidLinkedInProfileUrlError();
  }

  const match = url.pathname.match(/^\/in\/([a-zA-Z0-9_%.-]+)\/?$/);
  if (!match?.[1]) {
    throw new InvalidLinkedInProfileUrlError();
  }

  const slug = decodeURIComponent(match[1]).trim();
  if (!slug || slug === "." || slug === "..") {
    throw new InvalidLinkedInProfileUrlError();
  }

  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}
