# Clef Vision vs Gemini benchmark

Status: experimental only. Do not merge provider changes into production based on anecdotal demos.

## Question

Can Clef Vision improve Scoop's product-understanding path versus the current Gemini baseline without increasing trust failures?

## Isolation

- branch: `experiment/clef-vision-vs-gemini`
- production `main` remains unchanged
- same frozen frames/crops/click context for both providers
- commerce retrieval and ranking held constant
- provider output normalized into Scoop-owned structures

## Compare

1. Current Gemini vision baseline
2. Clef Vision under the closest equivalent structured task

## Record

- commercially searchable object-description rate
- wrong-category rate
- exact precision
- likely precision
- false-EXACT rate
- useful-result rate
- no-result rate
- p50 / p95 latency
- model cost per event
- verification calls per event
- commerce calls per event

## Gate

Do not promote Clef unless it preserves Scoop's trust constraints and provides a measured quality, latency, or cost advantage.

False EXACT must remain 0 on the frozen benchmark. A correct no-result is preferable to a confident wrong identity.

## First run

Start with the existing frozen Golden/benchmark corpus. Do not tune cases specifically for Clef.
