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


## Alpha v1 frozen regression set

`alpha-v1.json` pins the user-visible behavior we are protecting during the `ScoopResolver` hardening work to `baseline/alpha-v1` at commit `aef9f97edc97a40ada0d66ae7417f7dccf680018`.

It contains the seven known alpha cases: Durant #7 Rockets jersey, Lakers #12 white jersey, Nike sleeveless hoodie, Minnesota Grey Duck shirt, fragrance, Funko figure, and sneaker.

Two cases already reuse exact replay metadata from existing frozen tests. The remaining cases are intentionally marked `capture_required` rather than inventing URLs, timestamps, or click coordinates. Their identity/evidence expectations are frozen now; when exact source metadata is captured, only the `replay` block may be completed.

CI validates that the baseline commit, seven case IDs, evidence requirements, and trust invariants remain present. Live/manual runs still belong under `runs/` so provider availability is not confused with deterministic product regression.
