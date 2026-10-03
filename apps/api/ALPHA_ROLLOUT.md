# Alpha rollout controls

The closed alpha is intentionally staged and privately distributed. Do not publish the unpacked extension publicly during this phase.

## Cohort stages

- Founding 20
- 50 testers
- 100 testers

Expand only after the current cohort is stable enough to justify more provider spend.

## Kill switch

The Worker reads the dashboard-managed variable `ALPHA_ENABLED`.

- unset or any value other than `false`: alpha runs normally
- `false`: paid/product-processing routes return a temporary-disabled response before model or commerce work begins

Because `ALPHA_ENABLED` is not committed in `wrangler.jsonc`, `keep_vars: true` preserves an emergency dashboard override across deploys.

## Per-install guardrail

Each extension install creates one random anonymous UUID in extension local storage. The ID is sent only as `X-Scoop-Install-Id` and is used for rate limiting.

It is not an account ID and is not tied to email, URL, title, browsing history, or frame content.

Current deployed limits:
- 6 product-resolution Scoops per install per minute
- 100 product-resolution Scoops per invite per UTC calendar month, shared across that invite's installs

The monthly cap is enforced in the alpha access ledger and resets on the first day of each UTC month.

## Global guardrail

The Worker also limits aggregate alpha traffic:
- 30 product-resolution Scoops per minute per Cloudflare edge location

This is a runaway-usage brake, not exact billing/accounting. Cloudflare rate-limit counters are local to an edge location and intentionally permissive/eventually consistent, so cost telemetry and provider-side quota caps remain the accounting source of truth.

## Cohort access

For the closed alpha, access is controlled by signed personal invites plus the alpha access ledger. Each invite can activate up to two installs, and both installs share the same 100-Scoop monthly allowance.

The extension artifact may be distributed separately from the invite credential; possession of the ZIP alone does not authorize paid Scoop requests.
