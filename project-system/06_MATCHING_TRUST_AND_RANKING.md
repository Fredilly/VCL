# 06 — Matching, Trust, and Ranking

## Problem

Object recognition is not product identity.

The system must distinguish:
- "black leather loafer"
from
- "Gucci Jordaan leather loafer, exact SKU."

## Evidence hierarchy

Use all available evidence:

1. selected object pixels,
2. neighboring frame(s) where permitted,
3. logos/marks,
4. colors/material/style,
5. visual embeddings,
6. textual model description,
7. video title/description/context,
8. merchant catalog similarity,
9. verified creator/publisher metadata,
10. historical interaction/conversion signals.

Verified first-party metadata may increase identity confidence but must be labeled by provenance.

## Result classes

### EXACT
Use only when evidence is strong enough to support exact identity.

### LIKELY
Best candidate, meaningful uncertainty remains.

### SIMILAR
Not represented as the original item.

### SPONSORED
A commercially promoted candidate.

`SPONSORED` is orthogonal to relevance class. A sponsored item can be similar, but it cannot become exact by payment.

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

This is a potential differentiator over screenshot-only visual search.

## Ranking factors

Pre-commercial:
- exact/visual similarity,
- textual attribute similarity,
- brand/model evidence,
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

## Correction loop

Allow user feedback:
- wrong item,
- wrong category,
- not similar,
- correct match.

Corrections become valuable proprietary supervision data.

Do not train on user feedback without a documented privacy/consent policy.
