#!/usr/bin/env node
// Explicit, local-only extraction of user-initiated Scoop selections from a HAR.
// Do not commit input HAR, extracted crops, or review manifests: they can contain copyrighted media.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export function extractHarSelections(har, outputDirectory, { write = true } = {}) {
  if (!Array.isArray(har?.log?.entries)) throw new Error('Invalid HAR: missing log.entries');
  if (write && existsSync(outputDirectory)) throw new Error('Refusing to overwrite existing review directory');
  const cases = [];
  let skipped = 0;
  for (const entry of har.log.entries) {
    let url;
    try { url = new URL(entry?.request?.url); } catch { continue; }
    if (url.pathname !== '/resolve-products' || entry.request.method !== 'POST') continue;
    let input, response;
    try {
      input = JSON.parse(entry.request.postData?.text ?? '');
      response = JSON.parse(entry.response?.content?.text ?? '');
    } catch { skipped++; continue; }
    const dataUrl = input?.source_image;
    if (typeof dataUrl !== 'string') { skipped++; continue; }
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) { skipped++; continue; }
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) { skipped++; continue; }
    const sha = createHash('sha256').update(bytes).digest('hex');
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const id = 'selection-' + String(cases.length + 1).padStart(3, '0');
    const path = 'frames/' + id + '.' + ext;
    if (write) {
      mkdirSync(join(outputDirectory,'frames'),{ recursive:true, mode:0o700 });
      writeFileSync(join(outputDirectory,path),bytes,{flag:'wx',mode:0o600});
    }
    const ctx = input.context ?? {};
    const description = input.description ?? {};
    const first = response.products?.[0] ?? null;
    cases.push({
      id,
      input: {
        frames:[{path,sha256:sha,timestamp_ms: Number.isSafeInteger(ctx.timestamp_ms) ? ctx.timestamp_ms : null}],
        context:{ platform:ctx.platform ?? null, content_ref:ctx.content_ref ?? null },
        // Click coordinates are not in the resolve-products request; obtain them from correlated
        // locate-selection requests before using this as a real-frame benchmark case.
        click:null
      },
      observation:{
        vision_model_hypothesis:description.model_candidate ?? null,
        returned_top_title:first?.title ?? null,
        returned_top_class:first?.result_class ?? null,
        verification: {
          retrieved:response.verification?.retrieved ?? null,
          compared:response.verification?.compared ?? null,
          image_failures:response.verification?.image_failures ?? null
        }
      },
      reviewed_truth:'UNREVIEWED',
      reviewed_sku:null,
      reviewer:null
    });
  }
  const manifest = {version:1,status:'REVIEW_REQUIRED_NOT_BENCHMARK_READY',
    note:'Review selected object and SKU independently, correlate click coordinates, then import reviewed cases into the frozen harness. Historical API predictions are not labels.',
    extracted:cases.length,skipped,cases};
  if (write) writeFileSync(join(outputDirectory,'review-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error('Usage: node tools/extract-scoop-har-frames.mjs input.har PRIVATE_NEW_DIRECTORY');process.exit(2); }
  const manifest = extractHarSelections(JSON.parse(readFileSync(input,'utf8')),resolve(output));
  console.log('Private review intake:',manifest.extracted,'source images;',manifest.skipped,'skipped. No accuracy claims until independent review.');
}
