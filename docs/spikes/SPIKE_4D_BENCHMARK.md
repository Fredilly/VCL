# Spike 4d verification evidence — 2026-09-13

Branch: `spike4d-candidate-verification`. Existing [PR #7](https://github.com/Fredilly/VCL/pull/7); do not merge automatically.

## Scope and implementation

The production resolver now calls the source/candidate Gemini image comparator. The extension forwards the selected crop through its Chromium callback messaging channel. Integrating current `main` preserved the eBay OAuth adapter while restoring this wiring; a production HTTP-route regression test now guards against disconnecting it again.

Retrieval remains candidate generation. Each provider retrieves up to 12 candidates per query. Query variants include identity without color and brand-free type/color retrieval. Query-copied category, brand and model are not candidate evidence. There are no brand-specific rules in the production path.

The verification gate independently combines source description, selected pixels, candidate pixels, actual title/metadata and corroborating context. High-confidence explicit category/subtype, gender designation, age group, dominant color, sleeve and brand contradictions reject. Unknown, unisex, multicolor, occluded and low-confidence attributes are uncertainty. Gender/age must describe the product, never an inference about its wearer.

An available comparison with confidence at least 0.65 must have visual similarity at least 0.6 to be useful. Without usable images, type alone is insufficient: brand or color must also agree. Credible metadata-only alternatives are capped at `SIMILAR` and explicitly marked `metadata_only` in the API. `LIKELY` requires strong visual agreement, identity support and model or multiple distinctive-detail corroboration. Basic attributes repeated as details do not create identity. This pipeline has no independently verified SKU proof and therefore never manufactures `EXACT`.

Verification relevance precedes display limiting, destination deduplication and any merchant economics. The current resolver does not implement paid/sponsored ordering. Rejection of a whole query continues broadening; zero credible survivors is valid. `identity_key` identifies a hypothesis, not an authoritative catalog/SKU record or complete merchant-offer aggregation.

## Automated benchmark

Commands run after each implementation iteration:

```sh
pnpm check
pnpm build
node --test apps/api/tests/*.test.mjs apps/extension/tests/*.test.mjs
cd apps/api && pnpm exec wrangler deploy
```

Latest implementation: **94 tests passed, zero failures**; typecheck and build passed.

The deterministic evidence benchmark contains **140 cases across 12 brands and apparel types**: Nike tee, Adidas hoodie, Uniqlo sweater, Patagonia jacket, Ralph Lauren polo, Levi's jeans, Zara dress, H&M cardigan, Arc'teryx coat, Lululemon leggings, Carhartt sweatshirt and COS shirt.

| Gate | Correct decisions | False accepts | False rejects |
| --- | ---: | ---: | ---: |
| Legacy title/attribute/brand gates | 70 / 140 | Not separately measured | Not separately measured |
| Multimodal-evidence gate | 140 / 140 | 0 | 0 |

These are **hand-labeled evidence fixtures**, not image-model predictions. They prove the gate handles supplied contradictions and uncertainty; they do not establish 100% Gemini accuracy. Additional tests cover actual HTTP-route wiring with mocked network responses, source correction of mistaken initial type, query broadening/provider failure, later-candidate reranking, no `EXACT`, secondary logo colors, cap sleeves, children versus adults, weak visual eligibility, thumbnail safety, malformed model output and Chromium callback response delivery.

## Live benchmark protocol

`apps/api/tests/fixtures/live-apparel.mjs` identifies five public catalog sources: Uniqlo tee, Adidas hoodie, Patagonia jacket, Levi's jeans and H&M dress. Images are downloaded transiently; no user crops or credentials are stored. Catalog-ground-truth descriptions intentionally isolate retrieval/verification from initial recognition.

Run sequentially against the existing deployed Worker:

```sh
node apps/api/scripts/live-verification-benchmark.mjs '' /tmp/spike4d-live.json
```

These are live model/retrieval probes, not a blinded accuracy study or a real-video user study. Local access to Google thumbnail hosts failed, so returned thumbnails were not independently visually audited from this machine. Model reasons/similarity and output labels must not be presented as human ground truth.

Final sequential run against `f10f0118-e3f1-4d2f-818b-c60abec8b8fb`:

| Source | Retrieved | Image-compared | Rejected | Returned | LIKELY predictions | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Uniqlo tee | 48 | 36 | 34 | 8 | 0 | 51.6 s |
| Adidas hoodie | 36 | 36 | 31 | 5 | 2 | 49.9 s |
| Patagonia jacket | 37 | 36 | 35 | 2 | 0 | 50.1 s |
| Levi's jeans | 12 | 12 | 4 | 8 | 3 | 19.6 s |
| H&M dress | 35 | 35 | 34 | 1 | 0 | 50.6 s |

Across the run: **155/168 image-compared**, 13 explicitly budget-limited, **zero image/model/schema failures other than the budget**, and zero `EXACT` outputs. Display limiting/deduplication means returned counts need not equal retrieved minus rejected. Of 24 returned products, 23 had multimodal comparisons and one was metadata-only.

The H&M result was a sleeveless wrap-detail dress labeled `SIMILAR`; cap-sleeved and weak visual alternatives were removed. Patagonia returned an R2 TechFace jacket as `SIMILAR` plus a metadata-only "Classic blue denim jacket" based on type/color. That second result illustrates the residual weakness of incomplete evidence: the system does not claim it is the original or visually verified. Plain Uniqlo tees stayed `SIMILAR`; Levi's 501-family predictions were `LIKELY`, while other cuts remained `SIMILAR`.

The earlier concurrent run hit model quotas; a later pre-budget sequential run repeatedly lost final comparisons to image/model fetch failures. The final run eliminated that unexplained failure pattern with explicit resource budgeting. Retrieval sets and model predictions vary between runs, so these are operational observations, not a controlled live accuracy delta.

## Spike decision

**Pass for the bounded Spike 4d engineering gate; proceed to manual video-crop, retrieval-coverage and latency evaluation.** The deterministic benchmark is materially better, the deployed production route actually performs multimodal verification, and explicit contradictions and uncertainty are handled independently of brand/provider rank. No new provider or paid infrastructure is justified by these results.

This is not a production-quality or cross-catalog accuracy certification. In particular, it does not prove retrieval coverage is the only remaining bottleneck, and it does not substitute for independently labeled video-crop evaluation. Keep PR #7 open for review; do not merge automatically.

## Resource limits and degraded behavior

Concurrent benchmark requests triggered Gemini HTTP 429 responses. A sequential run subsequently showed a repeatable tail of image/model fetch failures. This pattern was consistent with the Worker's subrequest ceiling; without working tail access, the exact runtime exception was not independently captured.

The final implementation batches six candidate images per model call, processes one batch at a time and shares a 42-subrequest image/model budget across broadening, reserving eight for retrieval/OAuth. Redirect hops consume that budget too. The budget is conservative for the current two-provider path; future adapters must revisit the reservation. Budget-limited images are reported as `image_budget`, not falsely marked compared. Images are individually limited to 2 MB and public HTTPS URLs; the source and image data remain transient.

This follows the documented [Workers subrequest and simultaneous-connection limits](https://developers.cloudflare.com/workers/platform/limits/#subrequests). No plan upgrade, new provider, secret, environment variable or custom training was added for this work. The eBay OAuth environment interface was inherited from current `main`.

## Deployed iterations in this integration pass

| Worker version | Tests | Change |
| --- | ---: | --- |
| `c31c470e-ca97-4d11-a4bc-38f918fb00f7` | 91 | Restore production image wiring; preserve OAuth; improve conservative identity/detail classification. |
| `71dbb0b8-f773-4d88-9370-761ed97198bc` | 92 | Remove weak visual matches even with moderate comparison confidence; recognize cap sleeves. |
| `f10f0118-e3f1-4d2f-818b-c60abec8b8fb` | 94 | Shared image-request budget, six-candidate batches, and no type-only metadata fallback. |

The extension was rebuilt to `apps/extension/.output/chrome-mv3`. Browser reload and a real-video manual session are not claimed. Existing build warnings remain: missing extension version defaults to `0.0.0`; local macOS 12.6 is below Wrangler's recommended runtime version. Remote deployment succeeded.

## Remaining failure modes

- Model confidence is heuristic, not statistically calibrated. Ambiguous logos, shades, fit and construction details can still cause false `LIKELY`, false `SIMILAR` or false rejections. Low-confidence contradictory attributes intentionally do not become hard exclusions.
- Catalog retrieval may omit the original model/variant. Similar alternatives do not prove original identity; these runs alone do not prove retrieval is the only remaining bottleneck.
- Missing thumbnails, the per-request image budget and model quotas reduce image coverage. Credible unverified alternatives remain visibly distinct in API metadata, but the current UI only shows the result class, not full verification diagnostics.
- One selected crop cannot resolve hidden labels, back details or occluded sleeves. No multi-frame evidence or custom training was added.
- Latency remains much higher than the later interaction target. No throughput, P95 or cost-per-useful-result claim is supported by five catalog probes.
- Merchant destinations from shopping retrieval can be Google Shopping landing pages rather than direct merchant offers. Canonical product/offer aggregation remains limited.
