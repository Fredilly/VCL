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

/** Plain request with the runtime's defaults (no spoofed headers), to report why a host refused. */
async function diagnose(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000) });
    const why = `HTTP ${response.status} type=${response.headers.get('content-type') ?? '-'} length=${response.headers.get('content-length') ?? '-'} server=${response.headers.get('server') ?? '-'}${response.headers.get('location') ? ` location=${response.headers.get('location').slice(0, 120)}` : ''}`;
    await response.body?.cancel();
    return why;
  } catch (error) {
    return `${error?.name ?? 'Error'}: ${String(error?.cause?.code ?? error?.message ?? '').slice(0, 80)}`;
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
    results.push({ product_id: mapping.product_id, title: mapping.title, loadable: attempts.filter(a => a.ok).length, attempts });
  }
  return { platform, content_ref: contentRef, skus: results.length, loadable_skus: results.filter(r => r.loadable > 0).length, results };
}

async function main() {
  const [platform = 'youtube', ...refs] = process.argv.slice(2);
  const contentRefs = refs.length ? refs : ['n9u8ynhBdSo'];
  const images = loadModule(resolve(src, 'candidate-images.ts'), { fetch: globalThis.fetch });
  const seeds = loadModule(resolve(src, 'alpha-verified-product-seeds.ts'));
  let failed = false;
  for (const ref of contentRefs) {
    const report = await checkRosterImages(platform, ref, images.fetchCatalogImage, seeds.alphaVerifiedCanonicalRowsForContent);
    console.log(`\n${platform}:${ref} — ${report.loadable_skus}/${report.skus} SKUs have a loadable reference image`);
    for (const row of report.results) {
      console.log(`${row.loadable ? 'OK  ' : 'FAIL'} ${row.product_id.padEnd(12)} ${row.title}`);
      for (const a of row.attempts) console.log(`       ${a.ok ? 'loaded' : 'failed'} ${a.ok ? `${a.mime} ${a.bytes}B ` : `[${a.why ?? 'unknown'}] `}${a.url}`);
    }
    if (!report.skus || report.loadable_skus < report.skus) failed = true;
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
