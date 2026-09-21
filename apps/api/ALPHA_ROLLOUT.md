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

Current deployed limit:
- 6 product-resolution Scoops per install per minute

## Global guardrail

The Worker also limits the alpha as a whole:
- 30 product-resolution Scoops per minute across the cohort

This is a runaway-usage brake, not billing/accounting. Cloudflare's rate-limit counters are intentionally permissive/eventually consistent, so cost telemetry and provider-side quota caps remain the accounting source of truth.

## Cohort access

For the closed alpha, access is controlled by private extension distribution rather than a new account/invite backend. Expanding the cohort therefore does not require product code changes.

If the extension is later published publicly, replace distribution-only access with authenticated invites before relying on the cohort cap as an authorization boundary.
