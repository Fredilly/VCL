# Spike 6 — YouTube Platform Robustness

Status: IN PROGRESS
Issue: #37

## Question

How brittle is the existing Scoop interaction across common YouTube player states?

This spike tests the shipped interaction. It is not permission to add speculative platform code, redesign the UI, tune product matching, change providers, or expand scope.

## Test matrix

Test the existing end-to-end flow on:

| State | Capture | Selection / localization | Object understanding | Result panel | Close / reset / playback | Classification | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Normal video | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| Theater mode | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| Fullscreen | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| Player resize | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| SPA navigation without full reload | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| Post-ad / ad transition where practical | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |
| Shorts where feasible | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | |

Allowed state classifications:

- `SUPPORTED` — the core flow works without a platform-specific user-visible failure.
- `DEGRADED` — the flow remains usable, but a reproducible YouTube-state limitation exists.
- `UNSUPPORTED` — the flow cannot complete through the permitted path.

Provider throttling or temporary model/catalog failure must be recorded separately as `PROVIDER_BLOCKED`; it is not evidence of a YouTube platform regression.

## Procedure

For each practical state:

1. Use a Golden case where possible so object/product expectations are already frozen.
2. Enter the target YouTube state before invoking Scoop.
3. Run the normal user flow without special recovery steps.
4. Record capture, selection/localization, object understanding, result rendering, and close/reset/playback behavior.
5. If a failure occurs, reproduce it before changing code.
6. If the failure is provider-side, record `PROVIDER_BLOCKED` and do not patch platform code.
7. If the failure is platform-state-specific and reproducible, make the smallest adapter-boundary fix possible.
8. After any code change touching capture, selection, localization, vision, or result behavior, rerun the Golden regression suite and add a new immutable run.

## Guardrails

- Keep YouTube-specific behavior behind the platform adapter boundary.
- Do not rely on undocumented player internals when an existing supported path works.
- Do not alter or obscure native YouTube controls or native Shopping.
- Do not bypass DRM, browser security controls, protected rendering, or capture restrictions.
- Do not add special-case code merely to make one test state pass.
- Do not change identity/relevance thresholds, commerce routing, provider priority, or model selection in this spike unless a separate measured defect requires its own issue.
- Do not weaken graceful unsupported behavior to increase nominal coverage.

## Acceptance

Spike 6 passes when:

1. Every practical test state above has recorded evidence.
2. Each state is classified `SUPPORTED`, `DEGRADED`, or `UNSUPPORTED`.
3. Reproducible YouTube-specific failures are fixed narrowly or explicitly documented as degraded/unsupported.
4. Normal-video Golden behavior does not regress.
5. If code changes are made, `pnpm check`, `pnpm build`, and relevant tests pass.
6. The final record states whether the existing YouTube adapter boundary is adequate for external alpha.

## Stop rule

Do not continue platform hardening merely because a theoretical edge case exists. Fix observed failures that affect the intended alpha flow, document the rest, and move on.
