# 03 — Architecture and Stack

## Design goal

Cheap, modular, provider-agnostic, replaceable.

## Client

### Browser extension
- Chromium / Chrome Manifest V3
- TypeScript
- React only where it improves overlay complexity; otherwise keep client minimal
- Vite or equivalent lightweight build tooling
- content script + service worker
- no unnecessary framework inside page context

### Responsibilities
- detect supported media surface,
- get user intent,
- capture or request frame through permitted path,
- collect click coordinates,
- render overlay,
- send minimal request to backend,
- display result classes and merchant destinations.

## Backend

Preferred initial path:
- Cloudflare Workers or equivalent low-cost edge/serverless runtime
- TypeScript
- stateless request handling where possible

Alternative:
- existing Vercel/Next.js infrastructure if it materially reduces setup work.

Do not create infrastructure duplication merely for architectural purity.

## Database

Use an existing low-cost Postgres database where available.

Suggested:
- Neon Postgres

MVP tables should be small and event-oriented.

Do not store raw video.

Avoid storing raw frame images unless required for debugging and explicitly enabled.

## Object extraction

Phase 1:
- selected-region crop.

Phase 2:
- open segmentation model if crop quality proves insufficient.

Roboflow:
- not required in MVP,
- evaluate later for annotation/training/deployment if custom detection becomes a measured need.

## Vision provider

Use an adapter:

```ts
interface VisionProvider {
  analyzeSelection(input: SelectionInput): Promise<ObjectDescription>
}
```

Initial implementation may use one strong multimodal provider.

A second provider is not required before Spike 3 passes, but the interface must permit replacement.

Never let provider-specific response shapes leak throughout the product.

## Commerce resolver

Core interface:

```ts
interface CommerceProvider {
  search(query: ProductQuery): Promise<ProductCandidate[]>
}
```

Resolver responsibilities:
1. normalize product intent,
2. route by category/provider capability,
3. query providers broadly enough to preserve recall,
4. invoke fallback providers only when needed,
5. deduplicate,
6. normalize candidate evidence and provenance,
7. pass candidates through verification,
8. resolve a canonical product hypothesis where evidence permits,
9. label confidence/class,
10. add merchant/commercial metadata only after relevance and identity verification.

### Provider routing

Use category-aware routing so provider quotas are not wasted.

Initial routing intent:

```text
fashion / shoes / watches / bags / jewelry
    eBay + Etsy
        ↓
    SerpAPI
        ↓
    Brave Search

electronics / appliances / consumer tech
    Best Buy + eBay
        ↓
    SerpAPI
        ↓
    Brave Search

unknown category
    eBay
        ↓
    SerpAPI
        ↓
    Brave Search
```

Rules:
- primary providers may run in parallel where useful,
- fallback providers should not run when primary results are already sufficient,
- one provider failure must not fail the resolver,
- all provider output normalizes into `ProductCandidate`,
- provider provenance must remain observable internally,
- quota-limited general search providers are insurance, not the default path.

Initial candidates:
- eBay Browse/search APIs,
- Best Buy product/catalog API for relevant electronics/appliance categories,
- Etsy API for relevant fashion/accessory/vintage categories,
- SerpAPI as a quota-protected fallback,
- Brave Search as a final open-web fallback,
- additional compliant merchant/catalog feeds whose terms allow extension-originated use.

Amazon:
- optional future adapter only after terms and required approval are satisfied.
- never a foundational dependency.

## Product-resolution and ranking pipeline

```text
selected image
  + click context
  + visual attributes
  + optional nearby frames
        ↓
canonical intent
        ↓
category-aware commerce routing
        ↓
broad candidate retrieval
        ↓
candidate normalization
        ↓
candidate-image + metadata verification
        ↓
hard contradiction filtering
        ↓
multimodal relevance reranking
        ↓
canonical product resolution
        ↓
EXACT / LIKELY / SIMILAR
        ↓
merchant offers / availability / geography / price
        ↓
commercial ranking within relevance threshold
```

Candidate verification is a distinct layer between retrieval and ranking.

Rules:
- retrieval rank is never identity confidence,
- candidate images are first-class evidence when available,
- explicit high-confidence contradictions are rejected before scoring,
- unknown or missing attributes do not count as contradictions,
- product identity is resolved before merchant economics are considered,
- zero credible candidates is a valid outcome.

## Cache

Cache only where provider terms permit.

Cache:
- normalized descriptions,
- non-restricted derived embeddings/attributes,
- internal ranking outputs.

Do not cache third-party content when terms forbid it.

## Observability

MVP:
- structured logs,
- request IDs,
- latency per stage,
- provider error rate,
- provider request/success/no-result/timeout counts,
- candidate count and accepted count per provider,
- fallback invocation rate,
- cost/quota estimate per request,
- no sensitive frame logging by default.

## Deployment

Keep two deployables initially:
1. extension,
2. backend.

Do not add microservices.

## Repository structure

```text
/
  apps/
    extension/
    api/
  packages/
    core/
    vision/
    commerce/
    ranking/
    telemetry/
  project-system/
    *.md
  tests/
    fixtures/
    benchmark/
```

## Core abstractions

Keep these provider-neutral:
- `VisualSurface`
- `FrameSource`
- `Selection`
- `ObjectDescription`
- `ProductIntent`
- `ProductCandidate`
- `MerchantOffer`
- `RankedResult`
- `CommercialEvent`
