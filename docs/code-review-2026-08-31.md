# Full codebase review — 2026-08-31

## Verdict

The codebase is appropriately modular after a targeted parser split, and the reviewed branch passes every deterministic, schema, packaging, and local runtime gate. The provider remains inherently version-sensitive because it calls undocumented LinkedIn endpoints; this review does not convert bounded evidence into a universal compatibility claim.

The work is isolated on `codex/full-codebase-review`. It has not been pushed, deployed, or submitted.

## Review method

- Codex inspected every tracked source, test, script, configuration, documentation, CI, dependency, and container file; ran static, dependency, secret, build, runtime, and adversarial checks; and reviewed the provider composition and stable/upstream contract boundary.
- Claude Code `2.1.221` ran an independent whole-project review with the exact `claude-opus-5` model. A second focused Opus pass verified closure of its final four findings and returned `RELEASE` with no new regression found.
- A whole-repository over-engineering audit was used to challenge both the old monolith and unnecessary abstraction. It supported one cohesive three-file parser boundary rather than per-section modules, generic visitor frameworks, or extra provider interfaces.

## Actionable findings implemented

### Architecture and readability

- Split the former 1,060-line parser into `react-flight.ts` for bounded Flight traversal, `extract-profile-sections.ts` for section mapping, and the stable `extract-profile.ts` facade for identity, About, images, warnings, and result assembly.
- Preserved the existing import surface and kept closely related section heuristics together. No application-wide framework or one-file-per-section hierarchy was introduced.
- Made production builds deterministic by cleaning stale output, compiling runtime source only, and excluding developer scripts and deleted historical modules from the image.

### Correctness and failure semantics

- Put the circuit breaker outside the public cold-extraction budget so open-circuit rejections cannot consume extraction credits.
- Replaced broad protection-word matching with structural HTML evidence so legitimate names, headlines, biographies, and RSC values cannot open the process-wide circuit.
- Fixed the cache handoff race between abandoned shared work and a fresh same-profile caller.
- Joined certification links by LinkedIn collection identity and omitted ambiguous positional links.
- Preserved authoritative About cards containing LinkedIn product names and prevented adjacent section labels from becoming About text.
- Classified invalid caller input as `400` and invalid provider output as an upstream `502` contract failure.
- Normalized response-stream failures, cancelled declared-oversized bodies, and preserved caller abort reasons.
- Decoded common and numeric HTML title entities, made the bearer scheme case-insensitive, and applied `nosniff` to every route.

### Bounds and safe defaults

- Capped profile-image output at 50 in both extraction and the public schema.
- Rejected already-aborted cache callers before starting upstream work.
- Changed copied environment defaults to fail closed instead of supplying predictable placeholder credentials.

## Deliberate non-changes

- No further parser split: the remaining files are cohesive, and another layer would scatter shared heuristics without reducing coupling.
- No generic Flight visitor abstraction: the traversals have different accumulators and stop rules, so a callback framework would obscure behavior.
- No pagination-result memoization: extraction is sub-millisecond on current fixtures; measure real large payloads before adding state.
- No trust-proxy change based only on deployment assumptions. The anonymous client bucket remains a fairness control and the global quota remains the security boundary.
- No image-host allowlist without first inventorying authorized regional LinkedIn CDN hosts; HTTPS, credential, same-origin suffix, size, and count checks remain enforced.
- No dependency churn for patch releases unrelated to a demonstrated defect; the installed production graph reports no vulnerability.

## Validation evidence

| Gate | Result |
| --- | --- |
| TypeScript, including unused locals/parameters | Pass |
| Source lint | Pass, zero warnings |
| Bearer and public-demo OpenAPI lint | Pass |
| Deterministic tests | 173/173 pass across all 13 test files |
| Coverage | 94.65% statements, 86.39% branches, 96.61% functions, 96.57% lines |
| Production compile | Pass; clean runtime-only `dist/` |
| Production dependency audit | 0 reported vulnerabilities |
| Gitleaks working tree and all 26 commits | No leaks found |
| Docker build and artifact inspection | Pass; no developer scripts, stale browser provider, `npm`, or `npx` in runtime |
| Container endpoint smoke | Discovery, health, and OpenAPI pass; runtime user is `node` |
| Independent Opus closure review | Four final findings closed; no new regression; `RELEASE` |

Every committed synthetic profile fixture and adversarial shape is exercised by the deterministic suite. A fresh replay of the prior 13-case authorized live matrix was also attempted through this branch's local server and pacing controls. Case 1 returned HTTP 200 with all core identity fields and its rich sections; case 2 returned `502 provider_fetch_failed`. The run stopped immediately without retrying or calling the remaining 11 profiles because the response could represent authentication, protection, or upstream drift.

Therefore the fresh live matrix is **incomplete, not passed**. The prior dated 13/13 evidence in `acceptance.md` belongs to the earlier deployed revision and is not presented as proof for this branch. A future authorized canary should resume only after confirming session/upstream health and should keep the same privacy-minimized stop rules.

## Residual risks

- LinkedIn can change private paths, identifiers, pagination behavior, or React Flight shapes without notice.
- Structurally valid semantic drift can still produce plausible wrong fields; sanitized fixtures plus low-frequency authorized canaries are the mitigation.
- A process-local cache, limiter, budget, and circuit require the documented one-instance ceiling or shared state in a multi-instance production design.
- No code review can prove behavior for every LinkedIn profile. The meaningful claim is complete deterministic coverage of represented shapes plus dated, bounded live evidence.
