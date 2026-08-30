# Acceptance evidence

This document publishes aggregate, privacy-minimized evidence for the Tross hiring challenge. The internal audit used authorized LinkedIn access but does not publish profile slugs, biographies, descriptions, contact data, cookies, tokens, or complete live responses.

## August 31 readability-release verification

The reorganized LinkedIn adapter passed the original 13-profile matrix using its exact canonical URLs through a freshly started local HTTP API. This exercised bearer access, URL validation, cache, deadline, queue, circuit breaker, request pacing, parsing, and public response validation together. Calls were sequential with 20 seconds between completed cases; the runner stops on the first failure.

- 13/13 requests returned HTTP 200 and schema-valid profiles, with name, headline, location, and profile images present in every case.
- About was present in 11 cases and omitted in two. The sample included grouped and standalone experience, sparse/empty sections, education, paginated skills, a 21-certification profile, and up to five languages.
- Three profiles returned 50 skills with an explicit possible-truncation warning. No section exceeded the public limit.
- Individual requests took 4.0–8.2 seconds. No timeout, unavailable-profile response, authentication failure, checkpoint, CAPTCHA, HTTP 429/999, or retry occurred.
- The local server retained the standard 25-second extraction deadline, 60 LinkedIn requests/minute, and 100 ms minimum upstream spacing. Production has stricter pacing; this local matrix is not a production load test.
- All 180 deterministic tests passed, including five matrix-runner privacy/failure tests. Typechecking, zero-warning source lint, both OpenAPI access modes, and the production build passed. Coverage was 94.68% statements, 86.54% branches, 96.68% functions, and 96.68% lines.
- Dependency audit and Git-history/staged-diff secret scans were clean. The production container passed discovery/docs/OpenAPI/health and 401/400 boundary checks as an unprivileged user; its scan reported no fixable high/critical vulnerabilities. Cloud Build upload enumeration included no private environment, authentication, or temporary audit files.

Correction to the earlier August 31 record: the initial replay was mistakenly assembled from partial search identifiers rather than the original canonical URLs. Its eight-success/five-unavailable and later nine-success/four-unavailable conclusions are withdrawn. Five URLs were truncated, and two successful requests could have referred to different profiles. The corrected run above succeeded for all 13 intended URLs; it does not support an unavailable-profile claim about any of them.

This recheck retained only case labels, field-presence flags, counts, warning categories, status codes, and timings. It did not repeat the August 29 field-by-field browser comparison and does not prove semantic completeness or universal LinkedIn compatibility.

## Dated live audit

On August 29, 2026, Cloud Run revision `tross-linkedin-profile-api-00009-p5w` passed a 13-profile acceptance matrix using direct LinkedIn HTTP and React Flight/RSC requests. The deployed application did not launch or depend on a browser; a signed-in browser was used only for read-only comparison with the visible profile UI.

- 13/13 final-revision requests returned HTTP 200.
- 11/11 visible About sections matched after whitespace normalization using length and SHA-256 comparisons rather than retained profile text.
- Name, headline, and location matched on 13/13 cases.
- Profile variants covered grouped roles, short and multi-paragraph About cards, sparse and empty sections, regional/Unicode content, a custom framed image, accessible third-degree profiles, and lists near the intentional pagination cap.
- Skills were exhaustively compared at 28, 47, 48, and 50 entries.
- A 21-item certification case matched all names and issuers, every available date, all 16 credential IDs, and all 20 visible credential links.
- Language cases covered one through five entries plus an explicitly empty section.
- One targeted experience case matched all eight role records and all description presence/absence states.
- No CAPTCHA, confirmed checkpoint, authentication failure, HTTP 429/999, or credible throttling signal occurred. No bypass or automatic retry was attempted.

This is pass evidence for the dated sample, not a claim that every profile or future undocumented LinkedIn response shape will work.

## August 30 deployed-release recheck

An initial bounded release-candidate canary covered a content-rich profile, a profile with more skills than the public cap, and a profile whose advertised About card was explicitly empty. It exposed two edge cases, which were fixed and rechecked locally. Source commit `fc8c505` was then deployed as Cloud Run revision `tross-linkedin-profile-api-fc8c505`, and the same three cases were called once against that production revision:

- All three production requests returned HTTP 200 with name, headline, location, and profile images present.
- The explicit-empty About card returned HTTP 200 with About omitted, all core identity fields present, and no parser warning.
- The oversized skills case returned exactly 50 skills plus `skills reached the 50-item safety limit and may be truncated.`
- No authentication wall, checkpoint, CAPTCHA, HTTP 429/999, or protection signal appeared.

