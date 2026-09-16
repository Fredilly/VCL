# Spike 6 manual robustness run

Use `project-system/SPIKE_6_YOUTUBE_ROBUSTNESS.md` as the protocol.

Record one row per tested YouTube state. Do not change Golden case inputs to make a platform state pass.

| State | Golden case / URL | Capture | Selection | Vision | Results | Close/reset/playback | Classification | Failure class | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Normal video | | | | | | | | | |
| Theater mode | | | | | | | | | |
| Fullscreen | | | | | | | | | |
| Player resize | | | | | | | | | |
| SPA navigation | | | | | | | | | |
| Post-ad / ad transition | | | | | | | | | |
| Shorts | | | | | | | | | |

Failure classes:
- `NONE`
- `PROVIDER_BLOCKED`
- `CAPTURE_FAIL`
- `SELECTION_FAIL`
- `LOCALIZATION_FAIL`
- `VISION_FAIL`
- `RESULT_UI_FAIL`
- `PLAYBACK_RESET_FAIL`
- `OTHER_PLATFORM_FAIL`

Final decision:
- YouTube adapter adequate for external alpha: `YES / NO`
- Blocking states:
- Deferred degraded/unsupported states:
- Code changes made:
- Golden rerun required: `YES / NO`
- Golden rerun evidence file:
