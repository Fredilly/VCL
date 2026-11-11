# Matching a click against the same-video roster (#426)

How a clicked crop becomes `EXACT`, `SIMILAR` or nothing when the video has a
partner roster. Intake of the roster itself is in `roster-intake.md`; replacing
seeds is in `roster-seed-replacement.md`.

## What was wrong

On the pinned 22-selection replay of the reference partner video the old rule
returned no roster-backed result at all (0 EXACT, 21 `incomplete_comparison`).
Four causes, each measured in the replay log:

1. **Coverage required certainty about every candidate.** A match was allowed
   only when the verifier reported confidence >= 0.90 on *all* roster
   candidates. It is routinely unsure about bags that are plainly not the one
   clicked (about 0.6 of 8 candidates reached 0.90), so nearly every click was
   "incomplete".
2. **Verifier batches were thrown away** when the model labelled its reading
   of the crop as `metadata` rather than `image`.
3. **The verifier repeated upstream guesses.** It was handed the first model's
   brand/model/colour/material guess and the page title, echoed them as its own
   reading of the crop, and then "contradicted" the correct candidate.
4. **Model names were compared as strings**, so "Side Trunk" contradicted
   "Side Trunk MM" and a listing code contradicted a name.

## The rule now

1. Every eligible roster candidate must have been **examined** (a valid
   comparison returned). Low confidence about a non-match no longer blocks.
2. Exactly one candidate must pass the unchanged strict check: similarity
   >= 0.90, confidence >= 0.90, a specific matching detail, no contradiction on
   subtype, colour, brand, model or material.
3. That candidate is only a **front-runner**. It is held outside `mapping`, so
   a caller that skips the next step has no match.
4. **Head-to-head round.** One more verifier call sees the crop, the
   front-runner and its (up to three) closest rivals, front-runner listed last.
   The front-runner must pass the strict check again and every rival must
   score at least 0.15 lower. Otherwise the result is `ambiguous`. No budget
   for the round means no EXACT.
5. If the original, stricter coverage rule is satisfied the decision is
   unchanged from before.

Candidates that are probable but unconfirmed (>= 0.80 / 0.80, a specific
detail, no contradiction, at most three) are returned as `SIMILAR` with
`identity_key: roster-candidate:<id>`. They are never labelled exact.

In roster rounds the verifier receives the crop and the kind of object only:
no brand, model, colour, material, search terms, page title or context from
the upstream model. On OpenRouter these rounds use schema-enforced output with
an image-only source block (falls back to JSON mode if the model rejects the
schema; `VERIFIER_STRUCTURED_OUTPUT=false` turns it off). **Open-web
verification is not changed**: same request, same schema, same acceptance.

## Measured (ten seeds, 22 pinned selections, CI replay)

| | before | after (run 1) | after (run 2) |
|---|---|---|---|
| EXACT | 0 | 5 | 5 |
| SIMILAR backed by a roster candidate | 0 | 9 | 9 |
| No roster-backed result | 22 | 8 | 8 |
| Head-to-head: confirmed / refused | n/a | 5 / 4 | 5 / 4 |
| Verifier batches discarded for source basis | 18 | 0 | 0 |
| Clicks blocked by provider rate limits | n/a | 0 | 0 |
| Latency p50 / p95 | 9.1 s / 18.3 s max | 11.5 s / 17.0 s | 16.9 s / 28.5 s |

Latency is measured on the CI worker with verifier concurrency 1 and 2.5 s
pacing between calls; it is comparable between rows, not to production.

Reproduce: Actions -> `pr-private-replay` -> ref = the PR branch,
`case_limit=22`, `confirm=LOCAL_REPLAY`. The job prints counts and roster
handles only. `baseline=true` replays the base commit for comparison.

## What this evidence does and does not show

- **Accuracy is not established by this table.** The reviewed labels are
  private and are not available to CI. The replay refuses to score against
  them automatically. Until the report artifact is scored against the
  labels, "zero false EXACT" is unverified for the new EXACT results.
- The only reference available in CI is which product the video is discussing
  at the click time. It is weak: three of the five EXACT results in run 1 fall
  inside the matching discussion window, two fall where no product is being
  discussed.
- The head-to-head round visibly prevents wrong answers: in run 1 a click
  during one product's segment first favoured a different candidate at
  0.90/0.90; the second look scored the discussed product 1.00 and the first
  choice 0.50, and the result was withheld.

## Limits

- **One reference image per family in the seeds.** Clicks on a colour or size
  the seed does not show are (correctly) refused with a colour contradiction.
  They need the variant roster from intake.
- **Two seeded families have no reference image** and can never match. Clicks
  in their segments can attract a `SIMILAR` suggestion for a different bag
  (five clicks in these runs). This is labelled similar, not exact.
- **Size is not checked from pixels.** Two sizes of one model with near-identical
  photos will tie in the head-to-head round and be refused, not told apart.
- **Repeatability.** Two consecutive runs of the same commit returned the same
  decision and the same scores on all 22 clicks (temperature 0, pixel-only
  input). Earlier runs that still passed upstream guesses to the verifier, or
  that hit provider rate limits, did vary.
- **Latency is slower and provider-dependent.** Same code, same decisions:
  p50 11.5 s in one run and 16.9 s in the next, against 9.1 s before. The
  added cost is the roster rounds no longer being cut short plus the extra
  head-to-head call.
- **One extra verifier call** on clicks that reach the head-to-head round
  (9 of 22). It draws on the existing per-click budget.
- Provider rate limiting (HTTP 429) removes comparisons and shows up as
  `incomplete_comparison`; the replay reports those clicks separately.

## Private full-variant replay (CI)

The public fixture is not the partner's full roster. To test the actual variants
without committing them, store the partner list in the existing private R2
bucket under `private-replay/` as a `.txt`, `.csv` or `.docx` object.
Configure Actions secrets `SCOOP_REPLAY_ROSTER_OBJECT_KEY` and
`SCOOP_REPLAY_ROSTER_SHA256` (lowercase SHA-256 of the original bytes).
The existing bucket-scoped replay R2 credentials are reused.

Run `pr-private-replay` with `intake_list=PRIVATE_R2`,
`ref=feat/roster-intake-messy-lists`, `case_limit=22` and
`confirm=LOCAL_REPLAY`. This downloads and checksum-verifies the private
list into the ephemeral runner, runs intake, supersedes the seeds only in the
local evaluation worker and replays the pinned clicks. It does not deploy.
Only the metadata-only replay report is uploaded; the source list and
intake reports are not artifacts.

This is **not a passing accuracy gate** until the replay is scored against
reviewed labels aligned to the new variant identities. Never mark zero false
EXACT from unlabeled replay counts. A fresh Golden browser run remains required.
