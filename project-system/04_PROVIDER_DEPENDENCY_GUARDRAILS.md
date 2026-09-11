# 04 — Provider Dependency Guardrails

## Objective

No external company should be able to kill the product by changing one API, policy, price, or commercial relationship.

## Provider rule

Every external provider must be classified:

- `CRITICAL`: product fails without it.
- `REPLACEABLE`: adapter has alternatives.
- `OPTIONAL`: improves coverage or monetization.
- `PROHIBITED_FOR_CURRENT_USE`: current terms conflict with intended implementation.

Target architecture:
- zero third-party providers classified `CRITICAL` long-term,
- except the browser/platform runtime itself.

## Amazon

### Current guardrail

Do not use Amazon Associates Special Links or Program Content inside the browser extension unless Amazon grants separate written approval.

Amazon's current Associates Participation Requirements prohibit Special Links/Program Content in client-side browser plugins/extensions unless separately agreed.

Therefore:

- Amazon is not an MVP dependency.
- Do not design UX around Amazon.
- Do not assume joining Associates solves distribution.
- Do not scrape Amazon.
- Do not bypass affiliate restrictions.
- Do not represent Amazon products through restricted content in the extension.
- Re-evaluate only if an approved API/program and written permissions fit the exact client flow.

Strategic goal:
Amazon should eventually be one merchant destination, not the commerce layer.

Primary source checked 2026-09-11:
https://affiliate-program.amazon.com/help/operating/participation/

## eBay

Use only documented APIs and allowed terms.

The eBay Browse API is suitable for early product discovery and supports product/item search functionality, including image-oriented capabilities in its Buy API ecosystem.

Do not make eBay exclusive.

Primary source:
https://developer.ebay.com/api-docs/buy/browse/overview.html

## YouTube / Google

YouTube already has native Shopping features where eligible creators can tag products in videos, Shorts, and live streams.

Implication:
- YouTube is both an initial surface and a potential competitor/partner.
- Do not assume permanent tolerance of an independent commerce overlay.
- Do not interfere with YouTube controls, ads, checkout, or native shopping.
- Keep platform-specific code inside an adapter.
- Build value beyond the overlay: automatic long-tail identification, cross-platform graph, merchant neutrality, creator/publisher analytics.

Primary sources:
https://support.google.com/merchants/answer/14815513
https://support.google.com/youtube/answer/13376398

## Vision model providers

Rules:
- wrap behind `VisionProvider`,
- maintain benchmark fixtures independent of provider,
- record quality/cost/latency,
- never train product logic around proprietary response wording,
- permit provider replacement without rewriting UI or commerce code.

## Affiliate networks

Rules:
- no network is mandatory,
- no provider may influence `EXACT`/`LIKELY` classification,
- commercial economics apply only after relevance,
- record attribution terms and cookie windows separately from product relevance.

## Provider review checklist

Before adding any provider:

1. Does its TOS allow browser-extension use?
2. Does it allow the proposed display context?
3. Can returned data be cached?
4. Can data be used in ML/ranking?
5. Are logos/images/prices permitted?
6. Are affiliate links permitted from this client surface?
7. Does it require explicit user click-through?
8. Can terms change economics unilaterally?
9. Is there a practical replacement?
10. What happens if access disappears tomorrow?

No integration ships without answers recorded in `11_DECISIONS_AND_DO_NOTS.md`.
