# Tross hiring challenge notes

## External brief

Build a publicly hosted HTTPS API that accepts a LinkedIn profile URL and returns most profile-page information as structured JSON. The expected fields include name, headline, location, about, experience, education, skills, certifications, languages, and profile images when available.

The submission also requires a public GitHub repository, setup and API documentation, an explanation of the approach, known limitations, and no committed credentials. The email states a deadline of August 31, 2026 and explicitly permits AI assistance.

## Local interpretation

The document is treated as an external specification, not authorization to access an account, deploy infrastructure, publish a repository, or submit the result. Those actions remain separate project gates.

## August 27 clarification

Tross emailed candidates to clarify that the LinkedIn solution must be purely reverse-engineered, must call LinkedIn endpoints directly, and must not use a browser. The provider was therefore changed from rendered-page automation to direct authenticated HTTP requests against LinkedIn's profile and RSC pagination endpoints. Browser automation is not part of the application or container.

## Delivery checklist

- [x] Typed response schema
- [x] LinkedIn profile URL input validation
- [x] Profile provider boundary
- [x] Direct profile-page and RSC pagination provider
- [x] React Flight response extractor
- [x] Cache and rate limiting
- [x] Runtime-only cookie and CSRF-secret handling
- [x] Explicit expiring public-demo mode with caller, global, cold-extraction, concurrency, pacing, and circuit-breaker bounds
- [x] Deterministic tests
- [x] Docker packaging
- [x] Setup, API, approach, and limitation documentation
- [x] Reviewer discovery route and human-readable API documentation
- [x] OpenAPI 3.1 contract generated from the canonical Zod schemas
- [x] Privacy-minimized public acceptance evidence
- [x] Authorized live-profile smoke test
- [x] Select hosting provider and deploy over HTTPS
- [x] Verify the deployed endpoint from outside the host
- [x] Create and review the public GitHub repository
- [x] Run repository and Git-history secret scans
- [x] Automate Git-history secret scanning in CI
- [ ] Record and host the optional demo video
- [x] Deploy and live-verify the expiring controlled public-demo mode
- [ ] Complete the Tross submission form
