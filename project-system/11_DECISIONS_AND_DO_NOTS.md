# 11 — Decisions and Do Nots

## Standing decisions

### D-001 — Browser first
Start with Chromium extension.

Reason:
fastest path to proving the interaction.

### D-002 — YouTube first, not YouTube only
YouTube is the initial test surface.

Reason:
large non-protected test surface and strong visual product content.

Guardrail:
all YouTube-specific behavior lives in an adapter.

### D-003 — User-triggered analysis
No continuous video scanning.

Reason:
cost, privacy, permissions, trust.

### D-004 — No custom training initially
Use crop/segmentation + commodity multimodal vision first.

Reason:
custom datasets/models are premature until measured failure.

### D-005 — Roboflow is optional
Do not purchase Roboflow for MVP.

Reconsider only if:
- annotation,
- custom detection,
- specialized segmentation,
- deployment tooling

becomes a measured bottleneck.

### D-006 — Amazon is not an MVP dependency
Amazon Associates currently restricts Special Links/Program Content in browser extensions without separate written approval.

Reason:
avoid building on a commercial path that may violate program rules.

### D-007 — eBay is the first broad commerce adapter
Use documented APIs and current terms.

Current state:
- adapter implemented,
- OAuth implemented,
- keyword and image-search paths implemented,
- production eBay access/result provenance must be verified before treating it as the primary live provider.

Guardrail:
do not make it exclusive.

### D-008 — DRM is unsupported, not an engineering challenge to defeat
Protected media is out of scope unless an authorized path exists.

### D-009 — Identification cannot be purchased
Money never changes an object's asserted identity.

### D-010 — The moat is the graph
Treat the extension as distribution.

Build reusable:
- visual intent,
- product resolution,
- corrections,
- commerce outcomes,
- merchant/catalog mappings.

### D-011 — Commerce routing is category-aware
Do not invoke every commerce provider for every visual intent.

Reason:
preserve quotas, reduce latency and use each provider where its catalog is strongest.

Initial routing:
- fashion/shoes/watches/bags/jewelry: eBay + Etsy, then SerpAPI, then Brave,
- electronics/appliances/consumer tech: Best Buy + eBay, then SerpAPI, then Brave,
- unknown category: eBay, then SerpAPI, then Brave.

### D-012 — SerpAPI becomes fallback capacity
SerpAPI should not remain the default provider once catalog adapters are live.

Reason:
its quota is scarce relative to catalog APIs and is more valuable as broad fallback discovery.

### D-013 — Brave Search is last-resort discovery
Brave Search is not a product catalog and must not be treated as one.

Use:
open-web product/merchant discovery only when catalog providers are insufficient.

### D-014 — Best Buy is a category adapter
Add Best Buy for electronics/appliances/consumer technology after eBay production verification.

Guardrail:
do not call it for irrelevant categories and re-check current terms/quota before shipping.

### D-015 — Etsy is an optional category adapter
Add Etsy for relevant fashion/accessory/jewelry/vintage/handmade coverage.

Guardrail:
do not let Etsy approval or access friction block the MVP.

### D-016 — Provider quotas are protected by routing
Fallback providers should only run when upstream results are insufficient.

Track:
- request count,
- success,
- no-result,
- timeout/failure,
- latency,
- candidate count,
- accepted count,
- fallback invocation.

Do not hard-code planning assumptions about quotas without re-checking current provider documentation.

### D-017 — Apple on-device AI is a future execution target, not a dependency
After desktop validation, evaluate Apple on-device segmentation, OCR, and local visual reasoning as an optional preprocessing layer.

Reason:
it may reduce cloud inference cost, upload volume, latency, and privacy exposure while improving object isolation.

Guardrails:
- do not interrupt Spike 4e/4f or the desktop MVP,
- keep Apple-specific APIs behind Scoop-owned interfaces,
- maintain a non-Apple path,
- do not treat local-model confidence as exact product identity,
- do not assume arbitrary screen/Siri context or protected-video access,
- verify current Apple APIs and platform rules before implementation.

