# Roster intake harness

Turn whatever a partner sends about a video's products into an import-ready roster, so viewers' clicks are verified against real SKUs instead of relying on the vision model's guess. No brand, category or video platform is assumed.

```bash
# Handbags on YouTube
SCOOP_API_URL=https://api.vcl.article6.org SCOOP_ADMIN_SESSION=... \
  pnpm roster:intake https://youtu.be/n9u8ynhBdSo partner-list.txt --brand "Louis Vuitton"

# Sneakers on Vimeo; no brand default, types come from the list
SCOOP_API_URL=https://api.vcl.article6.org SCOOP_ADMIN_SESSION=... \
  pnpm roster:intake https://vimeo.com/123456789 sneaker-drop.csv

# Review roster-intake/<video>/review.md, then re-run with --import
```

`--brand` and `--object-type` are optional defaults for rows that don't name their own. Anything the list states wins.

## Accepted input

Anything in one file (or `-` for stdin):

- a pasted YouTube description with chapter times, links, prices and social links mixed in;
- free-form notes, one product per line, with a link on the next line;
- CSV/TSV exports with any common headers (`Product Name`, `Style Code`, `Seller Link`, `Image`, `Time`, ...); exports with unrecognised headers are still read row by row as free text, so codes, prices and links survive;
- JSON (`[...]`, `{ "products": [...] }`, or one nested wrapper such as `{ "data": { "items": [...] } }`);
- a bare list of seller links.

Social/music links are ignored. Intro/chapter rows (`0:00 Intro`, `Giveaway`) and intro lines above a numbered list are treated as preamble. Duplicate SKUs/GTINs — or the same first link — merge. Chapter times become candidate windows that run to the next listed product; they are retrieval hints, never proof of appearance.

## Any brand, any category

- SKUs are recognised as labelled codes (`SKU:`, `Style No`, `MPN`, ...), as letter+digit tokens (`M46977`, `DD1391-100`, `KHMA050113-001`) or as all-digit article numbers (7–11 digits; 12–14 digits are read as GTIN/UPC/EAN).
- Product type uses the shared evidence taxonomy first (shirt, dress, shoes, bag, ...), then an intake-local list for common categories it does not model (cap, scarf, belt, wallet, jewelry, furniture, headphones, ...). If the type is still ambiguous, pass `--object-type` or add a `Type` column; the seller page's markup can also fill it.
- Prices are stripped from titles across common symbols (`$ £ € ¥ ₹ ₩ ...`) and ISO codes (`USD GBP EUR INR SEK ...`), including `1.299,00 €` and `GBP 89.99`.
- Video references can be a YouTube URL/ID, any public video URL (the host becomes the platform), or a bare id with `--platform`-style defaults via the API.
- No search result is treated as this product unless its listing carries the same SKU/GTIN. Category inference never upgrades a row to READY.

## What makes a row READY

| Needed | Where it can come from |
|---|---|
| SKU / style code / GTIN | partner's list, or the seller page's product markup |
| Brand, title, product type | list, `--brand` / `--object-type`, or seller page |
| At least one purchasable offer | partner's seller link, or a marketplace listing (eBay, SerpAPI, Brave) **carrying the same SKU** |
| Reference image that actually downloads | list, seller page, or a SKU-matched listing |

Everything else is `NEEDS_REVIEW` (with the reason and what to ask the partner for) or `UNRESOLVED`. Nothing is guessed.

Known limits, deliberately fail-closed:

- style codes shorter than 5 characters, or codes made only of letters, need a `SKU:` label or a seller page that states them; they are not guessed from bare text;
- a name-only list with no links, codes or seller pages stays `NEEDS_REVIEW`;
- a bare 7–11 digit number is treated as an article number, so a phone/order number in the same line would be misread as a SKU — review catches it because no matching offer will exist.

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
