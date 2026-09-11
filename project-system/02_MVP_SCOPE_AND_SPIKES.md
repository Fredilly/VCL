# 02 — MVP Scope and Spikes

## Rule

Do not build the full product first.

Each spike answers one irreversible or high-risk question.

---

## Spike 0 — Extension shell

### Question
Can we create a Chromium extension that activates only on user request and renders a clean overlay above supported video?

### Build
- Manifest V3 extension
- content script
- action/shortcut
- overlay layer
- close/reset behavior

### Pass
Overlay opens and closes reliably without breaking playback.

---

## Spike 1 — Frame acquisition

### Question
Can we obtain a useful frame from supported non-protected video through permitted browser mechanisms?

### Test surfaces
1. YouTube
2. ordinary HTML5 MP4 page
3. another major non-DRM video page

### Paths
Preferred:
- video/canvas frame capture where browser rules permit.

Fallback:
- explicit user-authorized tab/screen capture where appropriate and permitted.

### Pass
Useful image is captured on at least YouTube + generic HTML5 video.

### Fail behavior
If protected/blocked:
- show `Capture not supported on this video`.
- do not bypass protections.

---

## Spike 2 — Point-to-object extraction

### Question
Given a frame and click coordinates, can we isolate enough of the object for recognition?

### MVP strategy
Start with:
- click coordinates,
- bounded crop,
- optional lightweight segmentation.

Do not begin with full-frame automatic detection.

### Pass
Selected item is sufficiently isolated for useful recognition in a small benchmark.

---

## Spike 3 — Object understanding

### Question
Can a commodity multimodal/vision model turn the selected object into useful structured attributes?

### Required output
```json
{
  "category": "",
  "subcategory": "",
  "brand_candidate": null,
  "model_candidate": null,
  "color": "",
  "material": "",
  "style_attributes": [],
  "search_terms": [],
  "confidence": 0
}
```

### Pass
Human evaluator says the description is commercially searchable for >= 80% of the initial test set.

Do not equate description accuracy with exact SKU accuracy.

---

## Spike 4 — Product resolution

### Question
Can the system return products someone would actually consider buying, while creating a credible path toward identifying the same product seen in the video?

### First adapters
- eBay Browse/search capabilities
- at least one additional merchant/catalog/search source if available under acceptable terms

### Important
Do not make Amazon the sole or initial hard dependency.

### Pass
For a curated test set, at least one returned result is judged commercially useful in >= 70% of cases.

### Spike 4b — Resolver reliability

Goal:
make product resolution fast, resilient, and provider-independent.

Required:
- hard provider timeouts,
- distinguish `NO_RESULTS` from provider failure,
- broaden queries progressively when a narrow query returns nothing,
- cache successful normalized queries where provider terms permit,
- support provider fallback / parallel resolution,
- never expose raw provider errors to users.

Measure:
- P50 product-resolution latency,
- P95 product-resolution latency,
- graceful-response rate,
- provider failure rate,
- useful-result rate.

Target before moving on:
- P50 <= 3 seconds where practical,
- P95 <= 6 seconds where practical,
- >99% of requests end in products or a truthful graceful state.

Do not chase 99.9% uptime from one provider. Reliability must come from the resolver architecture.

### Spike 4c — Identity evidence

Goal:
collect evidence that can distinguish the same product from a merely similar product.

Capture when visible/permitted:
- logos,
- text/markings,
- distinctive design details,
- likely brand,
- likely model/product family,
- colorway,
- material,
- hardware/fasteners,
- shape/silhouette,
- video title/description/context.

The vision model may propose identity hypotheses, but a model guess is not proof of identity.

### Spike 4d — Candidate verification

Goal:
verify retrieved product candidates against visual and contextual evidence.

Process:
1. retrieve candidates,
2. compare candidate details/images against the selected object,
3. score evidence agreement,
4. classify conservatively.

Do not mark a candidate `EXACT` because:
- a model guessed the brand/model,
- a text query matched,
- a shopping provider ranked it first.

### Spike 4e — Multi-frame evidence

Goal:
use nearby frames when one frame does not contain enough evidence.

Use only when:
- analysis is user initiated,
- capture is permitted,
- additional frames materially improve identification.

Examples:
- current frame shows shape,
- next frame reveals a logo,
- previous frame reveals a clasp, sole, watch face, bag hardware, or full silhouette.

### Spike 4f — Exact-match benchmark

Create a benchmark containing known products where ground truth is available.

Measure separately:
- exact precision,
- likely precision,
- useful-result rate,
- false-exact rate,
- no-result rate,
- latency.

Exact-match ambition:
increase the share of correctly identified original products over time without increasing false-exact claims.

A correct `LIKELY` or `SIMILAR` label is better than a false `EXACT`.

---

## Spike 5 — End-to-end magic

### Question
Does the full interaction feel useful?

### Flow
`invoke -> click -> result`

Pausing is not a product requirement. Analysis remains user initiated.

### Target
P50 response time: <= 3 seconds where practical.
P95 is measured, not guessed.

### Pass
At least 8/10 internal test sessions produce a result worth clicking or a truthful "not confident" state.

---

## Spike 6 — Platform robustness

### Question
How brittle is YouTube support?

Test:
- normal video,
- theater mode,
- fullscreen,
- ads,
- Shorts where feasible,
- player resize,
- SPA navigation,
- DOM changes.

### Pass
Document supported/unsupported states and create a platform adapter boundary.

---

## Spike 7 — Cost measurement

### Question
What does one completed intent event cost?

Measure:
- frame-processing cost,
- model cost,
- product retrieval cost,
- server cost,
- storage cost.

### Gate
No paid infrastructure upgrade until measured free-tier limits or quality requirements justify it.

---

## Stop conditions

Pause the project if:
- product results are repeatedly useless even when object descriptions are good,
- platform capture is too brittle for the initial surface,
- cost per useful result is incompatible with plausible commerce revenue,
- provider terms prohibit the required flow with no acceptable alternative,
- users do not perceive the interaction as meaningfully better than screenshot + Lens/search.
