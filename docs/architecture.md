# Architecture

## Request flow

```text
HTTP request
  -> bearer-token check
  -> LinkedIn URL validation and canonicalization
  -> short-lived cache and same-profile request coalescing
  -> upstream concurrency limit
  -> direct LinkedIn profile-page request
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

`src/provider/linkedin-api-provider.ts` fetches the validated profile page and then calls LinkedIn's private RSC pagination endpoint for each supported section. Endpoints are constructed only from the validated public identifier and the transient profile identifier returned in LinkedIn's own server-rendered response. Session values come only from runtime configuration.

`src/provider/extract-profile.ts` is a pure parser. It reads the `rehydrate-data` React Flight stream, resolves row references, collects semantic text from rendered component children, and maps section entries into the stable domain schema. Sanitized synthetic Flight fixtures cover this boundary without contacting LinkedIn.

### Operational controls

- Successful results are cached briefly, and simultaneous misses for the same profile share one upstream request.
- Distinct uncached profile extractions are limited to two at a time by default.
- API callers can be protected with a bearer token and are rate-limited.
- Session cookies and CSRF values exist only in runtime configuration.
- Redirects to login/checkpoint pages and authentication failures are surfaced explicitly.
- LinkedIn rate limits and challenge status codes are not retried or bypassed.
- Section pagination is capped at five pages per section and successful aggregate results are cached.

## Deliberate omissions

- No browser, Playwright, Chromium, or Selenium runtime.
- No LinkedIn username or password handling.
- No CAPTCHA or checkpoint solving.
- No automatic retry loop against LinkedIn.
- No database or long-term profile retention.
- No deployment-specific SDK in the application core.

The private provider is intentionally isolated because its endpoint and schema are unstable and compliance-sensitive.
