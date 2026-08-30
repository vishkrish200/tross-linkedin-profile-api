# LinkedIn Profile API

[![CI](https://github.com/vishkrish200/tross-linkedin-profile-api/actions/workflows/ci.yml/badge.svg)](https://github.com/vishkrish200/tross-linkedin-profile-api/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-315c45)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-e85323.svg)](LICENSE)

A browser-free TypeScript API that reverse-engineers LinkedIn's server-rendered React Flight/RSC contracts and returns profile information visible to an authorized session as stable, validated JSON.

## Reviewer quick start

| Surface | URL |
| --- | --- |
| Live API discovery | [`GET /`](https://tross-linkedin-profile-api-583248531894.asia-south1.run.app/) |
| Human-readable API documentation | [`GET /docs`](https://tross-linkedin-profile-api-583248531894.asia-south1.run.app/docs) |
| OpenAPI 3.1 document | [`GET /openapi.json`](https://tross-linkedin-profile-api-583248531894.asia-south1.run.app/openapi.json) |
| Health check | [`GET /health`](https://tross-linkedin-profile-api-583248531894.asia-south1.run.app/health) |
| Privacy-minimized acceptance evidence | [`docs/acceptance.md`](docs/acceptance.md) |

During the bounded challenge-review window, the profile route runs in an explicit controlled public-demo mode: no caller token is required. Reviewer traffic has generous minute-level quotas, while cache/coalescing, a bounded distinct-profile queue, a cold-extraction budget, LinkedIn concurrency and pacing, expiry, and a circuit breaker independently protect the upstream session. Bearer protection remains the default for normal deployments.

## Release status

| Surface | Source of truth |
| --- | --- |
| Source | The public `main` branch |
| Deployed revision and access limits | [`GET /`](https://tross-linkedin-profile-api-583248531894.asia-south1.run.app/) |
| Deterministic verification | The CI badge above; locally, `npm run check` |
| Live compatibility and release evidence | [`docs/acceptance.md`](docs/acceptance.md) |

The service implements direct profile-page and RSC requests, lazy About-card loading, bounded section pagination, a stable response schema, and process-wide operational controls. It does not launch a browser. Live evidence is dated and sample-bounded because LinkedIn's private contracts can change without notice.

## Platform and data warning

This project calls a private, reverse-engineered LinkedIn endpoint because that is an explicit requirement of the Tross hiring challenge. It is not an official LinkedIn integration. Use it only with an account and profile access you are authorized to use, at your own compliance and account risk.

The service does not bypass authentication, checkpoints, CAPTCHAs, access controls, or rate limits. Profile data is personal data; a real production service requires an appropriate lawful basis, retention and deletion policies, access controls, and audit logging.

## API

### `GET /`

Returns service metadata, the running Cloud Run revision, and links to the documentation, OpenAPI document, health check, profile endpoint, and source repository.

### `GET /docs`

Returns dependency-free human-readable API documentation. The machine-readable OpenAPI 3.1 contract is available at `GET /openapi.json`.

### `GET /health`

Returns `{"status":"ok"}`.

### `POST /v1/profiles`

```http
POST /v1/profiles HTTP/1.1
Content-Type: application/json

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

### Contract choices

- Optional scalar fields are omitted when they are not visible; collection fields are always arrays.
- Date ranges remain the authorized session's human-readable LinkedIn values. The service does not invent precise normalized dates from partial or locale-sensitive text.
- `warnings` carries explicit completeness signals, including the intentional 50-item section cap. Profile-image output is independently capped at 50 URLs.
- Provider/authentication failures are distinct from malformed caller input so consumers do not mistake upstream drift for a valid empty profile.

## How the direct provider works

1. The public LinkedIn identifier is taken from the validated `/in/` URL.
2. The provider fetches the profile page directly and reads LinkedIn's server-rendered React Flight data, including the transient profile identifier.
3. When LinkedIn advertises the lazy profile-card contract, it calls the private RSC component action to load cards such as About.
4. It calls LinkedIn's private RSC pagination endpoint directly for experience, education, skills, certifications, and languages.
5. The React Flight responses are resolved into the stable public schema.
6. An authorized session cookie and CSRF token are supplied only through runtime secrets. Successful results use a bounded short-lived cache, simultaneous misses share work, and all upstream work is deadline-, concurrency-, circuit-breaker-, size-, and request-rate-limited.

No Playwright, Chromium, Selenium, or browser session is used by the application.

### Code reading guide

| File or directory | Responsibility |
| --- | --- |
| [`src/server.ts`](src/server.ts) | Configuration, ordered provider assembly, startup, and shutdown |
| [`src/app.ts`](src/app.ts) | HTTP routes, access checks, request validation, and error responses |
| [`src/domain/`](src/domain/) | Public profile schema and accepted LinkedIn URLs |
| [`src/linkedin/profile-provider.ts`](src/linkedin/profile-provider.ts) | Request the profile page, optional About card, and section pages |
| [`src/linkedin/profile-parser.ts`](src/linkedin/profile-parser.ts) | Parse page fields and assemble the public profile |
| [`src/linkedin/section-parsers.ts`](src/linkedin/section-parsers.ts) | Map LinkedIn section shapes into typed entries |
| [`src/linkedin/react-flight-parser.ts`](src/linkedin/react-flight-parser.ts) | Decode bounded Flight rows and resolve references |
| [`src/provider/`](src/provider/) | Shared provider contract, cache, deadline, queue, budget, and circuit breaker |

## Local setup

Prerequisites: Node.js 22 or newer.

```bash
npm ci
cp .env.example .env
npm run check
```

Set these runtime values in `.env` using a session you are authorized to use:

- `LINKEDIN_COOKIE`: the minimum cookie header required by the authenticated LinkedIn requests, normally containing `li_at` and `JSESSIONID`.
- `LINKEDIN_CSRF_TOKEN`: the CSRF value observed on the authorized request. It may be omitted when `JSESSIONID` is present because the provider derives its unquoted value.
- `ACCESS_MODE`: `bearer` by default; use `public-demo` only for a deliberately bounded evaluation deployment.
- `API_KEY`: a required random bearer token of at least 32 characters in the default mode. Generate one with a cryptographically secure source such as `openssl rand -hex 32`. It may remain configured as a rollback credential while `public-demo` is active.
- `API_KEY_PREVIOUS`: optional, distinct prior token of at least 32 characters for a short, deliberate rotation overlap; remove it after callers migrate.
- `PUBLIC_DEMO_EXPIRES_AT`: required ISO timestamp in `public-demo` mode. The route returns `410 public_demo_closed` at and after this instant.
- `PUBLIC_DEMO_PER_CLIENT_RATE_LIMIT_MAX`, `PUBLIC_DEMO_GLOBAL_RATE_LIMIT_MAX`, `PUBLIC_DEMO_RATE_LIMIT_WINDOW`, and `PUBLIC_DEMO_MAX_COLD_EXTRACTIONS`: anonymous fairness and blast-radius controls.
- `LINKEDIN_MAX_CONCURRENCY`: maximum distinct LinkedIn profile extractions in flight; defaults to `2`.
- `LINKEDIN_MAX_QUEUE_SIZE`: maximum distinct uncached profiles allowed to wait behind active extraction; defaults to `4`. Simultaneous requests for the same profile coalesce before this queue.

The defensive controls in `.env.example` also bound request and response sizes, the completed-result cache, per-request and overall deadlines, bearer and public-demo quotas, upstream request pacing, and the protection-signal circuit-breaker cooldown. Invalid configured numeric values fail startup instead of silently falling back. `ALLOW_UNAUTHENTICATED_LOCAL=true` is accepted only outside production and must be set explicitly; it is not a production public-access switch.

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

The smoke command intentionally prints only the profile slug, field-presence flags, counts, and truncation labels. It does not print biographies, descriptions, contact data, credentials, or full upstream/API responses.

To replay an authorized matrix through the HTTP API and all runtime controls, put unique case labels and full canonical profile URLs in a private JSON file under the ignored `tmp/` directory, then run:

```bash
PROFILE_MATRIX_FILE=tmp/profile-matrix.json npm run smoke:matrix
```

The file format is `[{"case":1,"url":"https://www.linkedin.com/in/example-person/"}]`. The runner defaults to `http://127.0.0.1:3000/v1/profiles`; set `PROFILE_API_URL` for another authorized endpoint. It waits 20 seconds between completed cases, stops on the first failed response, and prints only case labels and structural evidence. Never construct a matrix from partial names or search patterns.

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

The Docker base image is pinned by digest for reproducibility. Refresh that digest deliberately as part of dependency maintenance, then rerun the complete verification suite.

The reference deployment runs on Google Cloud Run with the LinkedIn session and rollback API bearer token stored as separate Secret Manager secrets. The challenge deployment can explicitly select the expiring `public-demo` mode without exposing either secret. The API token is intentionally absent from this public repository.

## Error contract

- `400 invalid_request`: malformed body or non-profile URL.
- `401 unauthorized`: invalid or absent API bearer token in `bearer` mode.
- `404 profile_unavailable`: LinkedIn reports that the profile is unavailable to the configured session.
- `410 public_demo_closed`: the controlled public evaluation window has ended.
- `413 payload_too_large`: the body exceeds the configured request limit.
- `415 unsupported_media_type`: the request does not use a JSON content type.
- `429 rate_limit_exceeded`: a caller or global public-demo quota was exceeded.
- `429 provider_busy`: the bounded distinct-profile queue is full; respect `Retry-After` and retry shortly.
- `429 public_demo_budget_exhausted`: the running instance consumed its uncached-extraction budget.
- `500 internal_error`: an unexpected internal failure occurred without exposing internals.
- `502 provider_authentication_failed`: LinkedIn rejected or redirected the runtime session.
- `502 provider_fetch_failed`: upstream failure, rate limit, checkpoint signal, or unexpected response.
- `503 provider_not_configured`: required LinkedIn runtime secrets are absent.

## Known limitations

- LinkedIn's private RSC endpoints can change paths, request contracts, component identifiers, and response schemas without notice.
- About is supplied by a separately loaded profile-card component in LinkedIn's current response shape; that private contract is version-sensitive.
- Visibility depends on the supplied account, relationship, region, privacy settings, and LinkedIn experiments.
- Session cookies expire and can trigger checkpoints.
- The process stops new LinkedIn traffic for the configured cooldown after authentication, checkpoint, consent, CAPTCHA, 429, or 999 signals; it does not retry or bypass them.
- Empty, private, or account-invisible fields are returned as empty arrays or omitted optional fields.
- An unrecognized zero-item response on any pagination page, a repeated page, an invalid MIME/body, or other recognized response drift fails as `provider_fetch_failed` instead of being silently classified as complete.
- The cache, bounded queue, public-demo quotas, cold-extraction budget, request pacing, and circuit state are per process. The challenge deployment therefore requires an enforced one-instance ceiling; a durable shared store would be required for hard multi-instance coordination.
- A section returns at most 50 entries because upstream pagination and the public schema are intentionally bounded. A full fifth page or upstream page-size over-delivery adds a `possibly truncated` warning.
- Synthetic React Flight fixtures prove deterministic parsing; the dated live smoke test is the separate compatibility check.

For request flow and design boundaries, see [`docs/architecture.md`](docs/architecture.md). Live evidence is in [`docs/acceptance.md`](docs/acceptance.md), and defensive controls plus adversarial coverage are in [`docs/hardening.md`](docs/hardening.md).

## Repository hygiene

`.env`, dependencies, build output, reports, and temporary files are ignored. Before publishing, inspect the complete Git history and run a secret scanner over both the working tree and history.
