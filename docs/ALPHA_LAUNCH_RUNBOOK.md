# Scoop closed-alpha launch runbook

This is the compact pre-flight for the first 5–10 testers.

## Already automated

- Pull requests to `main` run install, WXT type generation, TypeScript checks, build, and deterministic tests.
- Pushes to `main` deploy the API to Cloudflare only after verification passes.
- Production API custom domain: `api.vcl.article6.org`.
- Per-install alpha rate limit: 6 requests/minute.
- Global alpha rate limit: 30 requests/minute.
- Worker observability is enabled.
- Closed-alpha tester install, privacy, disable, and uninstall instructions already live under `apps/extension/`.

## One-time production setup

Required for ordinary Scoop:
- Cloudflare deploy credentials in GitHub Actions.
- At least one configured vision provider.
- Existing commerce provider credentials.

Required for creator attribution:
- `ALPHA_ATTRIBUTION_SECRET`
- `ALPHA_CREATOR_CONTENT_MAP`

Required for eBay Partner Network tracking:
- ePN enrollment
- `EBAY_AFFILIATE_CAMPAIGN_ID`

Awin:
- approval is still pending
- Awin does not block alpha launch
- when approved, wire Scoop `click_ref` into Awin's supported ClickRef/SubID field and verify one live reconciliation

Tracked in #128.

## Pre-flight before inviting testers

1. Main CI is green.
2. Latest main deploy succeeded.
3. Extension is built from current `main`.
4. Load/reload the extension in the tester browser.
5. Confirm the API answers through `api.vcl.article6.org`.
6. Run one normal Scoop request on a supported video.
7. Confirm a product result opens the merchant destination.
8. Submit one thumbs-up or thumbs-down feedback event.
9. Confirm no false EXACT result is emitted.
10. Confirm any LIKELY result is supported by the normal trust gates.
11. Confirm provider failure produces a retryable/unavailable state rather than a fabricated result.
12. Confirm no raw video is stored.

## Affiliate smoke test

Do this only after #128 eBay setup is complete:

1. Scoop a mapped creator/video.
2. Open an eBay result.
3. Confirm the result uses eBay's returned affiliate destination.
4. Confirm the same Scoop `click_ref` appears in the signed attribution path.
5. Preserve the test reference so it can be reconciled against the ePN transaction report later.

Awin should get the equivalent smoke test only after approval.

## Rollback

If a production merge causes a regression:

1. Stop inviting new testers.
2. Disable alpha with `ALPHA_ENABLED=false` if the problem affects normal use or trust.
3. Revert the offending PR on `main`.
4. Let normal CI pass and automatic deploy restore production.
5. Re-enable alpha only after the same smoke test above passes.

## Not launch blockers

These continue after alpha starts:
- #47 — p50 latency below 20s
- #56 — Jev decision fabric
- #123 — OFF vs ROUTER vs FABRIC benchmark
- #24 — soft selection mask experiment
- #46 — benchmark history dashboard
- #124 — promote Jev architecture to canonical docs only after benchmark evidence
