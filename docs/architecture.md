# Architecture

## Request flow

```text
HTTP request
  -> bearer-token check and separate unauthorized quota
  -> authenticated profile quota
  -> LinkedIn URL validation and canonicalization
  -> short-lived cache and same-profile request coalescing
  -> one overall extraction deadline
  -> upstream concurrency limit
  -> authentication/challenge circuit breaker
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

`src/app.ts` owns routing, caller authentication, rate limiting, status codes, and the public error contract. It depends only on `ProfileProvider`.

### Domain layer

`src/domain/profile.ts` defines the stable public schema. `src/domain/linkedin-url.ts` accepts only HTTPS LinkedIn `/in/` profile URLs so the service cannot become a general-purpose URL fetcher.

### Provider layer

`src/provider/linkedin-api-provider.ts` fetches the validated profile page, follows LinkedIn's advertised lazy profile-card component contract for About-capable cards, and then calls the private RSC pagination endpoint for each supported section. Endpoints are constructed only from the validated public identifier, component identifiers in LinkedIn's response, and the transient profile identifier returned in the same response. Session values come only from runtime configuration.

`src/provider/extract-profile.ts` is a pure parser. It reads the `rehydrate-data` React Flight stream, resolves row references and lazy component request metadata, collects semantic text from rendered component content, and maps section entries into the stable domain schema. Sanitized synthetic Flight fixtures cover this boundary without contacting LinkedIn.

### Operational controls

- Successful results are cached briefly, and simultaneous misses for the same profile share one upstream request.
- The cache is bounded with LRU eviction, opportunistic expiry cleanup, and a zero-cache mode.
- Distinct uncached profile extractions are limited to two at a time by default.
- Production startup requires a bearer token. A current and previous token can overlap during a bounded rotation window; comparison uses fixed-size digests and constant-time equality.
- Unauthorized requests have an IP-scoped quota separate from the authenticated profile quota, and health checks do not consume either profile quota.
- Profile requests have a small body limit and return `Cache-Control: no-store`.
- Session cookies and CSRF values exist only in runtime configuration.
- Authorization headers, cookies, request bodies, and response bodies are redacted from structured logs.
- Every extraction has one overall deadline, including queue time. Individual fetches also have a timeout, response-size bound, MIME check, UTF-8 validation, and truncated-body check.
- A process-wide breaker opens on 401/403, login redirects, checkpoints, consent walls, CAPTCHAs, and 429/999 responses. It aborts peer work, blocks queued network calls, and closes only after its cooldown.
- Direct LinkedIn requests pass through one process-wide rolling-window limiter with minimum spacing. They are never automatically retried.
- Every zero-item pagination response requires the known empty marker. Declared-item/parser-count discrepancies, repeated pages, and changed later-page shapes fail closed.
- Section pagination is capped at five requests and every public section array is hard-capped at 50 entries. A full fifth page or upstream page-size over-delivery returns a warning that the result may be truncated.
- Client disconnect and service shutdown signals propagate cancellation through cache coalescing, queue waits, and active fetches.

## Deliberate omissions

- No browser, Playwright, Chromium, or Selenium runtime.
- No LinkedIn username or password handling.
- No CAPTCHA or checkpoint solving.
- No automatic retry loop against LinkedIn.
- No database or long-term profile retention.
- No raw profile bodies in the smoke-test output or application logs.
- No deployment-specific SDK in the application core.

The private provider is intentionally isolated because its endpoint and schema are unstable and compliance-sensitive.
