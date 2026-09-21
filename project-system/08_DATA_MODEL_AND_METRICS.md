# 08 — Data Model and Metrics

## Minimal entities

### visual_event
- id
- surface_type
- platform
- content_external_id_hash
- timestamp_ms
- selection_box
- created_at
- processing_status

Avoid storing user-identifying platform data unless required.

### object_hypothesis
- event_id
- category
- subcategory
- brand_candidate
- model_candidate
- attributes_json
- confidence
- provider
- provider_model_version

### product_candidate
- id
- canonical_key
- title
- brand
- model
- category
- image_reference
- provenance

### merchant_offer
- product_candidate_id
- merchant
- price
- currency
- availability
- destination
- affiliate_eligible
- fetched_at

### ranked_result
- event_id
- product_candidate_id
- result_class
- relevance_score
- sponsored
- rank
- explanation

### user_feedback
- event_id
- result_id
- feedback_type
- created_at

Allowed MVP feedback types:
- useful
- wrong_item
- wrong_category
- not_similar
- correct_match

Feedback is linked to an existing visual event and ranked result. No account is required for the early prototype. Do not attach browsing history, raw frames, or unnecessary user identity to feedback.

### verified_product_assertion
- content_id
- timestamp_start_ms
- timestamp_end_ms
- object_descriptor
- region_reference
- canonical_product_id
- creator_or_publisher
- verification_source
- verification_status
- created_at

Allowed verification states:
- pending
- verified
- revoked

A verified assertion is first-party/trusted metadata with provenance. It may become identity evidence only after a benchmarked integration. It may never become an identity override merely because a creator, merchant, sponsor, or affiliate relationship exists.

### commercial_event
- event_id
- result_id
- event_type
- merchant
- attribution_token
- created_at

## Feedback and verified-assertion contracts

Runtime-neutral TypeScript contracts live in:

`apps/api/src/feedback.ts`

They validate feedback labels, event/result references, assertion provenance, time ranges, and verification status without changing current matching or ranking.

### Proposed feedback API

When persistent storage is introduced, use a bounded endpoint concept such as:

`POST /feedback`

Request:

```json
{
  "event_id": "evt_...",
  "result_id": "result_...",
  "feedback_type": "useful"
}
```

Response:

```json
{
  "accepted": true
}
```

Requirements:
- accept only known feedback types,
- generate `created_at` server-side,
- require valid event/result identifiers,
- rate-limit abuse,
- do not require an account during early alpha unless abuse forces it,
- do not return or store raw frame data,
- do not automatically feed responses into training.

The extension may render thumbs up/down as a simplified UI:
- thumbs up -> `useful`
- thumbs down -> initially `wrong_item` or a follow-up choice among the negative labels

Do not invent a separate feedback data system for the UI.

### Proposed verified-assertion API

Verified creator/publisher metadata is higher trust and must not use the anonymous feedback path.

Future bounded concept:

`POST /verified-assertions`

This write path must require an authenticated/trusted operator or partner context before production use. The stored assertion must preserve `verification_source`, `creator_or_publisher`, and `verification_status`.

Do not expose public anonymous assertion writes.

## Minimal storage path

The current Worker has no persistent application database. Do not introduce a database solely for issue #20.

When alpha telemetry/storage is added, persist these records in the same low-cost event store rather than adding a separate service.

Logical schema:

```sql
CREATE TABLE user_feedback (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  result_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE verified_product_assertion (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  timestamp_start_ms INTEGER NOT NULL,
  timestamp_end_ms INTEGER NOT NULL,
  object_descriptor TEXT,
  region_reference TEXT,
  canonical_product_id TEXT NOT NULL,
  creator_or_publisher TEXT NOT NULL,
  verification_source TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Storage may be D1, Postgres, or another approved low-cost store, but application code should keep the contract provider-neutral.

Recommended indexes when implemented:
- `user_feedback(event_id, result_id)`
- `verified_product_assertion(content_id, timestamp_start_ms, timestamp_end_ms)`
- `verified_product_assertion(canonical_product_id)`

## Ranking guardrail

Issue #20 does not change matching or ranking.

Before verified assertions influence `EXACT` / `LIKELY` classification:
1. define provenance strength,
2. add benchmark cases with correct and incorrect assertions,
3. verify that false EXACT remains zero,
4. document how contradictions between visual evidence and asserted metadata are handled.

Human feedback is evaluation/supervision data first. It must not silently change live ranking weights.

## Do not store by default

- full video,
- continuous viewing history,
- raw protected content,
- account credentials,
- merchant credentials in client code,
- unnecessary screenshots.

## Core metrics

### Utility
- useful-result rate
- exact/likely precision on benchmark
- no-result rate
- wrong-category rate
- user correction rate

### Experience
- end-to-end latency
- first-result latency
- overlay failure rate
- capture failure rate

### Commerce
- result CTR
- merchant outbound CTR
- conversion rate where observable
- revenue per intent event
- revenue per active user

### Economics
- inference cost per event
- retrieval cost per event
- infrastructure cost per event
- gross margin per attributed purchase

### Platform risk
- percent events by platform
- percent revenue by platform
- percent product results by merchant/provider
- percent inference calls by model provider

## Dependency concentration guardrail

Track concentration from day one.

If a single provider becomes >50% of a critical dependency, create a mitigation plan before scaling further.

This is a management guardrail, not a claim that 50% is universally optimal.

## Additional optimization metrics

Latency experiments should track:
- useful rate
- cost per useful result
- commerce calls per event
- verification calls per event
- provider calls per event
