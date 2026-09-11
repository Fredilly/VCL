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

### commercial_event
- event_id
- result_id
- event_type
- merchant
- attribution_token
- created_at

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
