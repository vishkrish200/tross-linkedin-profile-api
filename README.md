# LinkedIn Profile API

A small TypeScript service that accepts a LinkedIn profile URL and returns the profile information visible to an authorized LinkedIn session as structured JSON.

## Status

The API contract, input validation, HTML extraction, cache, rate limiting, session-secret handling, Docker packaging, and deterministic tests are implemented. A real LinkedIn session has deliberately not been connected or exercised yet.

## Important platform limitation

LinkedIn's current User Agreement and help documentation prohibit third-party scraping and unauthorized browser automation. The official Profile API is restricted and generally does not provide arbitrary members' full profile data. Use this project only with explicit authorization and at your own account and compliance risk. It does not bypass access controls, CAPTCHAs, checkpoints, or rate limits.

- [LinkedIn User Agreement, section 8.2](https://www.linkedin.com/legal/user-agreement)
- [LinkedIn automated activity guidance](https://www.linkedin.com/help/linkedin/answer/a1340567/automated-activity-on-linkedin)
- [Official LinkedIn Profile API documentation](https://learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api)

## API

### `GET /health`

Returns `{"status":"ok"}`.

### `POST /v1/profiles`

Request:

```http
POST /v1/profiles HTTP/1.1
Content-Type: application/json
Authorization: Bearer <API_KEY>

{"url":"https://www.linkedin.com/in/example-person/"}
```

Response shape:

```json
{
  "data": {
    "sourceUrl": "https://www.linkedin.com/in/example-person/",
    "fetchedAt": "2026-08-27T00:00:00.000Z",
    "name": "Example Person",
    "headline": "Software Engineer",
    "location": "Bengaluru, India",
    "about": "...",
    "experience": [],
    "education": [],
    "skills": [],
    "certifications": [],
    "languages": [],
    "profileImages": [],
    "warnings": []
  }
}
```

The endpoint accepts only HTTPS URLs on `linkedin.com` or `www.linkedin.com` whose path is exactly `/in/<profile-slug>`. This prevents the server from becoming a general-purpose URL fetcher.

## Local setup

Prerequisites: Node.js 22 or newer.

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run check
```

Create a local session by signing in manually in the browser window:

```bash
npm run auth
```

This writes `.auth/linkedin.json`, which is ignored by Git. The service never accepts or persists a LinkedIn username or password.

Start the service:

```bash
set -a
source .env
set +a
npm run dev
```

Then call it:

```bash
curl -sS http://localhost:3000/v1/profiles \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $API_KEY" \
  -d '{"url":"https://www.linkedin.com/in/example-person/"}'
```

## Deployment

Build and run the included container on a platform that supports Docker and HTTPS termination:

```bash
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 \
  -e API_KEY="$API_KEY" \
  -e LINKEDIN_STORAGE_STATE_B64="$LINKEDIN_STORAGE_STATE_B64" \
  linkedin-profile-api
```

For a hosted environment, base64-encode the contents of `.auth/linkedin.json` and store the result in the platform's secret manager as `LINKEDIN_STORAGE_STATE_B64`. Do not put it in source control, build arguments, image layers, logs, or the submission form.

## Approach

1. Validate and canonicalize the submitted URL before any network access.
2. Load a manually created LinkedIn browser session from a runtime secret.
3. Render the requested profile using Playwright without attempting to solve or bypass challenges.
4. Convert visible profile sections into a stable response schema.
5. Cache successful results briefly and rate-limit callers to reduce account and platform load.

The provider is behind a small interface so the fetch mechanism can be replaced without changing the HTTP API or response schema.

For component responsibilities and the request flow, see [`docs/architecture.md`](docs/architecture.md). The delivery checklist is in [`docs/challenge-notes.md`](docs/challenge-notes.md).

## Known limitations

- LinkedIn's markup changes frequently; extraction selectors and heuristics will require maintenance.
- Visibility depends on the supplied account, its relationship to the profile, region, privacy settings, and LinkedIn experiments.
- Some profiles lazy-load sections that may not appear in the rendered page.
- Session state expires and may trigger a login or checkpoint. The service returns an explicit upstream authentication error and does not bypass it.
- The current implementation reads rendered HTML. A private, undocumented LinkedIn endpoint is not hard-coded because it is unstable and increases platform-policy risk.
- The in-memory cache is per process and should be replaced with a shared cache for multi-instance deployments.
- Profile data is personal data. A production service needs a lawful basis, retention policy, deletion process, access controls, and audit logging.

## Repository hygiene

The `.gitignore` excludes `.env`, `.auth/`, build output, reports, and dependencies. Before publishing, run a secret scan and inspect the complete Git history, not only the working tree.
