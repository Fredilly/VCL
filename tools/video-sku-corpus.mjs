#!/usr/bin/env node
// Offline, generic video/SKU evidence harness. Candidate generation is NOT identity verification.
// No network calls, model requests, or merchant promotion; input is caller-owned JSON.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const asArray = value => Array.isArray(value) ? value : [];
const str = value => typeof value === 'string' ? value.trim() : '';
const validTime = value => Number.isSafeInteger(value) && value >= 0;
function normalizedVideo(video) {
  if (!video || !str(video.platform) || !str(video.id)) throw new Error('video.platform and video.id required');
  return { platform: str(video.platform).toLowerCase(), id: str(video.id) };
}
function normalizedSections(sections) {
  return asArray(sections).map((section, i) => {
    const [start, end] = section.discussion_window_ms ?? [];
    if (!str(section.family) || !validTime(start) || !validTime(end) || end <= start)
      throw new Error('Invalid family or discussion window at section ' + i);
    const id = String(section.section ?? i+1);
    return {
      id, family: str(section.family), start_ms:start, end_ms:end,
      reference_offer: section.reference_offer ?? null,
      variants:asArray(section.mentioned_variants).map(v => ({
        description:str(v.description), on_screen:'unknown'
      }))
    };
  });
}
export function compileVideoSkuCorpus({ video, sections, offers=[], clicks=[] }) {
  const vid = normalizedVideo(video);
  const rows = normalizedSections(sections);
  const offerRows = asArray(offers).map((o,i)=>({
    id:String(o.id ?? i+1), section_id:String(o.section_id ?? o.section ?? ''),
    url:str(o.url), variant:str(o.variant), source:str(o.source),
    evidence_status:'UNVERIFIED_OFFER'
  }));
  for (const o of offerRows)
    if (!/^https:\/\//i.test(o.url) || !rows.some(s=>s.id===o.section_id))
      throw new Error('Offer requires https url and a known section: '+o.id);
  const cases = asArray(clicks).map((c,i)=>{
    const ts = c?.timestamp_ms;
    if (!validTime(ts)) throw new Error('Invalid click timestamp at '+i);
    const candidates = rows.filter(s=>s.start_ms<=ts && ts<s.end_ms);
    const truth = c.truth ?? 'UNREVIEWED';
    if (!['UNREVIEWED','UNKNOWN','NONE','SKU'].includes(truth))
      throw new Error('Invalid truth for click '+i);
    if (truth==='SKU' && !str(c.canonical_sku)) throw new Error('Reviewed SKU requires canonical_sku');
    return {
      id:str(c.id)||'case-'+(i+1), timestamp_ms:ts,
      click:c.click ?? null, observation:c.observation ?? null,
      truth, canonical_sku:truth==='SKU'?str(c.canonical_sku):null,
      reviewed_by:truth==='UNREVIEWED'?null:str(c.reviewed_by)||null,
      candidate_sections:candidates.map(s=>s.id),
      candidate_offer_ids:offerRows.filter(o=>candidates.some(s=>s.id===o.section_id)).map(o=>o.id),
      decision:'ABSTAIN_UNVERIFIED',
      // Narration windows constrain retrieval only; they never prove frame presence or SKU identity.
      notes:candidates.length?'Discussion window only; frame and variant verification required':'No matching discussion window; open retrieval or NONE review required'
    };
  });
  const uniqueUrls=new Set(offerRows.map(o=>o.url));
  return {
    schema_version:1, video:vid, status:'CANDIDATE_CORPUS_NOT_GROUND_TRUTH',
    counts:{sections:rows.length,offers:offerRows.length,unique_offer_urls:uniqueUrls.size,
      clicks:cases.length,reviewed:cases.filter(c=>c.truth!=='UNREVIEWED' && c.reviewed_by).length,
      unreviewed:cases.filter(c=>c.truth==='UNREVIEWED' || !c.reviewed_by).length},
    sections:rows,offers:offerRows,cases,
    safeguards:['No Exact decision from catalog or transcript alone',
      'Seller URLs are not manufacturer SKUs','Variant on-screen status is unknown until independently reviewed',
      'Unreviewed cases cannot contribute to precision metrics']
  };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [input]=process.argv.slice(2);
  if (!input) { console.error('Usage: node tools/video-sku-corpus.mjs corpus.json'); process.exit(2); }
  const output=compileVideoSkuCorpus(JSON.parse(readFileSync(input,'utf8')));
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
}
