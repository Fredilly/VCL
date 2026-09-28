# v0.2 — Modular Perception and Identity

Status: implementation plan / benchmark-gated.

## Version decision

The existing closed-alpha stack is the **v0.1 baseline**. The repository previously had no explicit application SemVer in the root package.

v0.2 is not a rewrite. It is an architectural hardening pass that makes solved perception/tracking components replaceable while preserving Scoop's verification, canonical identity, trust, and commerce layers.

## Objective

Make Scoop a Voltron system:

```text
good frame access
  + good localization/tracking
  + good evidence extraction
  + cheap semantic reasoning
  + strong retrieval
  + strict verification
  + reusable canonical memory
  + replaceable commerce
  = Scoop
```

Each component does one job well. Any component may be replaced when a better method appears.

## v0.2 module boundaries

1. `FrameSource`
   - permitted video/frame capture only.

2. `SelectionLocalizer`
   - converts user click/point into an initial region/mask.

3. `ObjectTracker`
   - preserves the selected object's identity across nearby frames.
   - baseline: crop-only/current path.
   - experiment: SAM 2 point/mask propagation.

4. `EvidenceExtractor`
   - chooses useful observations from the track.
   - avoids sending redundant frames downstream.

5. `VisionProvider`
   - structured semantic understanding from commodity multimodal models.
   - Gemini Flash Lite remains a cheap default candidate.
   - model output is hypothesis/evidence, not identity truth.

6. `VisualEmbedder` / `VisualRetriever`
   - optional experimental visual retrieval path.
   - no paid vector database for v0.2.

7. `CandidateRetriever`
   - commerce/catalog/open-web candidate generation.

8. `CandidateVerifier`
   - candidate-image + metadata comparison.
   - contradiction filtering remains mandatory.

9. `IdentityResolver`
   - resolves canonical identity and emits EXACT / SIMILAR / RELATED.

10. `ProductMemory`
    - existing verified-product ledger + canonical product memory.
    - same-video and cross-video reuse.
    - graph lookup before expensive fresh work where safe.

11. `CommerceResolver`
    - merchant offers after identity/relevance.

12. `TelemetrySink`
    - module latency, cost, calls, decisions, and quality outcomes.

## SAM 2 decision

SAM 2 is suitable for a v0.2 experiment because:
- it accepts point/box/mask prompts,
- it can propagate an object mask through video,
- source/model checkpoints are Apache 2.0,
- it addresses localization/tracking rather than asking Gemini to repeatedly rediscover the object.

But:
- the reference implementation is PyTorch and GPU-oriented,
- free/open model weights do not make hosted inference free,
- Scoop's budget remains $0.

Therefore:
- SAM 2 is an optional adapter,
- no paid GPU service is authorized for this experiment,
- benchmark using free/local/available compute only,
- keep crop-only tracking as fallback,
- do not block alpha launch on SAM 2.

## v0.2 benchmark A — tracking/localization

Compare:

A. current crop/focus path

B. SAM 2-assisted object mask + nearby-frame propagation

Frozen inputs:
- same video,
- same timestamps,
- same click point,
- same downstream reasoning/retrieval/verifier.

Measure:
- selected-object containment,
- identity stability across nearby frames,
- useful-result rate,
- false EXACT,
- wrong-object rate,
- end-to-end p50/p95,
- additional compute cost,
- frames/model calls avoided or added.

Promotion gate:
- no false-EXACT regression,
- meaningful localization/identity improvement,
- acceptable latency,
- $0 recurring infrastructure requirement for alpha.

## v0.2 benchmark B — evidence selection

Once a reliable object track exists:

Compare:
- analyze fixed nearby frames,
- analyze only high-value track observations.

Evidence-frame scorer should prefer:
- visible full object,
- sharpness,
- low occlusion,
- visible logo/text,
- distinctive hardware/detail,
- materially different view/angle.

Goal:
reduce redundant multimodal calls while increasing identity evidence.

## v0.2 benchmark C — visual retrieval

Add a provider-neutral visual embedding experiment.

Compare:
- text/OCR/semantic retrieval only,
- visual embedding retrieval only,
- fused visual + text/OCR + semantic retrieval.

Do not replace the verifier. Retrieval only proposes candidates.

Start without paid infrastructure:
- frozen benchmark gallery,
- local/in-memory nearest-neighbor index,
- open model with acceptable license.

## Existing graph/memory

Already implemented:
- FeedbackLedger Durable Object,
- VerifiedProductLedger Durable Object,
- canonical-product memory,
- same-video verified reuse,
- cross-video verified reuse,
- correction-derived mapping signals,
- Worker observability/alpha telemetry.

Not yet implemented as a complete persistent graph:
- generalized ContentProductGraph for arbitrary partner/video ingestion,
- broad automatic appearance-window mapping,
- large-scale visual vector index,
- automatic YouTube-wide crawling.

v0.2 extends the existing memory path. It does not introduce a parallel graph database.

## Result semantics

### EXACT
Evidence strongly supports the same canonical product.

### SIMILAR
Not the same asserted product, but a close substitute with meaningful visual/product similarity.

### RELATED
Useful to the same intent/category but not close enough to call similar.

### SPONSORED
Commercial metadata only. Never an identity class.

## Cross-video persistence

Do not solve cross-video identity by asking Gemini whether two images appear to be the same.

Use:
- canonical product key,
- model/SKU identifiers where available,
- distinctive text/logo evidence,
- normalized attributes,
- candidate image verification,
- historical verified mappings,
- future visual embeddings where benchmarked.

The canonical product is the persistent identity anchor. Video appearances become evidence-bearing mappings to that identity.

## Zero-budget rule

v0.2 may use:
- open-source models,
- existing provider free tiers,
- existing Cloudflare free-tier capabilities,
- local/free benchmark compute.

v0.2 may not introduce:
- paid GPU hosting,
- paid vector database,
- paid tracking API,
- new recurring infrastructure solely to support SAM 2.

## Implementation order

1. land documentation/result-class alignment,
2. extract module contracts around current behavior without changing output,
3. preserve crop-only baseline,
4. add SAM 2 adapter behind a flag,
5. run benchmark A,
6. keep/reject SAM 2 based on evidence,
7. add evidence-frame selection,
8. benchmark visual retrieval,
9. extend existing canonical memory/reuse only when benchmark evidence supports it.

## Non-goals

- no full rewrite,
- no custom training,
- no broad YouTube crawl,
- no new microservices,
- no mandatory GPU,
- no weakening of contradiction filtering,
- no graph hit that bypasses trust gates,
- no optimization specifically for one demo video.
