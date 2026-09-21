# Scoop alpha privacy notes

This document describes what the closed-alpha browser extension does with page and image data.

## What Scoop can access

Scoop's extension uses `activeTab` and `storage` browser permissions.

Its content script is limited to:
- `https://www.youtube.com/*`
- localhost / 127.0.0.1 development pages

The extension has network permission only for:
- `https://api.vcl.article6.org/*`

It does not request broad `<all_urls>`, browsing-history, cookies, downloads, or clipboard permissions.

`storage` is used only to persist one random anonymous alpha install ID so the API can enforce per-install usage limits. It is not used for browsing history, screenshots, product history, or page content.

## When capture happens

Capture is user initiated.

The normal flow is:

`invoke Scoop -> click an object -> preview crop -> Analyze`

Scoop does not continuously inspect video playback or collect background frames.

Nearby-frame analysis is a separate explicit action. If the user chooses it, Scoop may capture up to two nearby frames around the selected moment and then restores the original playback position where supported.

## What leaves the browser

For a normal Scoop request, the extension may send:
- the selected image crop,
- click/selection coordinates,
- video timestamp,
- a short page/video title,
- a coarse platform label such as `youtube`,
- derived object attributes used for product resolution.

The full page URL is not sent as commerce context.

A random anonymous install ID is sent in an API request header for alpha rate limiting. It is not tied to an account, email address, page URL, or viewing history.

For candidate verification, the selected crop may also be sent with the derived description so Scoop can compare candidate products against the selected object.

## What is not intentionally collected

Scoop does not intentionally collect or persist:
- continuous viewing history,
- full videos,
- account credentials,
- cookies,
- unrelated page contents,
- raw browsing history,
- protected-media archives.

Raw selected image bytes are intended for transient request processing, not permanent product storage.

## Logging

Production behavior must not log raw frame/image bytes, credentials, API keys, or full browsing URLs.

Operational logs may contain:
- request/error class,
- provider status,
- latency,
- cost/usage counters,
- non-sensitive routing diagnostics.

Debug provenance UI is disabled unless explicitly built with the debug flag.

## Third-party processing

Selected visual data can be processed by Scoop's configured model/provider path and commerce providers as required to resolve a product. Provider choice can change over time.

Scoop should send the minimum data needed for each request and keep providers replaceable.

## Alpha risks still remaining

Closed alpha still has these known privacy considerations:

1. A selected crop can contain people or background details near the object. Users should adjust the crop before analyzing.
2. The page/video title is sent because it can improve product context. It can sometimes contain information the user did not intend as product evidence.
3. Model and commerce providers receive request data needed for their stage of processing and are governed by their own service terms.
4. Nearby-frame analysis increases the amount of visual data processed, so it remains explicit rather than automatic.

These are alpha risks to monitor, not permission to expand collection silently.

## Guardrail

Any future change that adds broader host access, persistent screenshots, browsing-history collection, continuous capture, or new sensitive data must receive an explicit privacy review before alpha/public release.
