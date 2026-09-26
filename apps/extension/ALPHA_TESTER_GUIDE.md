# Scoop Alpha Tester Guide

Scoop helps you identify something you see in a supported online video and find useful purchase options.

## Install

Scoop alpha currently supports **Chrome and Brave**.

1. Download the `scoop-alpha-extension` ZIP from your invite.
2. Unzip it.
3. Open:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped Scoop extension folder.
7. Pin Scoop to the browser toolbar.

When a new alpha build is shared, replace the old folder and press **Reload** on the extensions page.

## Scoop an item

1. Open a supported YouTube video.
2. Pause on a clear view of the item.
3. Click the Scoop toolbar icon or press:
   - Mac: **Command + Shift + S**
   - Windows/Linux: **Ctrl + Shift + S**
4. Click the item you want.
5. Use **− Tighter** or **+ Wider** so the whole object is visible.
6. Press **Analyze**.
7. Review the product results.
8. Use **thumbs up/down** on the result. Your feedback is saved and helps Scoop learn which mappings are useful or wrong.

## What to expect

Alpha results can take several seconds.

You may see:
- **Results** — Scoop found useful candidates.
- **No useful product candidates returned** — Scoop understood the item but could not find a safe match.
- **Scoop is temporarily unavailable** — a model or shopping provider is down, busy, rate-limited, or out of quota. Try again later.
- **Adjust the crop and try again** — Scoop could not confidently use the current selection.

Scoop prefers returning no result over confidently returning the wrong product.

## Reporting a bad result

Use thumbs down first.

If the problem needs explanation, send:
- a screenshot of the selected crop and result;
- what you clicked;
- what Scoop said it was;
- what you believe it actually was;
- whether the problem was **wrong item**, **wrong category**, **bad match**, **no useful result**, or **too slow**.

Do not send passwords, private messages, account details, or anything unrelated to the selected item.

## Known alpha limitations

- YouTube is the main supported surface.
- Small, partly hidden, blurry, or fast-moving objects are harder.
- Brand/model identification can be wrong when logos or distinctive details are not visible.
- Product availability and price can vary by region.
- Some protected video cannot be captured by the browser.
- Scoop is not continuously scanning your viewing activity.

## Privacy

Capture only happens after you invoke Scoop and select an item.

Scoop does not intentionally collect continuous browsing history, cookies, credentials, or full videos. See `ALPHA_PRIVACY.md` for the full alpha privacy notes.
