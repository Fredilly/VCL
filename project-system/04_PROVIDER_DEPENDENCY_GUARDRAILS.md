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

## Commerce redundancy policy

Commerce reliability must come from multiple replaceable providers, not from increasing dependence on one search API.

Current intended roles:

| Provider | Role | Category focus | Dependency class |
| --- | --- | --- | --- |
| eBay Browse | primary broad catalog | fashion, watches, shoes, bags, resale, general products | `REPLACEABLE` |
| Best Buy | category primary | electronics, appliances, consumer tech | `OPTIONAL` / `REPLACEABLE` |
| Etsy | category primary | jewelry, bags, apparel, accessories, vintage/handmade | `OPTIONAL` / `REPLACEABLE` |
| SerpAPI | fallback search | broad shopping discovery | `REPLACEABLE` |
| Brave Search | final open-web fallback | merchant/product-page discovery | `OPTIONAL` |

Rules:
- do not query every provider on every request,
- prefer category-aware routing,
- protect quota-limited providers for fallback use,
- keep provider provenance,
- measure result quality and latency by provider,
- distinguish provider failure from no-result,
- preserve a truthful degraded state when every provider fails,
- re-check quotas and terms during each integration because they can change.

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

Current implementation state:
- adapter exists,
- OAuth client-credentials flow exists,
- keyword search exists,
- image search exists with keyword fallback,
- production access must be explicitly verified before treating eBay as the primary live provider.

Do not make eBay exclusive.

Primary source:
https://developer.ebay.com/api-docs/buy/browse/overview.html

## Best Buy

Use as a category-specific provider for electronics, appliances and consumer technology only where current API terms permit the extension flow.

Rules:
- normalize through `CommerceProvider`,
- do not call for irrelevant categories,
- verify current quota, display rights, image use, caching and destination requirements before shipping,
- treat as replaceable rather than foundational.

Primary source to verify during integration:
https://developer.bestbuy.com/

## Etsy

Use as a category-specific provider for fashion/accessories, jewelry, handmade and vintage coverage where current API terms permit the extension flow.

Provider handling class:
- `fresh-query`,
- `low-cache`,
- `direct-link-required`,
- `OPTIONAL` / `REPLACEABLE`.

Rules:
- normalize through `CommerceProvider`,
- query Etsy through the documented API only; do not scrape Etsy pages or reverse engineer internal feeds,
- link directly back to the relevant Etsy listing/product when Etsy product information or images are shown,
- keep Etsy product information and images fresh; do not display product information/images more than six hours older than Etsy's current data,
- cache only for short operational periods needed to serve the user flow; do not treat Etsy as a permanent local catalog,
- preserve provider provenance so Etsy-sourced results remain distinguishable,
- do not infer exact identity from a title match alone,
- do not replace Etsy checkout or reproduce Etsy's essential user experience,
- do not use Etsy primarily to divert users to non-Etsy destinations,
- do not store/process Etsy member personal data unless specifically authorized,
- respect Etsy trademark/attribution requirements if Etsy marks or branding are displayed,
- include the required Etsy API non-endorsement notice in the public application before shipping Etsy integration,
- re-check commercial-use rules before monetizing any VCL surface that includes Etsy data,
- if approval/access friction is material, keep Etsy optional rather than blocking the MVP.

Operational implication:
VCL may identify the object and rank candidate listings, but Etsy should remain a fresh result source whose Etsy candidate links take the user back to Etsy.

Terms reviewed 2026-09-13 from Etsy API Terms of Use.
Primary references:
https://www.etsy.com/developers
https://developers.etsy.com/

## SerpAPI

SerpAPI is a fallback, not a foundational catalog.

Rules:
- do not spend quota when primary catalog providers already returned enough candidates,
- record remaining quota where available,
- reserve capacity for broad shopping discovery when catalog providers fail,
- preserve a replacement path to another search provider.

## Brave Search

Brave Search is a final open-web discovery fallback, not a structured product catalog.

Use only when:
- catalog providers did not return enough useful candidates, or
- broader web evidence is needed for identity/product-page discovery.

Rules:
- hard-budget quota,
- normalize extracted candidates before verification/ranking,
- do not treat web-search rank as identity evidence,
- do not invoke on every click.

Primary source to verify during integration:
https://brave.com/search/api/

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
11. What are the current quota/rate limits and how are they measured?
12. Which categories should invoke this provider?
13. What is the fallback when quota or access is exhausted?

No integration ships without answers recorded in `11_DECISIONS_AND_DO_NOTS.md`.
