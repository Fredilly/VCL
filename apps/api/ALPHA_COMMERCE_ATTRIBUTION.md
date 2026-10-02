# Alpha commerce attribution

This is the alpha money trail for creator-linked Scoop events.

## Storage

No database is required for the first 5–10 creators. The Worker emits append-only structured events:

- `ALPHA_COMMERCE_CLICK`: creator/content/event/result/merchant/click reference
- `ALPHA_COMMISSION`: transaction reference, gross commission, creator share, and state

Cloudflare log exports are the source record for alpha. Do not edit old entries. Corrections are new state events.

## Creator/content mapping

`ALPHA_CREATOR_CONTENT_MAP` is server-side JSON:

```json
{
  "youtube:VIDEO_ID": "creator_001"
}
```

The client never chooses `creator_id`. Only content explicitly mapped by Scoop receives creator attribution.

Logs retain a SHA-256 content hash rather than the raw content reference.

## Signed click token

Set `ALPHA_ATTRIBUTION_SECRET` as a Worker secret before enabling creator attribution.

For mapped creator content, `/resolve-products` attaches a signed per-result attribution token. The extension sends that token to `/commerce-click` when the user opens a merchant result.

The server verifies the signature before logging the click. A client cannot rewrite the creator, content, event, result, or merchant fields without invalidating the token.

## Affiliate sub-ID / click reference

Scoop derives one compact 32-character `click_ref` per attributed Scoop event. Every product token from that event carries the same reference so the affiliate-network transaction and Scoop click ledger reconcile to the same event.

Current Chrome shipping rule:

- Affiliate credentials alone do **not** enable affiliate destinations.
- Every adapter defaults to `DISABLED_IN_EXTENSION` / plain-link behavior.
- eBay uses `itemWebUrl` for Chrome unless its adapter is explicitly classified `COMPLIANT_ENABLED`.
- Unknown or unconfigured affiliate status fails closed.
- If no plain merchant URL exists, a non-compliant affiliate-only URL is not exposed.
- Awin, Sovrn, Skimlinks, eBay EPN, or any future affiliate route must pass the same gate.

Allowed adapter statuses:

- `COMPLIANT_ENABLED`
- `PLAIN_LINK_ONLY`
- `DISABLED_IN_EXTENSION`

Do not append tracking parameters to ordinary merchant URLs blindly. Product discovery must continue with plain merchant links when affiliate monetization is disabled.

## Ledger states

Each returned commission is recorded as one of:

`pending -> approved -> paid`

or

`pending/approved -> reversed`

Never treat pending commission as payable.

## Manual monthly payout

For alpha:

1. Export Worker attribution logs and the affiliate-network transaction report.
2. Reconcile network Custom ID / ClickRef to Scoop `click_ref`.
3. Record the returned commission as `pending`, `approved`, or `reversed`.
4. Pay only approved, non-reversed balances.
5. After manual payout, append a `paid` event referencing the same transaction.
6. Keep the original network report and payout evidence for audit.

Automated payouts, KYC/tax automation, creator dashboards, and revenue-share policy are intentionally out of scope.
