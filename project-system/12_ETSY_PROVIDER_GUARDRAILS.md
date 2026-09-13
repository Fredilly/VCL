# 12 — Etsy Provider Guardrails

Status: optional commerce provider.

## Handling class

- `fresh-query`
- `low-cache`
- `direct-link-required`
- `OPTIONAL` / `REPLACEABLE`

## Runtime rules

- Use Etsy's documented API only.
- Do not scrape Etsy pages or reverse engineer internal feeds.
- Normalize Etsy results through `CommerceProvider` and preserve provider provenance.
- Link Etsy-sourced product information and images directly back to the relevant Etsy listing/product.
- Do not display Etsy product information or images more than six hours older than Etsy's current data.
- Cache only for short operational periods needed to serve the user flow; do not build a permanent local Etsy catalog.
- Do not infer exact product identity from a title match alone.
- Do not replace Etsy checkout or reproduce Etsy's essential user experience.
- Do not use Etsy primarily to divert users to non-Etsy destinations.
- Re-check Etsy commercial-use rules before monetizing any VCL surface containing Etsy data.
- Satisfy Etsy attribution and non-endorsement requirements before public launch.
- Keep Etsy optional so access or approval friction cannot block the MVP.

## Architecture implication

VCL may identify the object and rank Etsy candidates, but Etsy remains a fresh result source. Etsy candidates should remain visibly attributable and their destination should be Etsy.

## Integration acceptance

The Etsy adapter is not ready to ship until it verifies:

1. API access and quota.
2. Category gating.
3. ProductCandidate normalization.
4. Provider provenance.
5. Direct-link behavior.
6. Six-hour freshness enforcement.
7. No persistent Etsy catalog storage.
8. Required public attribution/non-endorsement handling.
9. Commercial-use review before monetization.

Terms reviewed 2026-09-13 from Etsy API Terms of Use.

Primary references:
- https://www.etsy.com/developers
- https://developers.etsy.com/
