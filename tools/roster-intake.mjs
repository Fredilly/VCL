import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readListFile } from './roster-list-file.mjs';

/**
 * Turn a partner's product list for one video into an import-ready roster.
 *
 *   node tools/roster-intake.mjs [video-url-or-id] <list-file> [options]
 *
 * Works for any brand, category and video host; nothing is handbag- or
 * YouTube-specific.
 *
 * <list-file> can be anything the partner sent: a Word/Google Docs .docx, a
 * pasted YouTube description, notes, an outline of products with variant notes
 * and links under each, CSV/TSV export, JSON, or a list of seller links.
 * Use "-" for stdin. The video can be left out when the list names it.
 *
 * Options:
 *   --brand "Louis Vuitton"   optional default brand for rows that don't name one
 *   --object-type bag         optional default type for rows that don't imply one
 *   --out <dir>               output folder (default: roster-intake/<video>)
 *   --local                   run on this machine: reads seller pages and images
 *                             directly, no API session or provider keys needed
 *                             (no marketplace search)
 *   --parse-only              structure only: read the list, fetch nothing
 *   --import                  import READY rows into the video's roster afterwards
 *   --evaluation-roster       (with --local) also write evaluation-roster.json: the READY
 *                             rows as resolver mappings with the draft seed-replacement plan
 *                             applied. For an isolated replay worker only; never production.
 *
 * Writes review.md (products on a page), roster.csv (editable, can be fed back
 * in), report.json and manifest.json.
 * Without --local/--parse-only, requires SCOOP_API_URL (https) and
 * SCOOP_ADMIN_SESSION; --import always does.
 */

const RESOLVE_BATCH = 8;
// One resolve call reads every link of every product in it. Keep the total
// well inside a Worker invocation's subrequest budget.
const RESOLVE_LINK_BUDGET = 16;
const IMPORT_BATCH = 6;
const USAGE = 'Usage: node tools/roster-intake.mjs [video-url-or-id] <list-file|-> [--brand X] [--object-type TYPE] [--out dir] [--local] [--parse-only] [--import] [--evaluation-roster]';

export function parseArgs(argv) {
  const options = { brand: null, objectType: null, out: null, import: false, local: false, parseOnly: false, evaluationRoster: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--brand') options.brand = argv[++i] ?? null;
    else if (arg === '--object-type') options.objectType = argv[++i] ?? null;
    else if (arg === '--out') options.out = argv[++i] ?? null;
    else if (arg === '--import') options.import = true;
    else if (arg === '--local') options.local = true;
    else if (arg === '--parse-only') options.parseOnly = true;
    else if (arg === '--evaluation-roster') options.evaluationRoster = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else options.positional.push(arg);
  }
  if (!options.positional.length || options.positional.length > 2) throw new Error(USAGE);
  // One argument is the list; the video is then read from the list itself.
  const [video, listFile] = options.positional.length === 2 ? options.positional : [null, options.positional[0]];
  return { ...options, video, listFile };
}

export function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

