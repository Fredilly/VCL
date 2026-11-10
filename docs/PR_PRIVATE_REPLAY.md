# PR-only private replay

Validate a pull-request branch against the private Handbagholic HAR **without
deploying and without touching production traffic or Product Memory**.

This is a resolver replay of recorded object descriptions and source crops. It
does **not** re-run vision or localization, and it is **not** a Golden run.

## What exists today

| Need | Existing mechanism |
| --- | --- |
| Worker runtime credentials (vision, commerce, signing) | Cloudflare Worker secrets, registered in `apps/api/secrets.registry.json`; managed with `pnpm secret:add <NAME>` and inspected with `pnpm secrets:check`. Wrangler secrets are write-only, so they cannot be read back into CI. |
| Private replay HARs | R2 bucket `scoop-private-replays`, `private-replay/*.har`, read with a **bucket-scoped** R2 token: `SCOOP_REPLAY_R2_ACCESS_KEY_ID`, `SCOOP_REPLAY_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_ACCOUNT_ID`, plus a checksum-pinned `SCOOP_REPLAY_HAR_SHA256` and `SCOOP_REPLAY_HAR_OBJECT_KEY`. |
| Production replay | `.github/workflows/private-har-replay.yml` (manual). It targets the production endpoint and is not a PR gate. |
| PR-only replay | `.github/workflows/pr-private-replay.yml` (manual). Runs the branch in a throwaway local `wrangler dev` worker on the CI runner and replays against `http://localhost:8787/resolve-products`. |
| Scoring | `tools/replay-scoop-har-resolver.mjs` (replay), `tools/score-reviewed-replay.mjs` (reviewed labels). |

The PR-only workflow fails closed:

- the endpoint must be exactly `http://localhost:8787/resolve-products`;
- no step runs `wrangler deploy` (guarded in the workflow itself);
- it refuses to start without a vision credential and a commerce credential;
- the HAR is checksum-verified, written `0600`, and deleted in an `always()` step;
- the uploaded report is metadata only (no frame pixels, no HAR contents).

## How to run it

1. Actions → **PR-only private replay (local worker)** → *Run workflow*.
2. `ref`: the PR branch (for example `fix/handbagholic-roster-reference-images`).
3. `case_limit`: start at `3`, then `10`, then the full `38`.
4. `confirm`: type `LOCAL_REPLAY`.

Required GitHub repository/environment secrets (same names as the runtime
registry):

- `SCOOP_REPLAY_R2_ACCESS_KEY_ID`, `SCOOP_REPLAY_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_ACCOUNT_ID`, `SCOOP_REPLAY_HAR_SHA256`, `SCOOP_REPLAY_HAR_OBJECT_KEY`
- `OPENROUTER_API_KEY` or `GEMINI_API_KEY`
- `BRAVE_SEARCH_API_KEY` or `SERPAPI_API_KEY`

Nothing is requested in chat and no secret is committed. If a provider key is
missing the job stops before making a paid call.

## Known limits

- `wrangler dev` needs workerd, which requires macOS 13.5+ or Linux. This
  workstation (macOS 12.6) cannot run it, so the local replay must run on the
  Ubuntu CI runner.
- The replay tool accepts `https://` or `http://localhost` only; `127.0.0.1` is
  rejected on purpose.
- The replay reuses the recorded request body, so it measures resolver behaviour,
  not current capture/vision quality.
- `acceptance.status` will be `UNLABELED_NO_ACCURACY_CLAIM` until reviewed labels
  exist. `BLOCKED_MISSING_VISUAL_EVIDENCE` means roster SKUs still lack loadable
  pixels.

## Gate

Do not claim live accuracy improvement and do not merge a perception/identity
change until both exist:

1. the 36-selection replay against reviewed ground truth (correct matches, false
   EXACT, NONE recall, latency vs baseline), and
2. a recorded Golden run under `tests/golden/runs/`.

Until then, PR #422 stays in draft.
