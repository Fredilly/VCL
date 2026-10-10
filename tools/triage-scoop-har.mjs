#!/usr/bin/env node
// Local-only HAR diagnosis. Never store HARs or selected frame bytes in git.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

function parse(text) { try { return JSON.parse(text ?? ''); } catch { return null; } }
function stem(s) { return String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' '); }
function family(input) {
  const s = stem(input);
  const names = ['petite malle','trunkie','side trunk','carryall','noe','capucines','multi pochette','neverfull','speedy','vanity'];
  return names.find(n => new RegExp('(?:^| )' + n.replace(/ /g,' +') + '(?: |$)').test(s)) ?? null;
}
function diagnosis(har) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('Invalid HAR: log.entries missing');
  const cases = [];
  for (const entry of entries) {
    let path;
    try { path = new URL(entry?.request?.url).pathname; } catch { continue; }
    if (path !== '/resolve-products' || entry?.request?.method !== 'POST') continue;
    const req = parse(entry.request.postData?.text);
    const res = parse(entry.response?.content?.text);
    if (!req || !res) continue;
    const desc = req.description ?? {};
    const products = Array.isArray(res.products) ? res.products : [];
    const top = products[0] ?? {};
    const verification = res.verification ?? {};
    const video = req.context?.video_id ?? req.context?.content_id ?? req.context?.videoId ?? null;
    const observed = family([desc.model_candidate,desc.subcategory,desc.search_terms?.join(' ')].filter(Boolean).join(' '));
    const topFamily = family([top.title,top.model].filter(Boolean).join(' '));
    const flags = [];
    if (observed && topFamily && observed !== topFamily) flags.push('HYPOTHESIS_RESULT_FAMILY_MISMATCH_REVIEW');
    if ((verification.image_failures ?? 0) > 0) flags.push('CANDIDATE_IMAGE_VERIFICATION_FAILURES');
    if (res.verified_mapping?.reason === 'visual_rejected') flags.push('REUSED_MAPPING_VISUALLY_REJECTED');
    if (!products.length) flags.push('NO_PRODUCT_RESULTS');
    if (products[0]?.result_class === 'EXACT' && (verification.image_failures ?? 0)>0) flags.push('EXACT_WITH_SOME_IMAGE_FAILURES_REVIEW_RIVALS');
    const fingerprint = createHash('sha256').update(JSON.stringify({
      time:entry.startedDateTime, query:res.query?.query ?? null, video, top:top.identity_key ?? top.id ?? null
    })).digest('hex').slice(0,16);
    cases.push({
      case_id: fingerprint, time: entry.startedDateTime,
      model_hypothesis: desc.model_candidate ?? null,
      result_family: topFamily, result_class: top.result_class ?? null,
      query: res.query?.query ?? null,
      top_title: top.title ?? null,
      top_identity_key: top.identity_key ?? null,
      product_count: products.length,
      verification: {
        retrieved:verification.retrieved ?? null,compared:verification.compared ?? null,
        image_failures:verification.image_failures ?? null,
        image_failure_reasons:verification.image_failure_reasons ?? null
      },
      mapping_reason:res.verified_mapping?.reason ?? null,
      flags,
      // Ground truth must be independently reviewed from permitted real frames.
      review: {truth:'UNREVIEWED',correct_sku:null,selected_frame_sha256:null,notes:null}
    });
  }
  return {version:1,kind:'har-triage-not-ground-truth',count:cases.length,
    flagged:cases.filter(c=>c.flags.length).length,cases};
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const [, , input, output] = process.argv;
  if (!input || !output) { console.error('Usage: node tools/triage-scoop-har.mjs input.har output.json'); process.exit(2); }
  if (existsSync(output)) { console.error('Refusing to overwrite existing report'); process.exit(2); }
  const report = diagnosis(parse(readFileSync(input,'utf8')));
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Analyzed',report.count,'resolutions;',report.flagged,'flagged. REVIEW each case against actual selected pixels. Report:',output);
}
export { diagnosis };
