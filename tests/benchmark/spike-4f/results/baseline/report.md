# Spike 4f exact-match benchmark

Decision: **FAIL**. Mode: static_authored_evidence.

Static authored evidence, not measured image-model or real-video identification accuracy. Product identity means the fixture’s named model and color, not authenticity, serial number, or unstated SKU variants. Precision uses independently labeled top candidates; usefulness and false EXACT inspect every returned candidate. Unknown identities are excluded from precision. No EXACT claims means precision is N/A. Latency is local resolver/merger execution with mocked providers and image comparisons, not live end-to-end latency. Provider failures are injected and counted per call; they are not an estimate of live reliability. Repeated scenarios and product families are correlated; this is a regression benchmark, not a population estimate.

Selections: 30; known 20, unknown 10. Categories: apparel 6, shoes 6, watches 6, bags_accessories 6, other 6.

| Metric | Result |
| --- | --- |
| Exact precision (top, judged) | N/A (0/0) |
| Likely precision (top, judged) | 83.3% (10/12) |
| False-EXACT selections (any returned rank) | 0.0% (0/30) |
| Unverified EXACT selections | 0 |
| Useful-result rate (any returned rank) | 73.3% (22/30) |
| No-result rate | 26.7% (8/30) |
| P50 / P95 latency (ms) | 3.016 / 12.699 |
| Provider failure rate (observable only) | 6.6% (5/76) |
| Multi-frame used / contributed | 5 / 5 |

False EXACT: none. Unverified EXACT: none.

| Selection | Expected | Actual | Top candidate | Correct | Useful | False EXACT | No result | ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| apparel-known-exact | LIKELY | LIKELY | Adidas GD5376 blue hoodie | true | true | false | false | 23.563 |
| apparel-difficult-lookalike | SIMILAR | LIKELY | Adidas GD5376 blue hoodie | false | true | false | false | 6.831 |
| apparel-low-evidence | SIMILAR | SIMILAR | Adidas GD5376 blue hoodie | — | true | false | false | 6.154 |
| apparel-multi-frame | LIKELY | LIKELY | Adidas GD5376 blue hoodie | true | true | false | false | 3.68 |
| apparel-unavailable-vintage | SIMILAR | SIMILAR | Patagonia 25528 PGBE successor blue jacket | false | true | false | false | 12.595 |
| apparel-no-result | NO_RESULT | NO_RESULT | — | — | false | false | true | 3.347 |
| shoes-known-exact | LIKELY | LIKELY | Adidas B75806 white sneakers | true | true | false | false | 6.756 |
| shoes-difficult-lookalike | SIMILAR | LIKELY | Adidas B75806 white sneakers | false | true | false | false | 3.016 |
| shoes-low-evidence | SIMILAR | SIMILAR | Adidas B75806 white sneakers | — | true | false | false | 2.241 |
| shoes-multi-frame | LIKELY | LIKELY | Adidas B75806 white sneakers | true | true | false | false | 2.694 |
| shoes-unavailable-vintage | SIMILAR | SIMILAR | Nike Air Max 90 successor white sneakers | false | true | false | false | 2.38 |
| shoes-no-result | NO_RESULT | NO_RESULT | — | — | false | false | true | 2.074 |
| watches-known-exact | LIKELY | LIKELY | Casio F-91W-1 black watch | true | true | false | false | 12.699 |
| watches-difficult-lookalike | SIMILAR | NO_RESULT | — | — | false | false | true | 1.434 |
| watches-low-evidence | SIMILAR | SIMILAR | Casio F-91W-1 black watch | — | true | false | false | 1.964 |
| watches-multi-frame | LIKELY | LIKELY | Casio F-91W-1 black watch | true | true | false | false | 11.546 |
| watches-unavailable-vintage | SIMILAR | SIMILAR | Seiko SKX007 successor black watch | false | true | false | false | 2.19 |
| watches-no-result | NO_RESULT | NO_RESULT | — | — | false | false | true | 1.713 |
| bags_accessories-known-exact | LIKELY | LIKELY | Fjallraven 23510 black bag | true | true | false | false | 6.303 |
| bags_accessories-difficult-lookalike | SIMILAR | NO_RESULT | — | — | false | false | true | 1.447 |
| bags_accessories-low-evidence | SIMILAR | SIMILAR | Fjallraven 23510 black bag | — | true | false | false | 2.22 |
| bags_accessories-multi-frame | LIKELY | LIKELY | Fjallraven 23510 black bag | true | true | false | false | 5.971 |
| bags_accessories-unavailable-vintage | SIMILAR | SIMILAR | Coach 9966 successor brown bag | false | true | false | false | 3.28 |
| bags_accessories-no-result | NO_RESULT | NO_RESULT | — | — | false | false | true | 5.575 |
| other-known-exact | LIKELY | LIKELY | Anglepoise Type 75 black lamp | true | true | false | false | 3.407 |
| other-difficult-lookalike | SIMILAR | NO_RESULT | — | — | false | false | true | 1.898 |
| other-low-evidence | SIMILAR | SIMILAR | Anglepoise Type 75 black lamp | — | true | false | false | 2.125 |
| other-multi-frame | LIKELY | LIKELY | Anglepoise Type 75 black lamp | true | true | false | false | 7.175 |
| other-unavailable-vintage | SIMILAR | SIMILAR | Apple MC297 successor black music player | false | true | false | false | 2.403 |
| other-no-result | NO_RESULT | NO_RESULT | — | — | false | false | true | 2.74 |