Detailed future plan:
`13_APPLE_ON_DEVICE_AI_FUTURE.md`.

## Commerce redundancy implementation queue

Implement as six bounded PRs:

1. **eBay production verification**
   - production credentials/access,
   - `EBAY_SANDBOX=false`,
   - production OAuth,
   - real keyword search,
   - real image search,
   - live provenance check,
   - deploy and measure.

2. **Category-aware commerce router**
   - route by category/provider capability,
   - run relevant primaries,
   - invoke fallback only when needed,
   - preserve graceful failure states.

3. **Best Buy adapter**
   - normalize to `ProductCandidate`,
   - category gate,
   - timeout/no-result/error tests,
   - live test and deploy.

4. **Etsy adapter**
   - normalize to `ProductCandidate`,
   - category gate,
   - conservative identity handling,
   - live access/quota verification,
   - keep optional if access is burdensome.

5. **Brave Search fallback**
   - open-web fallback only,
   - quota budget,
   - convert discovered product pages into candidates,
   - normal verification pipeline still applies.

6. **Quota protection, telemetry and documentation**
   - provider metrics,
   - fallback invocation metrics,
   - quota-aware skipping where possible,
   - verify project-system docs against shipped behavior.

Each PR must pass:
- `pnpm check`,
- `pnpm build`,
- relevant tests,
- Worker deploy when backend behavior changes,
- live/manual verification before merge where credentials are required.

---

## Do not

- Do not build "works on every video" marketing.
- Do not bypass DRM.
- Do not scrape Amazon.
- Do not rely solely on Amazon, eBay, YouTube, Google, SerpAPI, one AI vendor, or Apple.
- Do not query every commerce provider on every request.
- Do not burn fallback quota when primary results are already sufficient.
- Do not treat search-engine rank as product identity evidence.
- Do not auto-open merchants.
- Do not replace exact identification with a sponsored product.
- Do not hide sponsorship labels.
- Do not train a custom model before the commodity stack fails a benchmark.
- Do not pay for infrastructure before free/local tiers fail a measured need.
- Do not build accounts/auth before needed.
- Do not build creator dashboards before the consumer interaction works.
- Do not build an ad marketplace before useful intent volume exists.
- Do not build mobile before desktop interaction is validated.
- Do not start Apple-specific implementation before the Apple future-track entry conditions are met.
- Do not assume Apple system context is exposed to third-party apps.
- Do not store raw video.
- Do not continuously collect frames.
- Do not add microservices.
- Do not over-engineer the database.
- Do not confuse "model described the object" with "we solved product matching."
- Do not optimize clicks by making misleading recommendations.
- Do not make legal/TOS assumptions from old blog posts. Re-check primary provider terms before shipping an integration.

## Re-validation triggers

Re-check provider/platform terms before:
- public launch,
- enabling affiliate monetization,
- adding a new commerce provider,
- changing a provider from fallback to primary,
- adding Amazon,
- adding native YouTube Shopping interaction,
- adding protected-media support,
- adding a new capture mechanism,
- storing third-party product images/data,
- using third-party data for training,
- adding an Apple native/Safari execution path,
- relying on Apple Vision, local foundation-model, App Intents, Siri, or system-context capabilities.

## External constraints verified 2026-09-11

Amazon Associates browser-extension restriction:
https://affiliate-program.amazon.com/help/operating/participation/

YouTube Shopping existing product-tag/affiliate model:
https://support.google.com/merchants/answer/14815513
https://support.google.com/youtube/answer/13376398

eBay Buy/Browse API:
https://developer.ebay.com/api-docs/buy/browse/overview.html

## Provider references to verify during implementation

Best Buy developer APIs:
https://developer.bestbuy.com/

Etsy developer APIs:
https://developers.etsy.com/

Brave Search API:
https://brave.com/search/api/

Apple developer capabilities:
https://developer.apple.com/

These references and provider quotas/capabilities can change. Treat the verification date as part of the decision record.