/** Batches of at most `size` products whose links together stay within `linkBudget`. */
export function chunkByLinks(items, size = RESOLVE_BATCH, linkBudget = RESOLVE_LINK_BUDGET) {
  const batches = [];
  let batch = [];
  let links = 0;
  for (const item of items) {
    const weight = Math.max(1, item.urls?.length ?? 0);
    if (batch.length && (batch.length >= size || links + weight > linkBudget)) { batches.push(batch); batch = []; links = 0; }
    batch.push(item);
    links += weight;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function runRosterIntake({ video, list, defaults = {}, importReady = false, post, importPost = post }) {
  const parsed = await post('/roster-intake', { action: 'parse', video, list, defaults });
  // The list may name its own video; from here on use what the parser settled on.
  const videoRef = video ?? parsed.video?.content_ref;
  const resolved = [];
  for (const items of chunkByLinks(parsed.items)) {
    const batch = await post('/roster-intake', { action: 'resolve', video: videoRef, items, defaults });
    resolved.push(...batch.items);
  }
  const built = await post('/roster-intake', { action: 'manifest', video: videoRef, items: resolved, warnings: parsed.warnings, defaults });
  let imported = null;
  if (importReady && built.manifest.offers.length) {
    let offers = 0;
    let variants = 0;
    // Each batch is all-or-nothing on the server; earlier batches stay committed.
    // A variant split across batches is safe: the importer merges offers onto
    // the same identity and a repeated batch is idempotent.
    const batches = chunk(built.manifest.offers, IMPORT_BATCH);
    for (const batch of batches) {
      const result = await importPost('/partner-roster', { ...built.manifest, offers: batch });
      offers += batch.length;
      variants += result.distinct_variants ?? 0;
    }
    imported = { merchant_offers: offers, variant_rows: variants, batches: batches.length };
  }
  return {
    video: built.video, summary: built.summary, items: resolved, warnings: parsed.warnings, manifest: built.manifest,
    review_markdown: built.review_markdown, roster_csv: built.roster_csv ?? null, imported,
    seed_replacement_plan: built.seed_replacement_plan ?? null, evaluation_roster: built.evaluation_roster ?? null,
  };
}

function poster(base, session) {
  return async (path, body) => {
    const response = await fetch(new URL(path, base), {
      method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-scoop-admin-session': session },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${path} failed (${response.status}): ${result.error || 'unknown error'}`);
    return result;
  };
}

/**
 * The same parse -> resolve -> manifest steps as POST /roster-intake, run in
 * this process from the built API code. Seller pages and images are fetched
 * straight from this machine; there is no marketplace search without provider
 * keys, so rows that need one stay NEEDS_REVIEW.
 */
export async function localPoster({ fetchPages = true, dist = new URL('../apps/api/dist/src/', import.meta.url) } = {}) {
  const load = async name => {
    const file = new URL(name, dist);
    if (!existsSync(fileURLToPath(file))) throw new Error('API build not found. Run: pnpm --filter @vcl/api build');
    return import(pathToFileURL(fileURLToPath(file)).href);
  };
  const intake = await load('roster-intake.js');
  const replacement = await load('roster-seed-replacement.js');
  let deps = null;
  if (fetchPages) {
    const [catalog, images] = [await load('partner-catalog.js'), await load('candidate-images.js')];
    deps = {
      metadata: url => catalog.fetchPartnerCatalogMetadata(url).catch(() => null),
      imageLoads: async url => Boolean(await images.fetchCatalogImage(url).catch(() => null)),
      search: async () => [],
    };
  }
  return async (path, body) => {
    if (path !== '/roster-intake') throw new Error('Importing needs the API: set SCOOP_API_URL and SCOOP_ADMIN_SESSION');
    const defaults = body.defaults ?? {};
    const stated = typeof body.video === 'string' && body.video.trim() ? intake.parseVideoRef(body.video, defaults) : null;
    if (body.action === 'parse') {
      const parsed = intake.parseRosterIntake(body.list, defaults, stated);
      const video = stated ?? (parsed.video_url ? intake.parseVideoRef(parsed.video_url, defaults) : null);
      if (!video) throw new Error('A video URL or ID is required (none given and none found in the list)');
      return { video, ...parsed };
    }
    if (body.action === 'resolve') {
      return { video: stated, items: deps ? await intake.resolveRosterIntake(body.items, deps) : body.items.map(intake.uncheckedIntakeItem) };
    }
    // Hand-seeded rows already exist for some videos. The plan says which of
    // them the READY variants would replace; it is a draft and changes nothing.
    const plan = replacement.planSeedReplacement(stated, body.items);
    return {
      video: stated,
      summary: intake.summarizeIntake(body.items),
      manifest: intake.buildRosterManifest(stated, body.items),
      review_markdown: intake.renderIntakeReview(stated, body.items, body.warnings ?? []),
      roster_csv: intake.renderIntakeCsv(body.items),
      seed_replacement_plan: plan.entries.length ? plan : null,
      evaluation_roster: replacement.rosterMappingsWithPlan(stated, body.items, plan, { applyDraft: true }),
    };
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.SCOOP_API_URL;
  const session = process.env.SCOOP_ADMIN_SESSION;
  const hasApi = Boolean(base && session && base.startsWith('https://'));
  const local = args.local || args.parseOnly;
  if (!local && !hasApi) throw new Error('SCOOP_API_URL (HTTPS) and SCOOP_ADMIN_SESSION are required. To run on this machine without them, add --local (or --parse-only to just read the list).');
  if (args.import && !hasApi) throw new Error('--import needs SCOOP_API_URL (HTTPS) and SCOOP_ADMIN_SESSION');
  if (args.import && args.parseOnly) throw new Error('--parse-only checks nothing, so there is nothing to import');
  if (args.evaluationRoster && !args.local) throw new Error('--evaluation-roster needs --local');
  const list = readListFile(args.listFile);
  const defaults = { ...(args.brand ? { brand: args.brand } : {}), ...(args.objectType ? { object_type: args.objectType } : {}) };
  const apiPost = hasApi ? poster(base, session) : null;
  const post = local ? await localPoster({ fetchPages: !args.parseOnly }) : apiPost;
  const result = await runRosterIntake({ video: args.video, list, defaults, importReady: args.import, post, importPost: apiPost ?? post });
  const out = resolve(args.out ?? join('roster-intake', result.video.content_ref.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80)));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'review.md'), result.review_markdown);
  if (result.roster_csv) writeFileSync(join(out, 'roster.csv'), result.roster_csv);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
  if (result.seed_replacement_plan) writeFileSync(join(out, 'seed-replacement-plan.json'), `${JSON.stringify(result.seed_replacement_plan, null, 2)}\n`);
  if (args.evaluationRoster && result.evaluation_roster) writeFileSync(join(out, 'evaluation-roster.json'), `${JSON.stringify(result.evaluation_roster)}\n`);
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ video: result.video, summary: result.summary, imported: result.imported, warnings: result.warnings, items: result.items }, null, 2)}\n`);
  console.log(JSON.stringify({
    ...result.summary, imported: result.imported,
    ...(result.seed_replacement_plan ? { seed_replacement: { status: result.seed_replacement_plan.status, ...result.seed_replacement_plan.summary } } : {}),
    review: join(out, 'review.md'),
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
