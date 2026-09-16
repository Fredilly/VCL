# Spike 7 — Cost Measurement

Status: IN PROGRESS
Issue: #42

## Question

What does one normal Scoop interaction actually cost at the current production provider mix?

This spike measures usage and cost. It does not optimize the product.

## Measurement unit

One interaction means the normal user path from selection through object analysis and product resolution.

Record separately:
- localization / object-selection model calls
- primary vision analysis calls
- optional nearby-frame calls if used
- commerce-provider calls
- candidate-verification model calls if any
- end-to-end latency

## Evidence strategy

Use 10 representative runs from existing known/frozen cases where practical. Do not require new manual video hunting.

For each run record raw provider usage first. Apply dated provider pricing only afterward so raw evidence survives pricing changes.

## Required output

For every run:
- case id
- provider/model
- number of provider calls
- input/output token usage where the provider exposes it
- other billable units where applicable
- commerce provider calls
- latency
- provider-blocked state if applicable
- calculated variable cost under the dated pricing snapshot

Summary:
- mean and median variable cost per interaction
- P50/P95 latency from the same sample where available
- projected variable spend for 100 / 1,000 / 10,000 interactions
- dominant cost stage
- quota/free-tier dependencies called out separately

## Guardrails

- No model swaps.
- No provider-order changes.
- No ranking or identity-threshold changes.
- No UI work.
- No latency optimization.
- Do not store raw frames, crops, URLs containing personal data, or user-identifying telemetry for this spike.
- Do not hard-code provider prices into product logic.

## Acceptance

Spike 7 passes when:
1. Ten representative interactions have a complete raw usage record, or a documented reason a provider cannot expose billable usage.
2. Vision and commerce costs are separable.
3. Pricing assumptions are dated and separate from raw usage.
4. Cost projections for 100 / 1,000 / 10,000 interactions are reproducible.
5. Existing Golden behavior is unchanged.
6. Any instrumentation change passes `pnpm check`, `pnpm build`, and relevant tests.

## Stop rule

Once we can reliably state the variable cost of a normal interaction and identify the dominant cost stage, stop. Optimization belongs in a later issue only if the measured economics justify it.
