# Partner roster and reviewed correction promotion (#353)

The partner roster is a set of explicit variants, not a list of representative families. Import preserves the supplied merchant destinations and merges offers only onto the same catalog variant. A generic model name is not a variant identifier. Query parameters that choose merchant variants survive offer normalization; tracking parameters do not.

## Import

Admin-authenticated `POST /partner-roster`, header `x-scoop-admin-session`:

```json
{
  "platform": "youtube",
  "content_ref": "video-id",
  "offers": [
    {
      "sku": "catalog-variant-id",
      "family": "product-family",
      "model": "product-family",
      "brand": "brand",
      "object_type": "bag",
      "title": "complete variant title",
      "color": "white",
      "destination": "https://merchant.domain/product?variant=123",
      "image_reference": "https://catalog.domain/variant-image.jpg"
    }
  ]
}
```

Each URL becomes an offer row, even when a section contains several variants or several merchants. The SKU and variant can be supplied or acquired from product metadata. Missing explicit identity or an unreachable image fails validation, with the failing row identified. No row is silently dropped. All reference hydration completes before publishing a batch's membership. Repeating a batch is safe. Multiple different candidate windows for the same variant broaden the candidate scope instead of dropping an appearance.

`tools/partner-learning.mjs import manifest.json` uses small sequential batches, so a long roster does not spend the whole Worker subrequest budget in one invocation. It reads `SCOOP_API_URL` and `SCOOP_ADMIN_SESSION` from the environment. It never logs the session. Partial batch failure stops the command; earlier committed batches remain and retries reuse their identities.

Catalog image bytes are copied at ingestion into content-addressed Durable Object storage. Each variant has a durable reference before its first click. References are served through `/product-reference/<sha256>`. Selected correction crops are private, available only through the internal ledger. Images and correction documents are chunked below per-value storage limits.

Use partner-authorized references or merchant content whose caching/display rights permit this use. Etsy API images/data must retain its freshness and display policy and must not become permanent catalog assets. This importer does not add an Etsy API integration. Do not use it to import Etsy API content into permanent product memory.

## Review and promotion

Existing feedback contains object evidence and source context, not saved source pixels. We do not silently retain every user's frame. An admin supplies the reviewed selected crop to `POST /feedback-review` or to `POST /feedback-promote` for an already-reviewed `verify_product` / `hard_negative` record. The latter derives the action from the saved review, not the request's action field.

```json
{
  "event_id": "feedback-event",
  "result_id": "incorrect-result",
  "action": "verify_product",
  "source_image": "data:image/jpeg;base64,...",
  "product": {
    "sku": "correct-variant",
    "family": "product-family",
    "brand": "brand",
    "object_type": "bag",
    "title": "correct variant title",
    "destination": "https://merchant.domain/correct-product",
    "image_reference": "https://catalog.domain/correct-reference.jpg"
  }
}
```

A `hard_negative` record without a corrected product may be reviewed, but remains `learned: false`. It cannot produce a positive observation by inference. A correction missing source context or a crop fails promotion. The corrected catalog reference is hydrated first. The normal visual verifier compares the selected crop to the augmented roster once. Both baseline and post-promotion replay use that frozen comparison evidence, with their respective candidate sets, avoiding duplicate provider calls. We never trust submitted comparison scores.

Promotion requires the corrected SKU to win the unchanged production visual gate, with every plausible sibling compared. Ambiguity, contradictory OCR/image evidence, unavailable comparisons and outside-roster selections remain unlearned. A successful promotion commits:

1. selected crop + variant + review provenance;
2. sibling hard negatives;
3. canonical identity, reference bytes, offer links and trusted observation;
4. frozen production-resolver evidence fixture;
5. video, exact timestamp and canonical identity track;
6. promotion/new-identity/negative/repeat-prevention metrics.

The ledger commits the mapping, bundle and indexes together in a storage transaction. Retrying a promotion returns its original immutable bundle and does not increment metrics. A different crop or identity for an already-promoted record is rejected. Hard negatives veto roster identities only for identical crop bytes in the same video. They do not globally suppress a valid sibling SKU, and cannot promote a missing/weak visual match.

`tools/partner-learning.mjs review` and `promote` automatically export successful promotions into the local harness as their final step. An export failure stops the workflow and is reported explicitly.

`POST /learning-export` returns fixtures and aggregate metrics to an authorized admin. `tools/partner-learning.mjs export` appends those cases to `tests/benchmark/roster-outliers/promoted/`; unchanged exports are idempotent and edits to an existing case are rejected. The regular roster runner discovers these JSON cases automatically, uses the production resolver, and includes them in the existing hard gates. The runtime already retains the frozen fixture durably; export puts it into the repository harness for CI.

## Evidence boundaries

Deterministic tests cover Speedy, Vanity, Neverfull and Trunkie variants, duplicate offers, query-based variants, failed hydration, replay, different-video canonical reuse, immutable exports and private crop access. HTTP integration tests run import -> promotion -> repeat resolution with mocked provider responses. They prove orchestration and trust-policy behavior, not pixel recognition quality.

The original complete partner link list is not embedded in issue #353. The saved pilot HAR contains 36 exact selected crops and request envelopes; the recorded baseline report indexes them by timestamp and crop hash. This PR does not guess missing real SKUs, backfill invented references, or claim the live Handbagholic failures are fixed. Live Golden requires saved selections and live provider credentials. Keep this work draft until those checks and the pilot replay pass.
