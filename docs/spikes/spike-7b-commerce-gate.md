# Spike 7B — Commerce Eligibility Gate Before Retrieval

**Status:** Proposed  
**Date:** 2026-09-18  
**Author:** opencode (auto-generated from baseline analysis)  
**Depends on:** PR #52 (parallel verification batches), Brave retrieval overlap (rejected)  
**Tracking issue:** [#53](https://github.com/Fredilly/VCL/issues/53)

## Purpose

Determine whether Scoop can avoid expensive commerce retrieval and verification for objects that are unlikely to produce useful shopping results, without reducing useful product discovery.

## Hypothesis

A lightweight gate before commerce search can reduce:
- unnecessary provider calls
- verification calls
- latency
- cost

without reducing useful product discovery.

## Current Baseline

| Metric | Value |
|---|---|
| p50 latency | 49.3s |
| p95 latency | 70.7s |
| useful rate | 70% |
| Golden | PASS |
| false EXACT | 0 |
| unsupported LIKELY | 0 |
| mean cost/run | ~$0.049 |

## 1. Problem Statement

The Brave retrieval overlap experiment (rejected) revealed that provider latency is not the primary bottleneck. The bigger issue is **bad object understanding creating bad commerce searches**.

Observed patterns where commerce retrieval produces no useful results:

- **Graphic/logo/illustration frames** entering commerce search (e.g., YouTube channel logos, video overlays)
- **Packaging being treated as products** (e.g., shipping boxes, food containers)
- **Wrong category predictions** creating bad queries (e.g., "lamp" for a picture frame)
- **Unknown objects** consuming verification budget without useful matches

These objects consume:
- Provider API calls (eBay, Etsy, Brave, SerpApi)
- Verification budget (Gemini Vision calls)
- Latency budget (sequential verification batches)
- Dollar cost ($0.03–$0.08 per wasted verification cycle)

## 2. Proposed Gate Inputs

The gate should evaluate the object description before any commerce calls. Consider:

| Input | Source | Rationale |
|---|---|---|
| `category` | Vision model | Some categories are inherently non-commercial |
| `subcategory` | Vision model | Packaging vs. product distinction |
| `brand confidence` | Vision model | Low confidence → uncertain object identity |
| `model confidence` | Vision model | Low confidence → cannot match to products |
| `object confidence` | Vision model | Overall certainty the object is a real product |
| `query quality` | Heuristic/LLM | Would this query produce useful commerce results? |
| `commerce suitability` | Derived | Composite score of above inputs |

## 3. Three Outcomes

### ALLOW

Proceed to full commerce retrieval and verification.

Criteria (illustrative, not final):
- High object confidence (≥ 0.7)
- Recognizable brand or product category
- Category is commercially searchable

### RESTRICT

Search only high-confidence providers/categories. Skip speculative or broad searches.

Criteria (illustrative):
- Medium object confidence (0.4–0.7)
- Category known but brand uncertain
- Narrow search scope to reduce cost

### REJECT

Return truthful no-result before any commerce calls.

Criteria (illustrative):
- Low object confidence (< 0.4)
- Category is non-commercial (graphic, logo, packaging, illustration)
- No recognizable brand or product attributes

## 4. Trust Rules (Preserve)

The gate must not compromise Scoop's trust model:

- Do **not** force matches when the gate says REJECT
- Do **not** lower verification thresholds to compensate
- Do **not** create false EXACT or unsupported LIKELY results
- Do **not** hide uncertainty from the user
- Do **not** bypass the Golden regression gate

## 5. Metrics Required

Before vs. after comparison:

| Metric | Baseline | Target |
|---|---|---|
| useful rate | 70% | ≥ 70% |
| truthful no-result rate | ? | Track and report |
| false EXACT | 0 | 0 |
| unsupported LIKELY | 0 | 0 |
| latency p50 | 49.3s | Reduce |
| latency p95 | 70.7s | Reduce |
| commerce calls/event | ? | Reduce |
| verification calls/event | ? | Reduce |
| cost/useful | ~$0.049 | Reduce |

## 6. Golden Examples

### ALLOW (should proceed to commerce)

| Case | Object | Why |
|---|---|---|
| s5-01 | Patagonia jacket | Recognizable brand, clear product, high confidence |
| s5-02 | Seiko watch | Recognizable brand, clear product, high confidence |
| s5-03 | Adidas Samba | Recognizable brand, clear product, high confidence |
| s5-04 | Coach bag | Recognizable brand, clear product, high confidence |

### REJECT candidates (should not enter commerce)

| Pattern | Example | Why |
|---|---|---|
| Logo/illustration | YouTube channel icon | Non-commercial graphic |
| Packaging | Shipping box, food container | Not a product to purchase |
| Non-product frame | Video overlay, text graphic | No purchasable object |
| Ambiguous object | Unknown shape, unclear category | Cannot produce useful matches |

## 7. Implementation Candidates

**Do not choose yet.** Evaluate all approaches:

| Approach | Pros | Cons |
|---|---|---|
| Rules-based category gate | Simple, transparent, fast | Brittle, may miss edge cases |
| Confidence threshold gate | Uses existing vision output | Threshold tuning required |
| Query-quality classifier | Directly measures searchability | Requires labeled training data |
| Learned commerce suitability score | End-to-end optimization | Requires labeled data, model training |

## 8. Risks

| Risk | Mitigation |
|---|---|
| False negatives (rejecting valid products) | Track reject rate, allow user override in future |
| Rejecting niche collectibles | RESTRICT path instead of hard REJECT |
| Handmade/vintage edge cases | Category-aware gate, not just brand confidence |
| Reducing discovery | Monitor useful rate; gate must not reduce it |
| Gate latency overhead | Gate must be <100ms (pre-computed from vision output) |

## Next Steps

1. Create tracking issue
2. Instrument current pipeline to log gate-relevant fields (category, confidence, brand confidence)
3. Analyze existing Golden corpus to calibrate thresholds
4. Design gate experiment (A/B or before/after)
5. Implement gate behind feature flag
6. Run Golden regression
7. Run live benchmark (10 cases)
8. Compare metrics

## Related

- Issue #47: Latency reduction tracking
- PR #52: Parallel verification batches (merged)
- Brave retrieval overlap: Rejected (useful rate dropped 70% → 60%)
