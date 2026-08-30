# Hardening and adversarial verification

This service depends on undocumented LinkedIn HTTP and React Flight contracts. Its defensive goal is therefore not to promise permanent compatibility; it is to limit account and infrastructure blast radius, reject ambiguous drift, and make possible incompleteness visible.

## Implemented controls

- Strict HTTPS `linkedin.com/in/<slug>` canonicalization rejects credentials, ports, malformed encoding, encoded separators, controls, and non-identifier characters before provider access.
- Bearer mode is the production default and refuses to start without an API key. A previous key can overlap briefly for rotation, and unauthorized traffic has a separate peer-address quota so it cannot consume the valid-caller quota.
- Controlled public access requires the explicit `public-demo` mode and a parseable expiry timestamp. It has separate hashed per-client and global ingress quotas, closes automatically at expiry, and spends a bounded cold-extraction credit only after a cache miss is admitted for execution. The client bucket is a fairness control; the global bucket, bounded distinct-profile queue, extraction budget, one-instance ceiling, provider concurrency, pacing, and circuit breaker bound account exposure.
- Profile requests use a small body limit and `no-store`; logs redact caller authorization, cookies, request bodies, and extracted response bodies.
- Framework parser failures are normalized to the public `{ error, message }` envelope; malformed JSON, oversized bodies, unsupported media, and unexpected errors have explicit OpenAPI responses.
- Completed cache entries have TTL and LRU bounds. Same-profile misses coalesce, but one disconnected consumer does not cancel work still needed by another; all-consumer cancellation does.
- One extraction-wide deadline includes queue time. Distinct profiles have a bounded FIFO concurrency queue whose overflow returns retryable `429 provider_busy`, and LinkedIn requests share rolling-window pacing plus minimum spacing.
- Authentication, checkpoint, consent, CAPTCHA, 429, and 999 signals open one process-wide circuit. It cancels peer work and prevents queued requests from reaching LinkedIn until cooldown. The circuit sits outside the public cold-extraction budget so its own rejections cannot consume that budget.
- Successful upstream responses have MIME, byte-size, UTF-8, and uncompressed truncation checks. Oversized streams are cancelled, transport-stream errors remain normalized provider failures, and login/challenge classification requires structural HTML evidence so profile titles, biographies, and ordinary RSC text cannot open the circuit.
- Pagination validates every page, rejects declared-item/parser-count discrepancies, unknown empty shapes, and repeated pages. The hand-owned schema and extractor both enforce the intentional 50-item cap, including when an upstream page contains more records than requested, and return a completeness warning.
- The parser bounds reference/object traversal, joins credential links to collection identities instead of array positions, and omits a link when only an ambiguous positional association exists. It rejects unsafe credential and image URLs, caps image output, preserves richer duplicate records, and validates the final public object with hand-owned Zod schemas. A provider contract violation is reported as an upstream `502`, never as malformed caller input.
- `SIGINT`/`SIGTERM` initiate Fastify shutdown and abort active extraction controllers. The smoke command emits privacy-minimized structural evidence only.
- CI enforces zero-warning source lint, recommended OpenAPI lint for both access modes, coverage thresholds, dependency and full-history secret auditing, a production image build, and a pinned high/critical Trivy scan. Production compilation cleans stale output and emits runtime source only; the runtime layer excludes developer scripts, removes unused package-manager tooling, and runs as the unprivileged `node` user.

## Deterministic adversarial catalog

The local suite covers:

- Malformed URLs, percent escapes, encoded slash/backslash/double encoding, credentials, ports, Unicode slugs, oversized bodies, absent/invalid/current/previous API keys, case-insensitive bearer schemes, provider-contract violations, explicit public-demo configuration and expiry, per-client/global quota separation, cold-extraction budgeting, and health-route isolation.
- Missing/expired session configuration; 401/403; login/checkpoint redirects; HTTP 429/999; structurally identified HTTP-200 auth, challenge, and consent pages; legitimate names/headlines and ordinary RSC text containing protection words; timeout; deletion; wrong or missing MIME; oversized, cancelled, truncated, malformed UTF-8, and failed response streams.
- Overall deadline expiry while active and queued, FIFO fairness, queue-overflow rejection, limiter cancellation both during a timed wait and behind another waiter, slot release after failure, and graceful shutdown cancellation.
- Circuit opening, queued-call suppression, peer cancellation, authentication-triggered opening, cooldown recovery, and proof that open-circuit calls do not spend extraction credits.
- Cache coalescing across a 100-request same-profile burst, coalescing failure, TTL expiry, zero-cache mode, LRU behavior, a thousand unique slugs, already-aborted callers, one-consumer cancellation, all-consumer cancellation, and replacement work arriving before abandoned upstream work settles.
- Pagination totals of 9, 10, 11, 20, 49, 50, and 51; an upstream page larger than the requested size; declared-ten/parsed-eight disagreement; malformed later pages; exact repeats; cross-page duplicates; monotonic requested offsets; and the 50-item warning.
- Short, whitespace-only, multi-paragraph, emoji, RTL, CJK, combining-character, zero-width, label-like, and product-name-bearing About values; adjacent section-label rejection; empty `children` with populated `initialContent`; and the current explicit-empty advertised-card structure.
- Grouped and overlapping roles, undated work, career breaks, missing optional fields, delimiter-bearing company names, non-bulleted descriptions, multiple degrees at one school, renewed certificates, marker-only and non-semantic collection entities, language proficiency, HTML title entities, unsafe redirects, absent/custom/partial/over-limit images, and unrelated or malformed image candidates.
- Missing, duplicate, cyclic, deeply nested, malformed, CRLF, and non-hex React Flight rows plus deterministic fixture mutations. Assertions require bounded execution, schema-valid output, and no invented malformed-section values.

## Residual risks and production work

- A structurally valid but semantically changed LinkedIn payload can still produce plausible wrong fields. Sanitized fixtures and a low-frequency authorized canary are the detection strategy, not a proof against future drift.
- LinkedIn does not expose a stable public completeness contract here. The service cannot distinguish exactly 50 items from 51 or more, so it warns rather than claiming completeness.
- Cache, rate-limit, request pacing, and circuit state are process-local. A multi-instance deployment needs shared controls or a deliberately enforced one-instance ceiling.
- The service has structured logs but no metrics backend or alert policy. Production should alert on provider error classes, breaker openings, warning rates, latency/deadline rates, and sudden field/count shifts without recording personal text.
- Hosting controls remain deployment responsibilities: least-privilege service identity, secret-manager access boundaries, ingress policy, instance cap, egress visibility, dependency/image refresh automation, and tested secret/session rotation.
- Live canaries must remain authorized, low-volume, privacy-minimized, and stop on the first authentication, checkpoint, CAPTCHA, 429/999, or credible throttling signal. No protection bypass is supported.
