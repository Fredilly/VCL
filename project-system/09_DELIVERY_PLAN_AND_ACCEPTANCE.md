# 09 — Delivery Plan and Acceptance

## Phase 1 — Technical proof

Build Spikes 0–4.

Deliverable:
working developer-loaded extension.

Acceptance:
- supported video detected,
- frame acquired through permitted path,
- click region extracted,
- object described,
- product candidates returned.

No production polish required.

## Phase 1B — Product-resolution hardening

Before treating the commerce loop as launch-ready, complete Spike 4b–4f.

Acceptance:
- commerce resolver has bounded provider timeouts,
- no-result and provider-error states are distinct,
- query broadening/fallback works,
- one provider failure does not become a raw user-facing error where an alternate path exists,
- product retrieval latency is measured,
- exact/likely/similar classification is evidence-based,
- known-product benchmark exists for exact-match evaluation.

Initial performance targets:
- P50 product-resolution latency <= 3 seconds where practical,
- P95 <= 6 seconds where practical,
- >99% graceful response rate,
- commercially useful result in >= 70% of curated cases.

`Graceful response` means:
- useful candidates returned, or
- a truthful low-confidence/no-result/temporarily-unavailable state.

It does not mean every provider succeeds.

## Phase 2 — Magic prototype

Integrate full flow.

Acceptance test:

1. Open a supported YouTube video with visible shoes/watch/bag/apparel.
2. Invoke extension during playback or while paused.
3. Click item.
4. Results appear.
5. At least one result is commercially useful OR system truthfully reports low confidence/no useful result.
6. No result misrepresents a sponsored/similar item as exact.
7. Slow or failed commerce providers do not block indefinitely.

Target:
10 manually selected benchmark videos.

## Phase 3 — Benchmark

Create a reproducible benchmark:
- 25–50 selections,
- category-balanced,
- obvious + difficult items,
- known exact items where possible,
- unavailable/vintage cases.

Record:
- object description quality,
- exact precision,
- likely precision,
- false-exact rate,
- useful result rate,
- no-result rate,
- P50/P95 latency,
- provider failure rate,
- cost.

Exact identity benchmark:
- use known ground-truth products where possible,
- measure exact-match precision separately from similar-product usefulness,
- never improve exact coverage by tolerating false-exact claims.

Do not tune only on anecdotal demos.

## Phase 4 — Small external alpha

Only after internal benchmark passes.

Requirements:
- privacy notice,
- clear permissions,
- error telemetry,
- unsupported-content state,
- graceful commerce-provider degradation,
- no Amazon Associates dependency,
- no DRM circumvention,
- uninstall/disable works cleanly.

Target:
10–50 testers.

## Phase 5 — Decide whether to continue

Continue only if:
- users repeat the action,
- useful-result rate is strong,
- exact/likely identification is improving without false-exact trust failures,
- product resolution is meaningfully better than manual screenshot/search friction,
- costs are low,
- platform fragility is manageable,
- at least one scalable commerce route is legally/commercially viable.

## Budget policy

Prototype:
target $0 incremental recurring cost.

Alpha:
target <= $50/month until usage justifies more.

Do not subscribe to:
- Roboflow paid plan,
- paid vector database,
- dedicated GPU,
- enterprise monitoring,
- multiple model providers,
- paid catalog provider

unless a measured requirement justifies it.

## Build-order rule

Never build Phase N+1 to compensate for a failed Phase N.

Example:
Do not create creator dashboards because product resolution is weak.
Fix product resolution first.


## Spike 7B — Commerce Eligibility Gate Before Retrieval

Goal: Reduce wasted commerce retrieval and verification caused by poor object understanding.
