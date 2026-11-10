import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule } from '../apps/api/tests/helpers/load-ts.mjs';

/**
 * Fail-closed check that every roster SKU for a video has a reference image the
 * verifier can actually download. Uses the API's own fetchCatalogImage (same
 * HTTPS/redirect/MIME/size rules as runtime). A roster SKU without loadable
 * pixels is silently skipped by the verifier, which is how the 2026-10-07
 * Handbagholic pilot compared crops against 1-2 of 10 bags.
 *
 *   node tools/check-roster-images.mjs [platform] [content_ref ...]
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const src = resolve(here, '../apps/api/src');

/** Plain request with the runtime's defaults (no spoofed headers), to report why a host refused.
 *  The body is drained on purpose: the runtime rejects an image while streaming it,
 *  so a header-only probe can report "HTTP 200" for an image that never arrives. */
async function diagnose(url) {
  const started = Date.now();
  const elapsed = () => `${Date.now() - started}ms`;
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const header = `HTTP ${response.status} type=${response.headers.get('content-type') ?? '-'} length=${response.headers.get('content-length') ?? '-'} server=${response.headers.get('server') ?? '-'}${response.headers.get('location') ? ` location=${response.headers.get('location').slice(0, 120)}` : ''}`;
    let bytes = 0;
    try {
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > 3_000_000) break;
        }
      }
    } catch (error) {
      return `${header} body=${bytes}B body_error=${error?.name ?? 'Error'} after ${elapsed()}`;
    }
    return `${header} body=${bytes}B after ${elapsed()}`;
  } catch (error) {
    return `${error?.name ?? 'Error'}: ${String(error?.cause?.code ?? error?.message ?? '').slice(0, 80)} after ${elapsed()}`;
  }
}

export async function checkRosterImages(platform, contentRef, fetchCatalogImage, rowsFor, diagnoseFailure = diagnose) {
  const diagnose = diagnoseFailure;
  const rows = rowsFor(platform, contentRef);
  const results = [];
  for (const { mapping, identity } of rows) {
    const urls = [...new Set([
      mapping.image_reference,
      ...(identity.visual_references ?? []).map(ref => ref.image_url),
    ].filter(Boolean))];
    const attempts = [];
    for (const url of urls) {
      const image = await fetchCatalogImage(url).catch(() => null);
      attempts.push({ url, ok: Boolean(image), mime: image?.mimeType ?? null, bytes: image ? Math.round(image.data.length * 3 / 4) : 0,
        ...(image || !diagnose ? {} : { why: await diagnose(url) }) });
    }
    const loadable = attempts.filter(a => a.ok).length;
    results.push({
      product_id: mapping.product_id,
      title: mapping.title,
      pending: mapping.reference_image_status === 'pending_partner_image' && loadable === 0,
      loadable,
      attempts,
    });
  }
  return {
    platform,
    content_ref: contentRef,
    skus: results.length,
    loadable_skus: results.filter(r => r.loadable > 0).length,
    pending_skus: results.filter(r => r.pending).length,
    results,
  };
}

async function main() {
  const [platform = 'youtube', ...refs] = process.argv.slice(2);
  const contentRefs = refs.length ? refs : ['n9u8ynhBdSo'];
  const images = loadModule(resolve(src, 'candidate-images.ts'), { fetch: globalThis.fetch });
  const seeds = loadModule(resolve(src, 'alpha-verified-product-seeds.ts'));
  let failed = false;
  for (const ref of contentRefs) {
    const report = await checkRosterImages(platform, ref, images.fetchCatalogImage, seeds.alphaVerifiedCanonicalRowsForContent);
    const pendingNote = report.pending_skus ? `; ${report.pending_skus} pending partner image` : '';
    console.log(`\n${platform}:${ref} — ${report.loadable_skus}/${report.skus} SKUs have a loadable reference image${pendingNote}`);
    for (const row of report.results) {
      const status = row.loadable ? 'OK  ' : row.pending ? 'PEND' : 'FAIL';
      const suffix = row.pending ? ' (pending partner image; verifier will not compare)' : '';
      console.log(`${status} ${row.product_id.padEnd(12)} ${row.title}${suffix}`);
      for (const a of row.attempts) console.log(`       ${a.ok ? 'loaded' : 'failed'} ${a.ok ? `${a.mime} ${a.bytes}B ` : `[${a.why ?? 'unknown'}] `}${a.url}`);
    }
    if (report.results.some(row => row.loadable === 0 && !row.pending)) failed = true;
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
