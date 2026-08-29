# Acceptance evidence

This document publishes aggregate, privacy-minimized evidence for the Tross hiring challenge. The internal audit used authorized LinkedIn access but does not publish profile slugs, biographies, descriptions, contact data, cookies, tokens, or complete live responses.

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

## August 30 release-candidate recheck

A bounded three-case canary covered a content-rich profile, a profile with more skills than the public cap, and a profile whose advertised About card was explicitly empty. The canary exposed two edge cases; after regression fixes, both affected cases were called once more on the final candidate:

- The explicit-empty About card returned HTTP 200 with About omitted, all core identity fields present, and no parser warning.
- The oversized skills case returned exactly 50 skills plus `skills reached the 50-item safety limit and may be truncated.`
- No authentication wall, checkpoint, CAPTCHA, HTTP 429/999, or protection signal appeared.

The same candidate passed 136 deterministic tests, TypeScript compilation, a production Docker build and endpoint smoke test, a production-dependency audit with zero reported vulnerabilities, and a full-history secret scan. Only field-presence flags, aggregate counts, generic warnings, and status codes were retained from live calls.

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

## Deterministic failure contract

The test suite covers these expected outcomes:

| Case | Expected behavior |
| --- | --- |
| Expired session or upstream 401/403 | `ProviderAuthenticationError` |
| Login, consent, checkpoint, or CAPTCHA response | Authentication failure and process-wide cooldown |
| LinkedIn 429/999 | Non-retrying provider failure and process-wide cooldown |
| Upstream timeout or client disconnect | Cancellation-aware provider failure |
| Malformed or non-profile URL | HTTP 400 before provider access |
| Deleted or incomplete profile | Provider failure |
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
