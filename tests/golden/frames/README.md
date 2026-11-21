# Golden frames

The automated Golden identity run (`tools/golden-identity.mjs`, workflow
`golden-identity.yml`) reads one frozen frame per case from this directory:

```
tests/golden/frames/golden-001-billions-tie.jpg
tests/golden/frames/golden-002-casio-f91w.jpg
...
```

One JPEG per `id` in `../cases.json`, at the exact `url_at_time`. The frame is the
input; nothing here changes what a case expects.

## Why frames are supplied rather than fetched

YouTube refuses datacenter IPs (`Sign in to confirm you're not a bot`) and the
workaround is session cookies, which are credentials this repository's automation
must not handle. Committing the frozen frame keeps the run reproducible and
credential-free.

## How to capture one

1. Open the case's `url_at_time` in a signed-in browser.
2. Pause on that frame.
3. Screenshot the video area only (no player chrome, no browser UI).
4. Save as `tests/golden/frames/<case id>.jpg`, keep it under ~200 KB.
5. Do not crop to the target object: this run measures object identity, not
   localisation.

A case with no frame is recorded `BLOCKED_NO_FRAME` — neither a pass nor a
product failure. It never silently disappears from the run.
