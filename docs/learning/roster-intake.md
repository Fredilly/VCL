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

# A Word / Google Docs list that names its own video, checked from this machine
# with no API session or provider keys
pnpm roster:intake Bagholic.docx --local

# Just read the list and show its structure; fetch nothing
pnpm roster:intake Bagholic.docx --parse-only
```

The video argument is optional when the list opens with the video link. `--local` runs the same parse → resolve → manifest steps in-process: seller pages and images are fetched from this machine (a home connection is refused far less often than a datacenter), with no marketplace search. `--import` always needs the API.

`--brand` and `--object-type` are optional defaults for rows that don't name their own. Anything the list states wins.

## Accepted input

Anything in one file (or `-` for stdin), including a `.docx` (Word or a Google Docs download) read directly:

- an **outline**: numbered products, variant notes under each, seller links under each note (see below);
- a pasted YouTube description with chapter times, links, prices and social links mixed in;
- free-form notes, one product per line, with a link on the next line;
- CSV/TSV exports with any common headers (`Product Name`, `Style Code`, `Seller Link`, `Image`, `Time`, ...); exports with unrecognised headers are still read row by row as free text, so codes, prices and links survive;
- JSON (`[...]`, `{ "products": [...] }`, or one nested wrapper such as `{ "data": { "items": [...] } }`);
- a bare list of seller links.

Social/music links are ignored. Intro/chapter rows (`0:00 Intro`, `Giveaway`) and intro lines above a numbered list are treated as preamble. Duplicate SKUs/GTINs — or the same first link — merge. Chapter times become candidate windows that run to the next listed product; they are retrieval hints, never proof of appearance.

## Outlines: one roster row per variant

The list a person makes with a video in one tab and a browser in the other looks like this:

```
LV SKU FOR https://www.youtube.com/watch?v=...

3. Louis Vuitton Neverfull Tote
Flower floral variant
https://seller-a/...        https://seller-b/...
Variant with black badge
https://brand-site/.../M28347
louis vuitton neverfull tote bag shearling
Couldn't find it online
```

Read line by line that is forty "products" called `Black variant` and `Couldn't find it online`. Read as an outline it is what the partner meant: the thing a viewer clicks is the **variant** (family + note), and every link under the note is a place to buy that variant. Intake switches to outline reading when a list has numbered (or `#`) headings without links and at least one note sitting between a heading and its links; everything else keeps the line-by-line reader.

- One row per variant: `Neverfull Tote - Flower floral`, with its links as offers and each listing's own photo as a reference image. One identity with several real photos is what the verifier can match; one identity per listing is a pile of indistinguishable siblings it has to abstain on.
- The brand is read from the headings when most of them start with the same two words; `--brand` overrides.
- Search-results links, the video link, social links and repeated links are not offers. Tracking parameters are dropped; variant selectors (`?variant=`) are kept; an eBay link is reduced to its item id.
- Side remarks are kept as review flags, never as products: "not sure about this link" holds the variant for review; "couldn't find it online" records a variant that is in the video but has no listing yet.
- **Mixed notes are split.** When the links under one note state different sizes (`20`, `40`, `PM`, `MM`), each size is its own variant (`Speedy - Red 20`, `Speedy - Red 40`). Links that do not say which size they are wait in a `(size unstated)` row that is held for review; they are never guessed into a size. The same applies to colours when the note names none.
- **Contradicting links are set aside.** A listing whose own name does not mention the family (a Pochette Métis filed under Trunkie), or states a colour the note rules out (note says black, listing says white), is not an offer and its photo is not a reference. It is listed in the review with the reason. The same test runs again on the seller page once it is read: other product, other brand, other colour, other size.

### Identity for a variant

Strongest first:

1. a SKU/GTIN the partner wrote next to the variant;
2. a manufacturer code stated by **every** link of the variant (`.../M28347`, `lv-m25669`);
3. otherwise a **video-local** id, `VR-<video>-<section>-<variant>`. It means "the thing this partner calls X in this video". It joins only the links the partner put under that variant, never searches marketplaces by code, and can never match another video or another catalog.

A video-local id is a scoped candidate identity, not a SKU, and the code keeps it that way end to end:

