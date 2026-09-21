# Alpha telemetry

Scoop alpha telemetry is emitted as bounded structured log events. No database is required for the first cohort.

## Events

`ALPHA_SCOOP`
- anonymous ephemeral `session_id`
- random `event_id`
- state: RESULTS / NO_RESULTS / TEMPORARILY_UNAVAILABLE
- end-to-end latency
- provider names used
- result IDs + result classes only
- model/request usage needed for cost accounting

`ALPHA_FEEDBACK`
- event ID
- result ID
- one allowed feedback label
- timestamp

The logs must not contain frame bytes, screenshots, page URLs, page titles, credentials, cookies, or browsing history.

## Report

Export the relevant Cloudflare Worker logs as JSONL, then run:

`node tests/alpha/report.mjs alpha.jsonl`

The report includes result/no-result/provider-failure rates, feedback usefulness, feedback-backed false EXACT / unsupported LIKELY counts, p50/p95 latency, observed cost per Scoop, cost per feedback-useful Scoop, and repeated Scoops within an ephemeral session.

### Metric limits

- A returned result is not automatically considered useful.
- False EXACT and unsupported LIKELY require result-level negative feedback or separate adjudicated ground truth.
- The alpha session ID resets with the content-script/page lifetime; it is intentionally not a persistent user identifier.
- Costs are only as complete as the maintained pricing snapshot.
