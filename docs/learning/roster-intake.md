# Roster intake harness

Turn whatever a partner sends about a video's products into an import-ready roster, so viewers' clicks are verified against real SKUs instead of relying on the vision model's guess.

```bash
SCOOP_API_URL=https://api.vcl.article6.org SCOOP_ADMIN_SESSION=... \
  pnpm roster:intake https://youtu.be/n9u8ynhBdSo partner-list.txt --brand "Louis Vuitton" --object-type bag
# review roster-intake/n9u8ynhBdSo/review.md, then re-run with --import
```

## Accepted input

Anything in one file (or `-` for stdin):

- a pasted YouTube description with chapter times, links, prices and social links mixed in;
- free-form notes, one product per line, with a link on the next line;
- CSV/TSV exports with any common headers (`Product Name`, `Style Code`, `Seller Link`, `Image`, `Time`, ...);
- JSON (`[...]` or `{ "products": [...] }`);
- a bare list of seller links.

Social/music links are ignored. Intro lines before the first structured product line are treated as preamble. Duplicate SKUs merge. Chapter times become candidate windows that run to the next listed product; they are retrieval hints, never proof of appearance.

## What makes a row READY

| Needed | Where it can come from |
|---|---|
| SKU / style code / GTIN | partner's list, or the seller page's product markup |
| Brand, title, product type | list, `--brand` / `--object-type`, or seller page |
| At least one purchasable offer | partner's seller link, or a marketplace listing (eBay, SerpAPI, Brave) **carrying the same SKU** |
| Reference image that actually downloads | list, seller page, or a SKU-matched listing |

Everything else is `NEEDS_REVIEW` (with the reason and what to ask the partner for) or `UNRESOLVED`. Nothing is guessed:

- Search hits that only look similar are shown as lookalikes and never imported.
- With no SKU, codes that independent listings agree on are **proposed** for a human to confirm, never imported automatically.
- A SKU read off one merchant's page stays namespaced to that merchant (same rule as the importer). Other sellers carrying the same code are listed for confirmation; add the code to the list to join them.
- A seller page whose SKU contradicts the partner's SKU is not used.
- Etsy is excluded as a source (its API data must not become permanent catalog assets).

## Output

`roster-intake/<video>/` (git-ignored):

- `review.md` — products on a page: status, SKU, offers, image, and a "Needs attention" list to send back to the partner;
- `manifest.json` — READY rows in the `/partner-roster` import format;
- `report.json` — full per-product detail.

`--import` sends READY rows through the existing strict `/partner-roster` importer in batches of 6. The importer re-validates every row and caches the reference image in Product Memory. Roster membership is candidate evidence only: EXACT still requires the visual verifier on the viewer's selected frame.

## API

Admin-only `POST /roster-intake` with `action`:

- `parse` — `{ video, list, defaults }` → `{ video, items, warnings }`
- `resolve` — `{ video, items }` (max 8 per call) → `{ items }` with status, offers, verified image, proposals, lookalikes
- `manifest` — `{ video, items, warnings }` → `{ summary, manifest, review_markdown }`

The CLI drives these in order. Resolve spends merchant search quota only for products missing an offer or an image.
