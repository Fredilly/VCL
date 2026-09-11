# 01 — Product Principles

## 1. Truth before monetization

The system must never present a paid result as the identified object merely because a merchant paid.

Required result classes:

- `EXACT`: evidence strongly supports exact product/SKU.
- `LIKELY`: strong candidate, but not enough evidence for exact claim.
- `SIMILAR`: visually or functionally comparable.
- `SPONSORED`: commercially promoted and clearly labeled.

Sponsored results must also pass minimum relevance rules.

## 2. User-initiated intent

MVP analyzes only when the user invokes the tool.

Do not continuously inspect all video playback.

Benefits:
- lower compute cost,
- lower privacy exposure,
- lower platform friction,
- clearer user consent,
- higher-intent events.

## 3. The click is the query

Treat the user's selected object as a search query, not an ad impression.

Core output is useful resolution, not advertising inventory.

## 4. Confidence must be visible

Do not fabricate precision.

Examples:
- "Exact match"
- "Likely match"
- "Similar"
- "Unable to identify confidently"

A correct refusal is better than a confident wrong answer.

## 5. Alternatives are a feature, not a failure

Old, unavailable, custom, luxury, and costume products may not be purchasable.

The product resolver should support:
- exact item,
- likely original,
- secondhand/resale,
- current equivalent,
- budget alternative.

## 6. Neutrality

The system should be able to route to multiple merchants.

Do not become:
- an Amazon skin,
- an eBay skin,
- a YouTube-only plugin,
- a single-model-provider wrapper.

## 7. Minimize friction

Initial UX target:
- one extension install,
- one visible action,
- one click on an object,
- one result panel.

No account should be required for the earliest prototype unless technically necessary.

## 8. Preserve the viewing experience

The overlay must:
- be lightweight,
- not hijack playback,
- not obscure content unnecessarily,
- disappear instantly,
- never auto-open merchant pages,
- never create clicks without user action.

## 9. Build for graceful degradation

If exact product matching fails:
`exact -> likely -> similar -> descriptive search`

If one merchant fails:
use another adapter.

If frame access fails:
report unsupported/protected capture rather than attempting circumvention.

## 10. Trust is a moat

Measure:
- wrong-identification rate,
- misleading-result reports,
- click-through by confidence class,
- repeat usage after first result.

Do not optimize CTR at the expense of truth.
