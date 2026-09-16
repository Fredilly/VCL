# Golden regression suite

This directory is the permanent manual regression contract for VCL.

It answers one question quickly: **did we break the user-visible pause → point → identify → resolve → buy flow?**

The Golden set is deliberately small. It is not a replacement for the larger benchmark corpus under `tests/benchmark/`.

## Layout

- `GOLDEN_5.md` — human-readable current Golden 5 baseline.
- `cases.json` — stable case definitions. URLs, targets, click instructions, and expected identities live here.
- `runs/` — immutable dated test sessions. Each file records every run as structured data.
- `reports/` — reserved for future generated summaries, charts, trend snapshots, and graph-ready outputs. Do not hand-author source-of-truth measurements here.

As the suite grows, add cases to `cases.json`; do not create a new ad-hoc format. New test sessions get a new file in `runs/` so results can be compared over time and graphed later.

## Procedure

For every active Golden case:

1. Open the exact saved URL-at-time.
2. Pause on the saved frame.
3. Click the same described point on the same target object.
4. Run the case three times.
5. Do not move the click to help VCL after seeing a weak result.
6. Record the outcome, returned identity, result class, product count, latency, confidence, and notes.

The case definition is frozen unless the source video disappears or the frame becomes unusable. A replacement should be treated as a case-version change, not silently substituted.

## Outcome taxonomy

- `PASS` — correct object understanding and commercially useful result.
- `PRODUCT_FAIL` — the flow runs normally, but identification or product result is wrong.
- `PROVIDER_BLOCKED` — model, commerce provider, quota, rate limit, or temporary provider availability prevents completion.
- `SYSTEM_FAIL` — capture, selection, extension, API, or another internal VCL path breaks.

`PROVIDER_BLOCKED` is tracked separately and does not by itself count as a product-regression failure.

## Regression use

Rerun the Golden set before external alpha and after changes that materially touch capture, localization, vision, prompts, product query generation, candidate verification, ranking, commerce routing, or result presentation.

Compare new sessions against previous `runs/*.json` files rather than overwriting old measurements. This preserves history for latency trends, pass-rate charts, provider comparisons, identity-confidence trends, and future evidence graphs.

## Scope

Golden is a smoke/regression suite. It should remain fast enough to run manually. Broader quality claims belong in the larger benchmark corpus, not here.
