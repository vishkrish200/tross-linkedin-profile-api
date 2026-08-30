# Architecture

## Request flow

```text
HTTP request
  -> explicit access mode: bearer check or expiring public demo
  -> bearer quota or public per-client plus global quotas
  -> LinkedIn URL validation and canonicalization
  -> short-lived cache and same-profile request coalescing
  -> one overall extraction deadline
  -> bounded upstream concurrency queue
  -> authentication/challenge circuit breaker
  -> public-demo cold-extraction budget when a LinkedIn attempt starts
  -> shared upstream request pacing
  -> direct LinkedIn profile-page request
  -> direct RSC lazy profile-card component request
  -> direct RSC section-pagination requests
  -> React Flight extraction
  -> Zod response validation
  -> JSON response
```

## Boundaries

### HTTP layer

`src/app.ts` owns routing, explicit bearer/public-demo access mode, expiry enforcement, caller/global rate limiting, status codes, and the public error contract. It depends only on `ProfileProvider`.

### Domain layer

`src/domain/profile.ts` defines the stable public schema. `src/domain/linkedin-url.ts` accepts only HTTPS LinkedIn `/in/` profile URLs so the service cannot become a general-purpose URL fetcher.

### LinkedIn adapter

All reverse-engineered LinkedIn behavior lives in `src/linkedin/`; no HTTP route or operational wrapper knows about Flight rows, private pager identifiers, or profile-card shapes.

| Module | Responsibility |
| --- | --- |
| `profile-provider.ts` | `LinkedInProfileProvider` orchestrates profile page → optional About card → section pages → parsed profile. Its private methods own HTTP checks and pagination. |
| `profile-parser.ts` | `parseProfilePage` reads page fields; `parseLinkedInProfile` accepts a named response bundle and assembles the public object, limits, and warnings. |
| `section-parsers.ts` | Section-specific parsers map collection and list shapes into experience, education, skills, certifications, and languages. |
| `react-flight-parser.ts` | Bounded row decoding, reference traversal, and semantic text collection. |
| `request-limiter.ts` | One shared rolling-window request limiter with minimum spacing and cancellation. |

Endpoints use only the validated public slug, advertised component identifiers, and transient profile identifier from the same response. Session values come only from runtime configuration. Sanitized synthetic fixtures exercise parsing without contacting LinkedIn.

### Provider contract and assembly

`src/provider/profile-provider.ts` defines the small `ProfileProvider` contract and typed failure classes. The remaining files in that directory wrap it with independent operational policies. `buildProfileProvider` in `src/server.ts` makes their order explicit; the server then builds the HTTP app and installs shutdown handlers.

The wrappers remain separate because they own different state and cancellation rules. The section parsers remain together because their small helpers and upstream shapes are closely related. There is no per-field plugin system, generic parser framework, or file for every helper.

### Operational invariants

- Cache/coalescing is outermost: warm hits and same-profile consumers do not create duplicate LinkedIn work.
- The overall deadline includes bounded FIFO queue time. Queue overflow returns retryable `429 provider_busy`.
- The circuit breaker is outside the public-demo cold-extraction budget, so open-circuit rejections do not consume credits.
- One request limiter paces all LinkedIn HTTP calls. Authentication or protection signals stop peer and queued work; there is no automatic retry or bypass.
- Response validation fails loudly on unknown empty shapes, declared/parsed count discrepancies, repeated pages, malformed bodies, or invalid public output. Section arrays are capped at 50 with explicit completeness warnings.
- Client disconnect and service shutdown propagate cancellation through coalescing, queue waits, and active requests.

Access modes, transport checks, logging controls, and the complete adversarial catalog are documented in [hardening.md](hardening.md).

### Burst behavior

A burst is not mapped one-for-one to LinkedIn. Cached requests return without upstream work, concurrent requests for the same canonical profile share one extraction, and a small FIFO queue admits distinct misses up to its configured bound. Further distinct misses receive `429 provider_busy` with `Retry-After`. Active extractions still pass through the independent LinkedIn request limiter and circuit breaker, so API ingress capacity never raises upstream concurrency or pacing.

## Deliberate omissions

- No browser, Playwright, Chromium, or Selenium runtime.
- No LinkedIn username or password handling.
- No CAPTCHA or checkpoint solving.
- No automatic retry loop against LinkedIn.
- No database or long-term profile retention.
- No raw profile bodies in the smoke-test output or application logs.
- No deployment-specific SDK in the application core.

The private provider is intentionally isolated because its endpoint and schema are unstable and compliance-sensitive.
