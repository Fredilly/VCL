import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Turn a partner's product list for one video into an import-ready roster.
 *
 *   node tools/roster-intake.mjs <video-url-or-id> <list-file> [options]
 *
 * Works for any brand, category and video host; nothing is handbag- or
 * YouTube-specific.
 *
 * <list-file> can be anything the partner sent: a pasted YouTube description,
 * notes, CSV/TSV export, JSON, or a list of seller links. Use "-" for stdin.
 *
 * Options:
 *   --brand "Louis Vuitton"   optional default brand for rows that don't name one
 *   --object-type bag         optional default type for rows that don't imply one
 *   --out <dir>               output folder (default: roster-intake/<video>)
 *   --import                  import READY rows into the video's roster afterwards
 *
 * Writes review.md (products on a page), report.json and manifest.json.
 * Requires SCOOP_API_URL (https) and SCOOP_ADMIN_SESSION.
 */

const RESOLVE_BATCH = 8;
const IMPORT_BATCH = 6;

export function parseArgs(argv) {
  const options = { brand: null, objectType: null, out: null, import: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--brand') options.brand = argv[++i] ?? null;
    else if (arg === '--object-type') options.objectType = argv[++i] ?? null;
    else if (arg === '--out') options.out = argv[++i] ?? null;
    else if (arg === '--import') options.import = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else options.positional.push(arg);
  }
  const [video, listFile] = options.positional;
  if (!video || !listFile) throw new Error('Usage: node tools/roster-intake.mjs <video-url-or-id> <list-file|-> [--brand X] [--object-type TYPE] [--out dir] [--import]');
  return { ...options, video, listFile };
}

export function chunk(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

export async function runRosterIntake({ video, list, defaults = {}, importReady = false, post }) {
  const parsed = await post('/roster-intake', { action: 'parse', video, list, defaults });
  const resolved = [];
  for (const items of chunk(parsed.items, RESOLVE_BATCH)) {
    const batch = await post('/roster-intake', { action: 'resolve', video, items, defaults });
    resolved.push(...batch.items);
  }
  const built = await post('/roster-intake', { action: 'manifest', video, items: resolved, warnings: parsed.warnings, defaults });
  let imported = null;
  if (importReady && built.manifest.offers.length) {
    let offers = 0;
    let variants = 0;
    // Each batch is all-or-nothing on the server; earlier batches stay committed.
    for (const batch of chunk(built.manifest.offers, IMPORT_BATCH)) {
      const result = await post('/partner-roster', { ...built.manifest, offers: batch });
      offers += batch.length;
      variants += result.distinct_variants ?? 0;
    }
    imported = { merchant_offers: offers, variant_rows: variants, batches: Math.ceil(built.manifest.offers.length / IMPORT_BATCH) };
  }
  return { video: built.video, summary: built.summary, items: resolved, warnings: parsed.warnings, manifest: built.manifest, review_markdown: built.review_markdown, imported };
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.SCOOP_API_URL;
  const session = process.env.SCOOP_ADMIN_SESSION;
  if (!base || !session || !base.startsWith('https://')) throw new Error('SCOOP_API_URL (HTTPS) and SCOOP_ADMIN_SESSION are required');
  const list = readFileSync(args.listFile === '-' ? 0 : args.listFile, 'utf8');
  const defaults = { ...(args.brand ? { brand: args.brand } : {}), ...(args.objectType ? { object_type: args.objectType } : {}) };
  const result = await runRosterIntake({ video: args.video, list, defaults, importReady: args.import, post: poster(base, session) });
  const out = resolve(args.out ?? join('roster-intake', result.video.content_ref.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80)));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'review.md'), result.review_markdown);
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ video: result.video, summary: result.summary, imported: result.imported, warnings: result.warnings, items: result.items }, null, 2)}\n`);
  console.log(JSON.stringify({ ...result.summary, imported: result.imported, review: join(out, 'review.md') }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
