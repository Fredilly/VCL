# Replacing hand-seeded roster rows with an intake roster

The Handbagholic video (`n9u8ynhBdSo`) has 10 rows in `alpha-verified-product-seeds.ts`, written by hand, one per product family. Roster intake produces one row per variant for the same video. This is how the second set takes over from the first without two rows competing for the same click and without losing what the seeds carry.

## What must not happen

- **Duplicate active candidates.** A family seed and a variant of the same bag are near-identical siblings. The verifier abstains between those.
- **A hole.** Deleting the seeds first removes coverage wherever the new roster has nothing READY.
- **Lost lineage.** A seed has a canonical key, a discussion window and trusted observations. Deleting the row loses the link between the old identity and its replacement.

## Mechanism

1. **Per seed, by name.** A replacing row lists the seed's `product_id` in `supersedes`. The resolver removes a seed from the active candidates only while a row naming it is active (`supersededProductIds` / `withoutSuperseded` in `partner-roster.ts`). Rows with no `supersedes` change nothing.
2. **Only READY variants replace.** A seed with no READY replacement stays active. Coverage can only stay equal or improve.
3. **Nothing is deleted.** The seed stays in the seeds file with its canonical key, window and observations. Remove the replacement and the seed is active again on the next request. Rollback is deleting rows, not restoring data.
4. **Same content only.** A row can supersede rows of its own platform + video, nothing else. A row without loadable reference pixels (`pending_partner_image`) cannot supersede anything.
5. **Lineage is written down.** The plan records, per seed: its canonical key, the basis of the match and the variant ids that take over. Each replacing row carries the seed's `product_id`. A replacement inherits the seed's discussion window (a retrieval prior). It does **not** inherit the seed's trusted observations: copying those is an identity merge and is left as a separate, explicit step.

## The plan

`pnpm roster:intake <list> --local` writes `seed-replacement-plan.json` next to the review whenever the video has seeds. One entry per seed:

| Basis | Meaning | Sign-off |
|---|---|---|
| `same_listing` | a variant contains the seed's own listing | evidence, no judgement |
| `same_code` | a variant carries the seed's manufacturer code | evidence, no judgement |
| `family` | same model name only; every READY variant of the family takes over | **needs a reviewer** |
| `none` | the list has nothing for this seed; it stays | — |

`action` is `supersede` only when at least one replacing variant is READY, otherwise `keep_seed`. The summary states how many candidates are active afterwards and that `duplicates_after` is 0.

The plan is always written as `DRAFT_NOT_APPROVED`. `rosterMappingsWithPlan` adds `supersedes` to rows only for an `APPROVED` plan. The one exception is `--evaluation-roster`, which applies the draft so an isolated local replay worker can measure the replacement before anyone approves it. That file must never be given to a deployed worker.

## Rollout order

1. Run intake live; read `review.md` and the plan.
2. Replay the benchmark against the evaluation roster in the local worker (`pr-private-replay.yml` with `intake_list`). Compare with the seeds-only replay of the same cases.
3. A reviewer signs the plan (sets `status: APPROVED`, `approved_by`), striking any `family` entry they do not accept.
4. Import the READY rows with `supersedes` (`/partner-roster` accepts the field). From that request on the named seeds are inactive for this video.
5. Later, in a separate change, delete seeds that have stayed superseded. Not before.

## What is not solved here

- **Durable Product Memory.** If a seed's listing was ever promoted into the durable ledger, that listing is owned by an existing canonical identity. Importing a variant that contains the same listing under a different variant id is refused by the ledger (`Merchant offer already belongs to a different variant`). That is the correct refusal; resolving it needs a decision per listing and has not been exercised against production data.
- **Observations.** Seed observations are not moved onto replacements (see 5 above).
