# VPM frozen fidelity benchmark

Issue: #272

This is the deterministic trust gate for video product memory (VPM). It exercises frozen object observations against the same identity-reuse functions used by the API.

Coverage:
- presentation
- multiple similar promoted products
- disappear/reappear
- occlusion
- weak OCR
- movie-style cuts
- deliberate adversarial lookalikes

Run:

```bash
node tests/benchmark/product-tracks/run.mjs
```

The runner reports persistence recall, false inherited Exact, multi-track accuracy, no-result rescue, decision p50/p95, verification requests, verification cost, and commerce calls.

## Hard gate

Any negative observation that inherits a promoted VPM track fails the benchmark. False inherited Exact must remain **0**.

The deterministic suite intentionally makes no paid provider calls, so `verification_cost_usd` is 0 and the latency metric is **VPM decision latency**, not end-to-end provider latency. Live provider latency/cost stays a separate benchmark concern.

Do not weaken Exact thresholds or rewrite frozen cases to make a regression pass.
