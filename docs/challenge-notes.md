# Tross hiring challenge notes

## External brief

Build a publicly hosted HTTPS API that accepts a LinkedIn profile URL and returns most profile-page information as structured JSON. The expected fields include name, headline, location, about, experience, education, skills, certifications, languages, and profile images when available.

The submission also requires a public GitHub repository, setup and API documentation, an explanation of the approach, known limitations, and no committed credentials. The email states a deadline of August 31, 2026 and explicitly permits AI assistance.

## Local interpretation

The document is treated as an external specification, not authorization to access an account, deploy infrastructure, publish a repository, or submit the result. Those actions remain separate project gates.

## Delivery checklist

- [x] Typed response schema
- [x] LinkedIn profile URL input validation
- [x] Profile provider boundary
- [x] Rendered-page extractor
- [x] Cache and rate limiting
- [x] Runtime-only session-secret handling
- [x] Deterministic tests
- [x] Docker packaging
- [x] Setup, API, approach, and limitation documentation
- [ ] Authorized live-profile smoke test
- [ ] Select hosting provider and deploy over HTTPS
- [ ] Verify the deployed endpoint from outside the host
- [ ] Create and review the public GitHub repository
- [ ] Run repository and Git-history secret scans
- [ ] Complete the Tross submission form