- the import manifest sends it as `variant_id` with `identity_scope: "video_local"`, never in `sku`; the importer refuses one sent as a SKU, undeclared, or attached to a different video;
- the resolver never resolves it from text, never sends it to a merchant as a query or model, never shows it as a model number, and never offers it as a cross-video candidate;
- a matched result is keyed `video-local:…` and says "partner-listed variant for this video", not "verified SKU";
- it still has to win the same-video visual verifier like any other roster candidate.

A code that only some links state is shown as a suggestion and not applied. A reseller's page SKU is normally its own stock number (the id in its URL); that is recorded per offer and is not treated as contradicting anything. Writing the real code next to the variant upgrades the row.

### What counts as an offer

A listing becomes a purchasable offer only when the seller says it can be bought now: the page was read and states `InStock` (or limited / online-only availability), or the listing came from a live marketplace inventory search. Everything else is not an offer:

- 404/410: the link is dropped with a note;
- sold out / out of stock: kept as a reference photo, never imported;
- blocked, unreachable, or a page that states no availability: `unconfirmed`, not imported.

A variant with no confirmed offer is `NEEDS_REVIEW`, not READY.

## Any brand, any category

- SKUs are recognised as labelled codes (`SKU:`, `Style No`, `MPN`, ...), as letter+digit tokens (`M46977`, `DD1391-100`, `KHMA050113-001`) or as all-digit article numbers (7–11 digits; 12–14 digits are read as GTIN/UPC/EAN).
- Product type uses the shared evidence taxonomy first (shirt, dress, shoes, bag, ...), then an intake-local list for common categories it does not model (cap, scarf, belt, wallet, jewelry, furniture, headphones, ...). If the type is still ambiguous, pass `--object-type` or add a `Type` column; the seller page's markup can also fill it.
- Prices are stripped from titles across common symbols (`$ £ € ¥ ₹ ₩ ...`) and ISO codes (`USD GBP EUR INR SEK ...`), including `1.299,00 €` and `GBP 89.99`.
- Video references can be a YouTube URL/ID, any public video URL (the host becomes the platform), or a bare id with `--platform`-style defaults via the API.
- No search result is treated as this product unless its listing carries the same SKU/GTIN. Category inference never upgrades a row to READY.

## What makes a row READY

| Needed | Where it can come from |
|---|---|
| Identity (SKU / style code / GTIN, or a video-local variant id for outlines) | partner's list, the partner's links, or the seller page's product markup |
| Brand, title, product type | list, `--brand` / `--object-type`, or seller page |
| At least one purchasable offer | partner's seller link, or a marketplace listing (eBay, SerpAPI, Brave) **carrying the same SKU** |
| Reference image that actually downloads | list, seller page, or a SKU-matched listing |

Everything else is `NEEDS_REVIEW` (with the reason and what to ask the partner for) or `UNRESOLVED`. Nothing is guessed.

A video that already has hand-seeded rows gets a `seed-replacement-plan.json`: which seeds the READY variants would replace, on what basis, with no duplicates and no seed retired without a replacement. See [roster-seed-replacement.md](roster-seed-replacement.md).

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

- `review.md` — products on a page (grouped by family for outlines): status, identity, offers, image, and a "Needs attention" list to send back to the partner;
- `roster.csv` — the cleaned roster as a spreadsheet. Fix a name, add a code or drop a link there and feed the CSV back into intake; what the sheet states wins and video-local ids are preserved;
- `manifest.json` — READY rows in the `/partner-roster` import format;
- `report.json` — full per-product detail.

`--import` sends READY rows through the existing strict `/partner-roster` importer in batches of 6. The importer re-validates every row and caches the reference image in Product Memory. Roster membership is candidate evidence only: EXACT still requires the visual verifier on the viewer's selected frame.

## API

Admin-only `POST /roster-intake` with `action`:

- `parse` — `{ video?, list, defaults }` → `{ video, items, warnings, layout }` (`video` may be omitted when the list names it)
- `resolve` — `{ video, items }` (max 8 per call) → `{ items }` with status, offers, verified image, proposals, lookalikes
- `manifest` — `{ video, items, warnings }` → `{ summary, manifest, review_markdown, roster_csv }`

The CLI drives these in order, keeping each resolve call to at most 8 products and 16 links. Resolve spends merchant search quota only for products missing an offer or an image.
