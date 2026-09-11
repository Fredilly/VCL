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

## Phase 2 — Magic prototype

Integrate full flow.

Acceptance test:

1. Open a supported YouTube video with visible shoes/watch/bag/apparel.
2. Pause.
3. Invoke extension.
4. Click item.
5. Results appear.
6. At least one result is commercially useful OR system truthfully reports low confidence.
7. No result misrepresents a sponsored/similar item as exact.

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
- exact/likely classification quality,
- useful result rate,
- latency,
- cost.

Do not tune only on anecdotal demos.

## Phase 4 — Small external alpha

Only after internal benchmark passes.

Requirements:
- privacy notice,
- clear permissions,
- error telemetry,
- unsupported-content state,
- no Amazon Associates dependency,
- no DRM circumvention,
- uninstall/disable works cleanly.

Target:
10–50 testers.

## Phase 5 — Decide whether to continue

Continue only if:
- users repeat the action,
- useful-result rate is strong,
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
