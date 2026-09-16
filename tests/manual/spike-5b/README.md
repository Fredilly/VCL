# Spike 5b bounded deployed verification

This directory records new evidence only. `../spike-5/results.json` remains the
frozen ten-session Spike 5 record.

## Findings

The five recorded Spike 5 capture failures were reproduced from the frozen click
coordinates and diagnoses. They target a garment boundary, zipper/hardware,
presenter, sponsor segment, workstation, or instruction sheet. They are ambiguous
or non-target selections, not evidence of an error in that protocol's coordinate
transform. A general transform defect did exist for videos rendered with non-default
`object-fit` values; the regression test covers `cover`.

The deployed resolver run in `deployed-verification.json` uses five independent,
bounded catalog-image requests. It exposes provider retrieval separately from
candidate verification, returns only `SIMILAR` results, and preserves the identity
and relevance gates. It is deliberately labeled resolver verification rather than
a replacement for the manual extension/capture protocol.

Compared with the frozen Spike 5 total baseline (P50 57,059ms / P95 74,338ms),
this bounded resolver sample's wall-clock P50/P95 is 24,721ms / 29,860ms. The
measures are not directly interchangeable because the frozen protocol includes
capture/localization/vision while this probe includes catalog-image download. Its
value is a fresh deployed measurement of the identified resolver bottleneck.
