# Spike 5 end-to-end manual validation

## Corpus versions

| File | Purpose | Status |
|------|---------|--------|
| `cases.json` | Original frozen historical corpus (10 cases) | Frozen — never edited |
| `cases-corrected.json` | First coordinate correction (s5-05 only) | Historical — kept for auditability |
| `cases-v2.json` | **Current Golden regression corpus** | Active — run this for Golden gate |

### What changed in v2

- **s5-05**: Keeps corrected coordinates from cases-corrected.json (0.3, 0.4).
- **s5-08**: Timestamp corrected from 80s to 90s. The original 80s frame showed a sponsor segment, not the Adidas Samba target. 90s was manually verified on 2026-09-18.
- **s5-10**: Marked `valid: false`. The original 60s frame does not contain a usable desk-lamp component. Pending a separately verified replacement timestamp.

### Rules for corpus changes

- Frozen source files (`cases.json`, `cases-corrected.json`) are never silently edited.
- Invalid/stale cases are excluded from the pass-rate denominator.
- Corrected timestamps require manual visual confirmation of the video frame.
- No case may be changed in response to Scoop classification quality alone.

## Running the Golden gate

Run only **valid v2 cases**. Invalid cases (e.g., s5-10) must be reported as `INVALID_FIXTURE`, not PASS or FAIL.

```
Golden gate = valid cases attempted / valid cases total
```

A case passes if it produces a commercially useful result or a truthful low-confidence/no-result state. A case fails only on false `EXACT`, unsupported `LIKELY`, or a regression attributable to the code change under test.

## Protocol

Run the dedicated Chrome profile with the built unpacked extension, then collect
the UI result for each frozen row. `results.json` records only derived results:
no video-frame bytes, request bodies, or credentials.

Stage timing is recorded where observable from the extension UI. The Worker
currently exposes retrieval and candidate verification as one commerce latency,
so the report does not invent a separate verification duration.
