/**
 * Live probe: does the resolver identify a variant from its own product photo
 * when the whole partner roster is loaded?
 *
 *   node tools/roster-live-probe.mjs --endpoint http://127.0.0.1:8787 \
 *     --manifest "$RUNNER_TEMP/intake/manifest.json" --limit 6
 *
 * Ground truth is the variant whose photo was used as the click crop. This
 * measures identification, the family round and subrequest accounting with real
 * vision models. It is not the video-frame test: a clean product photo is an
 * easier crop than a paused frame, and this reports that difference rather than
 * hiding it.
 *
 * The roster belongs to a partner. Nothing printed here may contain a listing
 * link or a product title: handles, classes, reason codes and generic evidence
 * phrases only.
 */
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const endpoint = option('endpoint', 'http://127.0.0.1:8787');
const manifestPath = option('manifest');
const limit = Number(option('limit', '6'));
const outPath = option('out');
const timestamp = Number(option('timestamp', '0'));

if (!manifestPath) {
  console.error('Usage: node tools/roster-live-probe.mjs --manifest <intake/manifest.json> [--endpoint URL] [--limit N] [--out FILE]');
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const offers = (manifest.offers ?? []).filter((offer) => typeof offer.image_reference === 'string');
if (!offers.length) {
  console.error('No offers carry an image reference; intake did not resolve any variant photo.');
  process.exit(2);
}

// One variant per family first, so the probes are not all the same silhouette.
const byFamily = new Map();
for (const offer of offers) {
  const family = String(offer.family ?? offer.title ?? offer.variant_id);
  if (!byFamily.has(family)) byFamily.set(family, offer);
}
const probes = [...byFamily.values()].slice(0, limit);

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (value) => new Set(normalize(value).split(' ').filter((token) => token.length > 2));

async function dataUrlFor(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`image ${response.status}`);
  const type = response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${type};base64,${bytes.toString('base64')}`;
}

async function post(path, body) {
  const response = await fetch(new URL(path, endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-scoop-install-id': 'roster-live-probe' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const scrub = (text, offer) => {
  let value = String(text ?? '');
  for (const secret of [offer.title, offer.family, offer.merchant_item_id, offer.destination]) {
    if (secret && String(secret).length > 3) value = value.split(String(secret)).join('<expected>');
  }
  return value.slice(0, 160);
};

// Preferred path: ingest through the same endpoint production uses, so the
// worker stores the reference images the family round needs.
if (args.includes('--import')) {
  const credential = process.env.ADMIN_CREDENTIAL || 'roster-live-probe';
  const auth = await post('/admin/auth', { credential, label: 'roster-live-probe' });
  const session = auth.body.session_token ?? auth.body.token ?? auth.body.session?.token ?? null;
  if (auth.status !== 200 || !session) {
    console.error(`admin auth failed: ${auth.status} ${auth.body.error ?? ''}`);
    process.exit(2);
  }
  const imported = await fetch(new URL('/partner-roster', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-scoop-admin-session': session },
    body: JSON.stringify(manifest),
  });
  const body = await imported.json().catch(() => ({}));
  console.log(JSON.stringify({ import: { status: imported.status, ...body } }));
  if (imported.status !== 200) process.exit(2);
}

const rows = [];
for (const offer of probes) {
  const started = Date.now();
  try {
    const crop = await dataUrlFor(offer.image_reference);
    const analysed = await post('/analyze-selection', {
      dataUrl: crop,
      timestamp,
      context: { platform: manifest.platform, content_ref: manifest.content_ref, timestamp_ms: timestamp },
    });
    // The endpoint returns the description fields at the top level, not under a
    // `description` key.
    const description = analysed.body.description ?? (analysed.body.category || analysed.body.search_terms ? analysed.body : null);
    if (analysed.status !== 200 || !description) {
      rows.push({
        handle: offer.variant_id, stage: 'analyze', status: analysed.status,
        failure: analysed.body.error ?? 'no description', reason: analysed.body.reason ?? null,
        vision_routing: analysed.body.vision_routing ?? null,
      });
      continue;
    }
    const resolved = await post('/resolve-products', {
      description,
      source_image: crop,
      context: { platform: manifest.platform, content_ref: manifest.content_ref, timestamp_ms: timestamp },
    });
    const products = Array.isArray(resolved.body.products) ? resolved.body.products : [];
    const top = products[0] ?? null;
    const expectedTokens = tokens(`${offer.title} ${offer.family ?? ''}`);
    const topTokens = tokens(`${top?.title ?? ''} ${top?.model ?? ''}`);
    const shared = [...expectedTokens].filter((token) => topTokens.has(token)).length;
    const overlap = expectedTokens.size ? shared / expectedTokens.size : 0;
    rows.push({
      handle: offer.variant_id,
      expected_class: 'EXACT',
      status: resolved.status,
      returned: top ? { class: top.result_class ?? null, overlap: Number(overlap.toFixed(2)), id: top.id ?? null } : null,
      useful: Boolean(top) && overlap >= 0.6,
      class_useful: top ? ['EXACT', 'SIMILAR'].includes(top.result_class) : false,
      decision: resolved.body.verified_mapping?.same_video_reason ?? resolved.body.failure_state ?? null,
      hit: resolved.body.verified_mapping?.hit ?? null,
      retrieved: resolved.body.verified_mapping?.roster_retrieval?.retrieved_keys?.length ?? null,
      roster_count: resolved.body.verified_mapping?.roster_retrieval?.roster_count ?? null,
      family_stage: resolved.body.verified_mapping?.roster_retrieval?.family_stage ?? null,
      visual_failure_reasons: resolved.body.verified_mapping?.visual_failure_reasons ?? null,
      unexamined: resolved.body.verified_mapping?.roster_retrieval?.unresolved_keys?.length ?? null,
      subrequests: resolved.body.verified_mapping?.subrequests?.total ?? null,
      evidence: (top?.evidence ?? top?.matching_details ?? top?.verification_reasons ?? [])
        .slice(0, 3).map((item) => scrub(item, offer)),
      ms: Date.now() - started,
    });
  } catch (error) {
    rows.push({ handle: offer.variant_id, stage: 'probe', failure: error instanceof Error ? error.message : String(error) });
  }
}

const answered = rows.filter((row) => row.returned);
const useful = rows.filter((row) => row.useful);
const exact = rows.filter((row) => row.returned?.class === 'EXACT');
const summary = {
  probes: rows.length,
  answered: answered.length,
  useful_results: useful.length,
  useful_rate: rows.length ? Number((useful.length / rows.length).toFixed(2)) : 0,
  useful_rate_when_answered: answered.length ? Number((useful.length / answered.length).toFixed(2)) : 0,
  exact_rows: exact.length,
  wrong_exact: rows.filter((row) => row.returned?.class === 'EXACT' && !row.useful).length,
  subrequest_max: rows.reduce((max, row) => Math.max(max, row.subrequests ?? 0), 0),
  failures: rows.filter((row) => !row.useful).map((row) => ({ handle: row.handle, decision: row.decision ?? row.failure ?? null, stage: row.stage ?? 'resolve', retrieved: row.retrieved ?? null, unexamined: row.unexamined ?? null })),
};

console.log(JSON.stringify({ summary, cases: rows }, null, 1));
if (outPath) await writeFile(outPath, JSON.stringify({ summary, cases: rows }, null, 1));
process.exit(rows.length && useful.length === 0 ? 1 : 0);
