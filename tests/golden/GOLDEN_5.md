# Golden 5 baseline

Baseline date: 2026-09-16  
Configured primary vision provider: Groq  
Configured primary vision model: `qwen/qwen3.6-27b`

This file is the human-readable snapshot. Machine-readable case definitions live in `cases.json`; per-run measurements live in `runs/`.

| # | Case | URL at exact time | Expected identity | Expected brand/model | Official result | Avg latency |
|---|---|---|---|---|---|---:|
| 1 | Billions tie | https://youtu.be/T-bpMn0VMYk?t=157 | men's necktie | unknown / not visible | 3/3 PASS | ~27.0s |
| 2 | Casio F-91W | https://youtu.be/CT0mvnFbOYQ?t=2 | digital wristwatch | Casio F-91W | 3/3 PASS | ~24.5s |
| 3 | Hugo Boss bottle | https://youtu.be/jndGRB5Il3k?t=7 | perfume / fragrance bottle | Hugo Boss Boss Bottled | 2 PASS / 1 PROVIDER_BLOCKED | ~34.0s |
| 4 | White denim jacket | https://youtu.be/Fr8xhEDNhfU?t=121 | white denim jacket | unknown | 3/3 PASS | ~15.9s |
| 5 | Christian Dior Book Tote | https://youtu.be/4Gmrv8KEuTo?t=504 | tote bag / handbag | Christian Dior Book Tote | 3/3 PASS | ~27.2s |

## Baseline observations

- Object understanding was stable across all five cases.
- Exact brand/model recognition was strong on Casio F-91W, Hugo Boss Boss Bottled, and Christian Dior Book Tote.
- Generic products without visible identity evidence correctly stayed at low identity confidence.
- Commerce/result quality was more variable than object understanding; many successful runs were classified `SIMILAR` rather than `LIKELY` or `EXACT`.
- One Hugo Boss run was `PROVIDER_BLOCKED` because shopping sources were temporarily unavailable while visual understanding still succeeded.
- End-to-end latency varied substantially across otherwise successful runs.

## Scoring

- `PASS` — correct object understanding and commercially useful result.
- `PRODUCT_FAIL` — the flow runs normally, but identification or product result is wrong.
- `PROVIDER_BLOCKED` — model, commerce provider, quota, rate limit, or temporary provider availability prevents completion.
- `SYSTEM_FAIL` — capture, selection, extension, API, or another internal VCL path breaks.

## Regression rule

Run each case three times using the exact saved URL/frame and the same described click point. Do not adapt the click after observing a weak result.

New measurements must be added as a new dated file under `runs/`; do not overwrite the 2026-09-16 baseline. This history is intended to feed future pass-rate, latency, provider, confidence, and evidence-graph reporting.
