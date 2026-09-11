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
2. query providers,
3. deduplicate,
4. rank relevance,
5. label confidence/class,
6. add commercial metadata only after relevance.

Initial candidates:
- eBay Browse/search APIs,
- compliant merchant/catalog feeds,
- additional affiliate/catalog providers whose terms allow extension-originated use.

Amazon:
- optional future adapter only after terms and required approval are satisfied.
- never a foundational dependency.

## Ranking pipeline

```text
selected image
  + click context
  + visual attributes
  + optional nearby frames
        ↓
canonical intent
        ↓
commerce adapters
        ↓
candidate normalization
        ↓
visual/text relevance
        ↓
availability / geography / price
        ↓
commercial ranking within relevance threshold
```

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
- cost estimate per request,
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
