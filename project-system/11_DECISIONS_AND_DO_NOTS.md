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

### D-007 — eBay may be an initial commerce adapter
Use documented APIs and current terms.

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

---

## Do not

- Do not build "works on every video" marketing.
- Do not bypass DRM.
- Do not scrape Amazon.
- Do not rely solely on Amazon, eBay, YouTube, Google, or one AI vendor.
- Do not auto-open merchants.
- Do not replace exact identification with a sponsored product.
- Do not hide sponsorship labels.
- Do not train a custom model before the commodity stack fails a benchmark.
- Do not pay for infrastructure before free/local tiers fail a measured need.
- Do not build accounts/auth before needed.
- Do not build creator dashboards before the consumer interaction works.
- Do not build an ad marketplace before useful intent volume exists.
- Do not build mobile before desktop interaction is validated.
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
- adding Amazon,
- adding native YouTube Shopping interaction,
- adding protected-media support,
- adding a new capture mechanism,
- storing third-party product images/data,
- using third-party data for training.

## External constraints verified 2026-09-11

Amazon Associates browser-extension restriction:
https://affiliate-program.amazon.com/help/operating/participation/

YouTube Shopping existing product-tag/affiliate model:
https://support.google.com/merchants/answer/14815513
https://support.google.com/youtube/answer/13376398

eBay Buy/Browse API:
https://developer.ebay.com/api-docs/buy/browse/overview.html

These references can change. Treat the date above as part of the decision record.
