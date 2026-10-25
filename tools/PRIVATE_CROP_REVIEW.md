# Private crop review
Review Handbagholic or another authorized private real-frame corpus locally.

1. Prepare private `joined-review-manifest.json`, its crop images, and a roster JSON containing `products: [{ "sku": "canonical-variant-id" }]` (alternatively `roster` or `items`).
2. From repository root, run `python3 -m http.server 8765 --bind 127.0.0.1`. Visit `http://127.0.0.1:8765/tools/private-crop-review.html`. (ES modules generally cannot load through file://.)
3. Load the manifest, roster and crops through the local file pickers. Images stay in the browser. Review independently from model output. Export labels before closing/replacing the manifest. Reloading the page does not preserve in-memory annotations; use the **Resume** picker with a previously exported file.
4. Merge: `node tools/merge-private-crop-labels.mjs PRIVATE/joined-review-manifest.json PRIVATE/scoop-reviewed-labels.json PRIVATE/roster.json PRIVATE/merged.json`.
5. The merged manifest remains private and **is not yet approved benchmark ground truth**. Independently check signed labels, crop-source pairing, consent and holdout split before promotion.

Limitations: the roster must have canonical variant IDs; a generic raw seller-link manifest may need normalizing first. This page does not create a cryptographic signature. Do not serve it over a public host or commit private frames/labels to GitHub.
