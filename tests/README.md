# Scoop test and benchmark index

This is the canonical map for test, benchmark, latency, cost, and regression evidence.

The suites stay separate on purpose:

- **Golden** protects user-visible behavior and trust.
- **Benchmarks** measure quality, latency, routing, and provider changes.
- **Cost** measures cost per Scoop and supports controlled comparisons.
- **Manual Spike 5 fixtures** preserve the original end-to-end test corpus and its corrected variants.

Do not move or rewrite frozen evidence merely to make a new run pass.

## Quick map

| Evidence | Location | Purpose | Mutability |
| --- | --- | --- | --- |
| Golden regression suite | `tests/golden/` | Small permanent smoke/regression contract | Cases frozen; runs immutable |
| Golden 5 summary | `tests/golden/GOLDEN_5.md` | Human-readable Golden baseline | Historical baseline |
| Golden case definitions | `tests/golden/cases.json` | Stable URLs, targets, and click instructions | Frozen except explicit case-version change |
| Golden runs | `tests/golden/runs/` | Recorded regression sessions | Immutable |
| Spike 4f benchmark | `tests/benchmark/spike-4f/` | Exact/likely/useful-result benchmark and replay tooling | Corpus controlled; results append-only |
| Jev frozen benchmark frames | `tests/benchmark/jev/frames/` | Shared frozen image inputs for OFF vs ON routing tests | Frozen |
| Jev benchmark workflow | `.github/workflows/jev-benchmark.yml` | Reproducible Jev OFF vs ON CI benchmark | Workflow code may evolve; artifacts identify commit |
| Spike 7 cost runner | `tests/cost/` | Live cost, latency, and provider-call measurement | Scripts editable; recorded evidence preserved |
| Manual Spike 5 fixtures | `tests/manual/spike-5/` | Original and corrected end-to-end cases | See fixture rules below |

## Commands

From repository root:

```bash
pnpm test
pnpm benchmark
pnpm benchmark:replay

pnpm cost:run
pnpm cost:summary
pnpm cost:compare
```

Jev OFF vs ON is run through the GitHub Actions workflow **Jev OFF vs ON benchmark**. The workflow records the exact commit in its output artifacts and uses frozen frames from `tests/benchmark/jev/frames/`.

## Golden regression suite

Read `tests/golden/README.md` before changing code that affects capture, selection, localization, vision, prompts, retrieval, verification, ranking, commerce behavior, or result presentation.

Rules:

1. Do not silently edit a Golden case to make a regression pass.
2. New sessions go into `tests/golden/runs/`; do not overwrite prior runs.
3. Keep `PROVIDER_BLOCKED` separate from product/system regressions.
4. Golden is a fast regression suite, not the full benchmark.

## Spike 4f benchmark

Location: `tests/benchmark/spike-4f/`

Important files:

- `README.md` — suite instructions and interpretation.
- `run.mjs` — benchmark runner.
- `corpus.mjs` — benchmark corpus.
- `metrics.mjs` — quality/latency metrics.
- `results/` — recorded benchmark results.

Use this suite for broader product-resolution evidence. Do not treat a Golden pass as proof that benchmark quality improved.

## Jev benchmark

Frozen inputs live in:

`tests/benchmark/jev/frames/`

The CI workflow:

`.github/workflows/jev-benchmark.yml`

compares Jev OFF and ON using the same prepared vision evidence, reports latency, verification calls, commerce calls, cost, routing decisions, and trust gates, and records the benchmark commit.

Do not replace frozen frames because a model/router performs poorly on them. If a fixture becomes invalid, version the corpus explicitly.

## Spike 7 cost evidence

Location: `tests/cost/`

Primary runner:

`tests/cost/run-live.mjs`

Key utilities:

- `summarize.mjs` — summarize a run.
- `compare.mjs` — compare two runs.
- `pricing-2026-09-16.json` — pricing snapshot used by the cost tooling.
- `run.json` — current recorded run artifact.

The historical Spike 7 baseline commit is:

`9a2ad6c`

Keep `tests/cost/` separate from product-quality benchmarks. Cost evidence answers a different question and should remain directly comparable with the historical tooling.

## Manual Spike 5 fixtures

Location: `tests/manual/spike-5/`

Fixture classes:

- `cases.json` — original fixture set. Treat as historical/frozen evidence.
- `cases-v2.json` — later versioned fixture set used by newer benchmark tooling.
- `cases-corrected.json` — corrected/derived fixture data. It must never be represented as the untouched original.
- `results.json` — recorded result artifact.

Known invalid/corrected cases must remain explicitly identified rather than silently rewritten. In particular, newer Jev benchmarking filters cases marked `valid: false` from `cases-v2.json`.

## Frozen vs derived rule

A **frozen** artifact represents the input or evidence used for a historical result. Do not modify it in place.

A **derived/corrected** artifact is allowed only when:

1. its filename or metadata makes the derivation explicit,
2. the frozen source remains available,
3. the reason for the correction is documented,
4. benchmark reports identify which version they used.

If an input must materially change, create a new version instead of mutating history.

## Baseline and run naming

Historical baseline:

`9a2ad6c`

Every future benchmark result must be traceable to a Git commit.

For committed benchmark evidence, prefer:

```text
YYYY-MM-DD_<suite>_<short-sha>_<variant>.json
YYYY-MM-DD_<suite>_<short-sha>_<variant>.md
```

Examples:

```text
2026-09-21_jev_a1b2c3d_on.json
2026-09-21_spike-4f_a1b2c3d_gemini.json
2026-09-21_cost_a1b2c3d_baseline.json
```

For GitHub Actions artifacts, preserve the workflow run plus the embedded commit field. Do not rename an artifact in a way that removes commit provenance.

## Where future baselines live

- Behavior regression baseline: `tests/golden/runs/`
- Product-quality benchmark results: the relevant suite's `results/` directory, such as `tests/benchmark/spike-4f/results/`
- Jev experiment evidence: GitHub Actions artifacts from `jev-benchmark.yml`; commit curated baselines under the Jev benchmark directory only when they become decision records
- Cost baseline/comparisons: `tests/cost/` unless a future migration is deliberately performed with scripts and paths updated together

## Decision rule

Before claiming an optimization is better, compare the dimensions that matter together:

- useful-result rate,
- false EXACT,
- unsupported LIKELY,
- P50/P95 latency,
- provider/verification/commerce calls,
- cost per Scoop and cost per useful Scoop.

Speed or cost alone is not a pass if trust or usefulness regresses.
