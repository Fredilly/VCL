# 06 — Matching, Trust, and Ranking

## Problem

Object recognition is not product identity.

The system must distinguish:
- "black leather loafer"
from
- "Gucci Jordaan leather loafer, exact SKU."

The commercial end goal is to identify the same product seen in the video where evidence permits, because users may specifically want what they saw on screen.

## Evidence hierarchy

Use all available evidence:

1. selected object pixels,
2. neighboring frame(s) where permitted,
3. logos/marks/text,
4. distinctive product details,
5. colors/material/style,
6. visual embeddings,
7. textual model description,
8. video title/description/context,
9. merchant catalog similarity,
10. verified creator/publisher metadata,
11. historical interaction/conversion signals.

Verified first-party metadata may increase identity confidence but must be labeled by provenance.

## Identity evidence rule

Exact identity must be earned by evidence.

A candidate should not become `EXACT` merely because:
- the vision model guessed a brand or model,
- the title contains matching keywords,
- a shopping/search provider ranked it first,
- it is visually similar,
- it has better commercial terms.

Prefer multiple independent signals that agree, such as:
- visible logo or marking,
- distinctive construction/design detail,
- matching model family,
- matching colorway/material,
- candidate-image agreement,
- contextual evidence from the video,
- verified first-party metadata.

Where evidence is incomplete, use `LIKELY` or `SIMILAR`.

## Result classes

### EXACT
Use only when evidence strongly supports the same product identity.

`EXACT` should be optimized for precision, not coverage.

False-exact claims are a critical trust failure.

### LIKELY
Best candidate, meaningful uncertainty remains.

### SIMILAR
Not represented as the original item.

### SPONSORED
A commercially promoted candidate.

`SPONSORED` is orthogonal to relevance class. A sponsored item can be similar, but it cannot become exact by payment.

## Candidate verification

Product retrieval is only candidate generation.

Target pipeline:

`visual evidence -> candidate retrieval -> candidate-image verification -> contradiction filtering -> multimodal reranking -> canonical product -> merchant offers`

Normalize both source and candidate evidence into comparable fields where available:
- gender,
- category,
- subcategory,
- dominant color family,
- sleeve length,
- neckline,
- material,
- brand,
- model/product family,
- visible text/markings,
- distinctive construction/details,
- silhouette/shape.

Candidate evidence can come from:
- title,
- structured provider metadata,
- merchant/catalog fields,
- candidate image/thumbnail,
- trusted contextual metadata.

### Contradiction rule

Unknown is not contradiction.

If a candidate does not state or visibly reveal an attribute, keep it eligible and reduce confidence if appropriate.

Explicit high-confidence contradiction is rejection evidence.

Examples:
- source is clearly mens, candidate is explicitly womens,
- source is clearly long sleeve, candidate is clearly short sleeve or sleeveless,
- source is black, candidate is clearly white/red under reliable color evidence,
- source is a coat, candidate is clearly a dress/T-shirt,
- source brand is strongly evidenced as BOSS, candidate is explicitly another brand.

Do not create product- or brand-specific exceptions to make a benchmark case pass.

### Verification order

After retrieval:
1. normalize candidate evidence and provenance,
2. compare metadata and candidate images against the selected object,
3. reject explicit high-confidence contradictions,
4. score visual/text/context agreement for survivors,
5. rerank using multimodal evidence,
6. resolve the best canonical product hypothesis where evidence permits,
7. assign `EXACT`, `LIKELY`, or `SIMILAR`,
8. only then apply merchant/commercial ranking.

Search rank is not identity confidence.

A zero-result outcome is correct when no candidate survives the relevance/trust gate.

## Relevance firewall

Pipeline:

```text
identity/relevance scoring
        ↓
minimum relevance gate
        ↓
commercial eligibility
        ↓
commercial ranking
```

Never:

```text
merchant payment
        ↓
identity
```

## Multi-frame advantage

For video, use nearby frames only when:
- user has invoked the analysis,
- capture is permitted,
- it materially improves identification.

Example:
- current frame shows shape,
- next frame reveals logo,
- previous frame reveals full silhouette.

Useful identity details may include:
- logo,
- watch face,
- shoe sole,
- bag clasp/hardware,
- garment label,
- jewelry shape,
- distinctive stitching or trim.

This is a potential differentiator over screenshot-only visual search.

## Resolver reliability

Commerce/provider failure must not be confused with identity failure.

The resolver should:
- time out slow providers,
- distinguish no-results from provider errors,
- broaden queries when appropriate,
- use alternate providers when available,
- cache allowed normalized results,
- return a truthful degraded state rather than raw provider errors.

The user experience should remain useful even when one provider fails.

## Ranking factors

Pre-commercial:
- exact/visual similarity,
- textual attribute similarity,
- brand/model evidence,
- distinctive-detail agreement,
- multi-frame evidence,
- contextual evidence,
- catalog confidence.

Post-relevance:
- current availability,
- geography/shipping,
- price,
- merchant quality,
- expected conversion,
- commercial terms.

Do not let commercial terms override relevance threshold.

## User-facing explanation

Every result card should be able to answer:
- Why am I seeing this?
- Is this claimed to be the original?
- Is it sponsored?
- Where will I go if I click?

For `EXACT` and `LIKELY`, the system should eventually be able to expose a concise reason such as:
- visible logo + matching model geometry,
- matching distinctive hardware + catalog image,
- creator metadata + visual agreement.

## Correction loop

Allow user feedback:
- wrong item,
- wrong category,
- not similar,
- correct match.

Corrections become valuable proprietary supervision data.

Do not train on user feedback without a documented privacy/consent policy.


## Commerce eligibility gate principle

Before product retrieval, Scoop should consider whether an identified object is likely to represent a purchasable item. Preserve truthful no-result behavior.
