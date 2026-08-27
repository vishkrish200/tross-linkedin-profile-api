# LinkedIn Profile API

A small TypeScript service that accepts a LinkedIn profile URL and returns profile information visible to an authorized LinkedIn session as structured JSON.

## Status

The HTTP API, strict URL validation, direct LinkedIn HTTP client, React Flight extraction, section pagination, cache, rate limiting, Docker packaging, and deterministic tests are implemented. The deployed application does not launch or depend on a browser.

An authorized low-volume live smoke test passed on August 28, 2026. LinkedIn's private endpoints and response shapes can still change without notice, so live compatibility remains an operational concern rather than a permanent guarantee.

Live HTTPS endpoint: [`https://tross-linkedin-profile-api-583248531894.asia-south1.run.app`](https://tross-linkedin-profile-api-583248531894.asia-south1.run.app). The profile route requires the bearer token supplied separately to the challenge reviewers; `/health` is public.

## Platform and data warning

This project calls a private, reverse-engineered LinkedIn endpoint because that is an explicit requirement of the Tross hiring challenge. It is not an official LinkedIn integration. Use it only with an account and profile access you are authorized to use, at your own compliance and account risk.

The service does not bypass authentication, checkpoints, CAPTCHAs, access controls, or rate limits. Profile data is personal data; a real production service requires an appropriate lawful basis, retention and deletion policies, access controls, and audit logging.

## API

### `GET /health`

Returns `{"status":"ok"}`.

### `POST /v1/profiles`

```http
POST /v1/profiles HTTP/1.1
Content-Type: application/json
Authorization: Bearer <API_KEY>

{"url":"https://www.linkedin.com/in/example-person/"}
```

Successful response:

```json
{
  "data": {
    "sourceUrl": "https://www.linkedin.com/in/example-person/",
    "fetchedAt": "2026-08-28T00:00:00.000Z",
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

Only HTTPS URLs on `linkedin.com` or `www.linkedin.com` whose path is exactly `/in/<profile-slug>` are accepted. Query strings and fragments are removed before the provider is called.

## How the direct provider works

1. The public LinkedIn identifier is taken from the validated `/in/` URL.
2. The provider fetches the profile page directly and reads LinkedIn's server-rendered React Flight data, including the transient profile identifier.
3. It calls LinkedIn's private RSC pagination endpoint directly for experience, education, skills, certifications, and languages.
4. The React Flight responses are resolved into the stable public schema.
5. An authorized session cookie and CSRF token are supplied only through runtime secrets, and successful results are cached briefly to reduce upstream requests.

No Playwright, Chromium, Selenium, or browser session is used by the application.

## Local setup

Prerequisites: Node.js 22 or newer.

```bash
npm install
cp .env.example .env
npm run check
```

Set these runtime values in `.env` using a session you are authorized to use:

- `LINKEDIN_COOKIE`: the minimum cookie header required by the authenticated LinkedIn requests, normally containing `li_at` and `JSESSIONID`.
- `LINKEDIN_CSRF_TOKEN`: the CSRF value observed on the authorized request. It may be omitted when `JSESSIONID` is present because the provider derives its unquoted value.
- `API_KEY`: a long random bearer token for callers of this API.

Do not paste these values into documentation, issue trackers, submission forms, logs, or source control. The service never accepts or stores a LinkedIn password.

Start the service:

```bash
set -a
source .env
set +a
npm run dev
```

Call it:

```bash
curl -sS http://localhost:3000/v1/profiles \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $API_KEY" \
  -d '{"url":"https://www.linkedin.com/in/example-person/"}'
```

For a one-request local smoke test without starting the HTTP server:

```bash
PROFILE_URL=https://www.linkedin.com/in/example-person/ npm run smoke
```

## Deployment

Build and run the container behind an HTTPS-terminating platform:

```bash
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 \
  -e API_KEY="$API_KEY" \
  -e LINKEDIN_COOKIE="$LINKEDIN_COOKIE" \
  -e LINKEDIN_CSRF_TOKEN="$LINKEDIN_CSRF_TOKEN" \
  linkedin-profile-api
```

Store all session values in the hosting platform's secret manager. Do not place them in build arguments, image layers, environment files committed to Git, or CI configuration.

The reference deployment runs on Google Cloud Run with the LinkedIn session and API bearer token stored as separate Secret Manager secrets. The API token is intentionally absent from this public repository.

## Error contract

- `400 invalid_request`: malformed body or non-profile URL.
- `401 unauthorized`: invalid or absent API bearer token when `API_KEY` is configured.
- `502 provider_authentication_failed`: LinkedIn rejected or redirected the runtime session.
- `502 provider_fetch_failed`: upstream failure, rate limit, checkpoint signal, or unexpected response.
- `503 provider_not_configured`: required LinkedIn runtime secrets are absent.

## Known limitations

- LinkedIn's private RSC endpoints can change paths, request contracts, component identifiers, and response schemas without notice.
- Visibility depends on the supplied account, relationship, region, privacy settings, and LinkedIn experiments.
- Session cookies expire and can trigger checkpoints.
- Empty, private, or account-invisible fields are returned as empty arrays or omitted optional fields.
- The cache is per process and is not shared across multiple instances.
- Synthetic React Flight fixtures prove deterministic parsing; the dated live smoke test is the separate compatibility check.

For component responsibilities, see [`docs/architecture.md`](docs/architecture.md). The delivery checklist is in [`docs/challenge-notes.md`](docs/challenge-notes.md).

## Repository hygiene

`.env`, dependencies, build output, reports, and temporary files are ignored. Before publishing, inspect the complete Git history and run a secret scanner over both the working tree and history.
