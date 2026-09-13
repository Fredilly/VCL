# PR #7 integration verification — 2026-09-13

## Integration strategy and scope

Merged current main (`cd79956`, including PRs #11 and #12) into the existing PR #7 branch at `33f39e1`, producing merge commit `aa02c72`. No historical rebase or force push; main itself was not merged or changed. The PR remains open.

The only merge conflict was `src/server.ts`. The resolution retains main's full `Env`, `resolveEbayCredentials`, and provider construction/routing, and retains PR #7's source-image route and complete `resolveProducts` verification flow. `commerce.ts`, `tests/commerce.test.mjs`, and `tests/gemini-vision.test.mjs` did not conflict in this final-state merge; their PR #7 behavior was reviewed and retained. Main's credential module, OAuth implementation, credential tests, provider provenance tests, and Etsy guardrails remain intact.

New integration work changes `src/server.ts`, adds `tests/ebay-verification-integration.test.mjs`, and updates `wrangler.jsonc`. The config preserves dashboard variables through `keep_vars` and enables Worker logs/traces (1% trace sampling). This follows the [Wrangler variable-preservation guidance](https://developers.cloudflare.com/workers/wrangler/configuration/) and [Workers tracing guidance](https://developers.cloudflare.com/workers/observability/traces/).

The full PR diff additionally restores the existing Spike 4d changes to candidate verification/evidence/images, query broadening, provider candidate normalization, vision prompts, extension crop forwarding, tests, and project documentation. OAuth endpoints, client credentials, marketplace headers, keyword/image fallback, provider selection/order and provenance remain intact. PR #7's retrieval of 12 candidates per provider and independent metadata replace the old eight-candidate/query-copied metadata behavior so verification happens before the final eight-offer limit.

No verification thresholds, timeout values, concurrency, request budgets, or early-exit policy were changed from PR #7. The existing legacy verification helpers are still available but are not the production resolver's eligibility gate.

## Automated validation

- `pnpm check`: passed (API and extension).
- `pnpm build`: passed (API and Chrome extension).
- `node --test apps/api/tests/*.test.mjs apps/extension/tests/*.test.mjs`: 138 passed, 0 failed, 0 skipped; 134 API + 4 extension.
- Deterministic evidence benchmark: 140/140, versus 70/140 with legacy gates. This is fixture correctness, not measured model accuracy.
- Wrangler deployment dry run: passed.

Twelve new HTTP integration tests exercise both credential pairs through OAuth and Browse, crop forwarding to Gemini, provider/provenance retention, brand/gender/color/sleeve/age-group/subtype/category rejection, broadening to zero survivors, metadata-only SIMILAR, provider failure versus rejection, and fail-closed Production credential selection. These tests also check that credentials are absent from responses/logs and candidate-image request headers. Existing tests cover ranking before final truncation, identity uncertainty, no manufactured EXACT, provider provenance, image fallback and image request limits.

## Deployment and live evidence

Worker: `vcl-api` at `https://api.vcl.article6.org`.

Deployed code: `aa02c72`.

Worker version: `aed7497f-3f82-4575-88f7-4a423c6d8766`.

Inspected deployed version bindings before and after deployment. `EBAY_ENVIRONMENT=production`, both Sandbox and Production credential pairs, Gemini and SerpAPI bindings were preserved. No secret values were retrieved or changed.

The existing catalog benchmark script exercised the deployed HTTP route with real source images and live providers:

| Probe | Retrieved / compared | Rejected | Returned | eBay survivors | Worker latency |
| --- | --- | --- | --- | --- | --- |
| Levi's jeans | 24 / 24 | 8 | 8, all multimodal | 2 | 56.094 s |
| H&M dress | 46 / 35 | 39 | 7: 2 multimodal, 5 metadata-only | 7 | 53.809 s |

The jeans probe rejected three gender contradictions, one dominant-color contradiction and four cases of insufficient visual agreement. Both eBay survivors retained `provider: ebay` and `provenance: ebay:browse`; their IDs were `v1|128060730283|429472674087` and `v1|376915410869|645447546839`. All eight survivors retained their provider/provenance, and none were EXACT. Image/model failures: zero. Real eBay results under the verified Production bindings confirm Production OAuth and keyword Browse work through the integrated resolver.

The dress probe broadened through all three queries and rejected 17 sleeve contradictions, five color contradictions, three subtype contradictions, ten insufficient visual matches and four cases lacking positive relevance. Eleven comparisons were unavailable due to the unchanged image-request budget; there were no other image/model failures. All seven survivors were SIMILAR and retained eBay provenance. Across both probes, 59/70 candidates were compared and all 15 survivors retained provenance; none were EXACT.

## Remaining limits

No regression was found in the automated suite. Live catalog probes are bounded evidence of provider and verifier operation, not exhaustive matching-quality certification. Model confidence remains heuristic; missing/budget-limited image comparisons may retain metadata-only SIMILAR alternatives. Latency is still substantial and was deliberately not optimized. The built extension must be reloaded to forward source crops; manual video-crop/browser validation is not claimed. Direct live eBay `search_by_image` is not exercised by `/resolve-products`, whose existing provider routing remains keyword Browse.

Observed remaining quality gap: the dress probe's five metadata-only survivors included `Dior Black Faux Leather Midi Dress S Sleeveless Square Neck Pleated Zip` for an H&M source. The unchanged verifier does not extract arbitrary competing brands from title text without structured brand or image evidence. Thus the high-confidence brand contradiction gate passes its tests but does not catch every competing-brand title when the image budget is exhausted. This integration does not claim that fallback matching quality is fully solved, and does not add a brand dictionary or relax thresholds to address it.