The same source release passed 136 deterministic tests, TypeScript compilation, a production Docker build and endpoint smoke test, a production-dependency audit with zero reported vulnerabilities, and a full-history secret scan. Its public discovery, human-readable docs, OpenAPI 3.1 document, health route, and unauthenticated 401 boundary were also verified after deployment. Only field-presence flags, aggregate counts, generic warnings, and status codes were retained from live calls.

## Defects found through acceptance testing

The live matrix found and drove regression fixes for:

1. Asynchronously loaded and short About cards.
2. Grouped-company roles, standalone experience records, and descriptions.
3. Certification credential links.
4. Root-attached and framed owner profile images.
5. Unknown empty pagination shapes that could otherwise look like genuine empty sections.
6. An advertised About component whose known structure explicitly represented an empty value.
7. Upstream pages that returned more records than the requested page size, which could exceed the public 50-item contract.

All committed regression fixtures are synthetic and sanitized.

## August 30 bounded public-demo release

On August 30, source commit `3d6cd21` was deployed as Cloud Run revision `tross-linkedin-profile-api-3d6cd21` at 100% traffic. The final release added explicit public-demo access, uniform HTTP error envelopes, stronger bearer-key validation, a bounded distinct-profile FIFO queue, and enforced release gates.

- All 155 deterministic tests, TypeScript checks, zero-warning source lint, and both bearer/public-demo OpenAPI recommended lint passed.
- Global test coverage was 94.35% statements, 85.95% branches, 96.96% functions, and 96.39% lines; CI enforces minimums of 90%, 80%, 90%, and 90% respectively.
- `npm audit` reported zero vulnerabilities, the full-history Gitleaks scan reported no leaks, and Trivy reported zero fixed high/critical findings in the final image.
- The production image ran as the unprivileged `node` user and excluded unused `npm`/`npx` tooling from the runtime layer.
- Live discovery, health, docs, and OpenAPI returned HTTP 200. Malformed JSON, unsupported media, and oversized bodies returned the documented `400`, `415`, and `413` envelopes.
- A 100-request same-profile production burst launched all requests together and returned 100/100 HTTP 200 responses in 5.9 seconds, all with structured data and no error or protection signal. Cache/coalescing and queue behavior is covered separately by deterministic tests so raw profile content was not retained.
- Cloud Run reported ready status, 100% traffic on the final revision, service- and revision-level maximum instance counts of one, concurrency 10, timeout 30 seconds, a four-request distinct-profile queue, 120/client and 180/global minute-level ingress limits, a 100-start cold-extraction cap, and the documented automatic public-demo expiry.

## Deterministic failure contract

The test suite covers these expected outcomes:

| Case | Expected behavior |
| --- | --- |
| Expired session or upstream 401/403 | `ProviderAuthenticationError` |
| Login, consent, checkpoint, or CAPTCHA response | Authentication failure and process-wide cooldown |
| LinkedIn 429/999 | Non-retrying provider failure and process-wide cooldown |
| Upstream timeout or client disconnect | Cancellation-aware provider failure |
| Malformed or non-profile URL | HTTP 400 before provider access |
| Explicit unavailable or deleted profile | HTTP 404 `profile_unavailable` |
| Missing profile identifier without unavailable evidence | Fail-closed provider failure |
| Unknown zero-item or repeated pagination page | Fail closed |
| Explicit empty section with the known marker | Return an empty array |
| Explicit empty advertised About component | Omit About and continue |
| Full fifth page or upstream page over-delivery | Return at most 50 entries with a possible-truncation warning |

## Residual limits

- LinkedIn's private paths, component identifiers, experiments, and response shapes can change without notice.
- A structurally valid but semantically changed payload can still produce plausible incorrect data. Sanitized fixtures and a low-frequency authorized canary reduce, but do not eliminate, that risk.
- A section intentionally returns at most 50 entries. The service cannot distinguish exactly 50 from more than 50 and therefore emits a warning rather than claiming completeness.
- The dated live audit did not prove a fully localized non-English LinkedIn UI or a known profile visible in the browser but restricted to the direct endpoint.
- Cache, limiter, and circuit-breaker state are process-local; the reference deployment enforces a one-instance ceiling.
- A production service handling personal data still requires an appropriate lawful basis, retention and deletion controls, auditability, and operational monitoring.

The release remains intentionally fail-closed and does not bypass LinkedIn protections.
