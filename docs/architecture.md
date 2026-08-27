# Architecture

## Request flow

```text
HTTP request
  -> bearer-token check
  -> LinkedIn URL validation and canonicalization
  -> short-lived cache
  -> profile provider
  -> rendered-page extraction
  -> Zod response validation
  -> JSON response
```

## Boundaries

### HTTP layer

`src/app.ts` owns routing, authentication, rate limiting, status codes, and the public error contract. It depends only on the `ProfileProvider` interface.

### Domain layer

`src/domain/profile.ts` is the stable public schema. `src/domain/linkedin-url.ts` accepts only canonical HTTPS LinkedIn `/in/` profile URLs, which prevents arbitrary server-side URL fetching.

### Provider layer

`src/provider/profile-provider.ts` defines the external-data boundary. The current Playwright implementation loads an already-authenticated storage-state secret, renders a profile, and passes the resulting HTML to a pure extractor.

`src/provider/extract-profile.ts` contains the markup-dependent logic. It is covered by a saved synthetic fixture so selector and parsing changes can be reviewed without contacting LinkedIn.

### Operational controls

- Successful profile results are cached briefly to reduce repeated upstream access.
- Public callers can be protected with `API_KEY` and are rate-limited.
- Authentication state is loaded at runtime and is excluded from Git and container layers.
- Checkpoints and authentication walls are surfaced as errors; the service does not bypass them.

## Deliberate omissions

- No username or password handling.
- No CAPTCHA or checkpoint solving.
- No undocumented LinkedIn API endpoint is hard-coded.
- No database or long-term profile retention.
- No deployment-specific SDK in the application core.

These choices keep the first version small and make the compliance-sensitive provider replaceable.
