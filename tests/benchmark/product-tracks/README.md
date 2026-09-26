# Product-track persistence benchmark

Purpose: measure whether promoted Exact products persist safely across a video before optimizing routing.

## Protocol

Use frozen observations so OFF and ON see the same object descriptions, source crops, video IDs, and timestamps.

Minimum corpus:
- presentation: 2 promoted products + 2 negative/different products
- similar-products video: 3 promoted products that could be confused + 2 negatives
- moving/occluded video: 2 promoted products, disappearance/reappearance + 2 negatives
- at least 10 observations per video

For each observation record:
- video/content_ref and timestamp
- expected track_id (or NONE)
- returned product_id / track_id
- track_diagnostics
- result class
- latency_ms
- verification requests/tokens/cost
- commerce calls

Run A — persistence OFF:
Use a clean ledger / fixture set without track_id, preserving the old time-window behavior.

Run B — persistence ON:
Use identical inputs with the promoted mappings carrying track_id.

Do not change matching thresholds, Jev, providers, or frozen observations between runs.

## Metrics

- persistence recall = expected promoted-track observations returning that track / expected promoted-track observations
- false inheritance = negative observations incorrectly returning a promoted track / all negative observations
- multi-track accuracy = correct track selected / observations where one of multiple promoted tracks is expected
- no-result rescue = observations that returned no useful result OFF but the correct promoted Exact ON
- p50 / p95 total latency
- verification requests and cost per observation
- commerce calls per observation

## Trust gate

Hard fail: any false inherited Exact.

Report separately:
1. same-track success
2. wrong-track Exact
3. ambiguous/fallback
4. no-result rescue

Do not optimize speed until this benchmark establishes that track persistence is safer/more useful than the old behavior.
