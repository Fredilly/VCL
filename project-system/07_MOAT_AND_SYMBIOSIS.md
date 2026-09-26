# 07 — Moat and Symbiosis

## The extension is not the moat

A video platform can copy an overlay.

A model provider can improve object recognition.

A retailer can add visual search.

The durable company must own the neutral intelligence and relationship layer.

## Desired moat

Build a proprietary visual-intent graph:

```text
surface
content identifier
timestamp
selection region
object attributes
identity hypotheses
confidence
canonical product
merchant offers
availability
user corrections
clicks
conversions
geography
creator/publisher provenance
```

Raw copyrighted frames are not the moat and should not be accumulated casually.

## ContentProductGraph and automated video mapping

A first-class future moat is the ability to resolve products in commercially valuable video before a viewer has to pay the full cost of fresh inference.

Separate the graph into four related layers:

1. **ContentProductGraph** — where and when a canonical product appears in content, represented as an appearance window/object track rather than a single timestamp.
2. **CanonicalProductGraph** — normalized product identity across videos, catalogs, merchants, identifiers, images, and historical mappings.
3. **Evidence layer** — why a mapping exists: visual evidence, text/logo evidence, partner metadata, verification, corrections, provenance, and confidence.
4. **Offer layer** — current merchant availability, price, geography, and commercial destination. Offer freshness is independent from product identity.

Target future partner flow:

```text
new partner video
  -> automated ingestion
  -> sparse / scene-aware frame sampling
  -> product/object detection + tracking
  -> cheap routing / decision layer
  -> existing canonical product lookup first
  -> candidate retrieval + multi-frame verification on misses
  -> ContentProductGraph mapping
  -> current merchant offers
```

Partners should not be required to manually tag every product or submit SKU spreadsheets. Where platform and partner permissions allow, Scoop should detect new partner content and build mappings automatically. Partner or sponsor catalogs are optional high-value evidence because they reduce the candidate search space; they are not a requirement for the system to work.

The decision/routing layer may use Jev or a future replaceable equivalent to skip redundant frames, prioritize commercially useful scenes, choose graph lookup versus fresh resolution, and reduce expensive provider calls. Jev is not product truth. Any claimed cost or latency gain must be benchmarked.

Do not indiscriminately crawl or pre-map all of YouTube. Build coverage demand-first:
- paying partner videos,
- high-value partner back catalogs,
- products repeatedly requested by users,
- successful Scoop resolutions that can be reused,
- corrections and confirmed identities.

Every successful resolution should be capable of leaving reusable derived evidence so a later Scoop can become a graph hit instead of repeating the entire inference pipeline.

### Build timing

Reserve this architecture now, but do not build the automated ingestion system before commercial demand justifies it.

Implementation trigger:
- **3 paying partner/creator clients** requesting automated video integration, or
- **1 anchor partner** with enough recurring video volume or revenue to justify the work.

Before that trigger, launch alpha, instrument reuse opportunities, measure real demand, and protect founder/engineering attention from premature infrastructure work.

Tracking issue: GitHub #249.

## Compounding loops

### Recognition loop
More interactions -> more corrections -> better matching.

### Commerce loop
More purchase-intent events -> better merchant ranking -> better conversion.

### Catalog loop
More merchants -> better coverage -> more useful results -> more users.

### Creator loop
More creator/publisher integrations -> verified metadata -> higher accuracy -> more revenue -> more creators.

## Symbiotic stakeholder design

### Users
Benefit:
- instant discovery,
- truthful identification,
- multiple buying options,
- alternatives when original is unavailable.

Reason to want us:
we reduce the gap between "I see it" and "I can get it."

### Creators and publishers
Benefit:
- make existing/back-catalog media shoppable,
- less manual tagging,
- new revenue,
- analytics on what viewers actually want.

Reason to want us:
we monetize content without requiring every product to be manually tagged.

### Merchants
Benefit:
- high-intent traffic,
- visually relevant demand,
- access to demand generated outside their own properties.

Reason to want us:
we create qualified discovery events they did not have to acquire through normal keyword ads.

### Video platforms
Benefit:
- incremental commerce,
- potentially richer long-tail product understanding,
- creator value,
- no need to own every merchant relationship.

Reason to want us:
we can become infrastructure rather than a parasitic overlay.

### Marketplaces
Benefit:
- incremental qualified demand,
- product matching against their catalog.

Reason to want us:
we originate visual intent outside the marketplace.

## Partner posture

Never frame the company as:
"we monetize someone else's pixels."

Prefer:
"we convert user-initiated visual discovery into measurable commerce and share value with the ecosystem."

## Platform independence target

No single platform should account for a level of usage that makes shutdown existential without an explicit strategic reason.

## Long-term defensibility

Potential layers:
1. proprietary interaction/correction dataset,
2. object-to-product resolution quality,
3. multi-frame inference,
4. cross-platform identity graph,
5. merchant inventory integrations,
6. verified creator/publisher metadata,
7. conversion ranking,
8. SDK/API integrations,
9. trusted neutral brand.

## Success condition

Platforms should eventually see two choices:
- rebuild the neutral cross-market graph themselves,
- integrate/license/partner.

The product becomes strategically valuable only when the second option is cheaper or better.
