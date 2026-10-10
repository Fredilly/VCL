#!/usr/bin/env node
// Read-only HAR correlation: never commit HAR, frame bytes, or resulting private manifest.
// This deliberately does not declare any product truth or claim pixel replay readiness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function correlateHarClicks(har, { maxGapMs = 120000 } = {}) {
  if (!Array.isArray(har?.log?.entries)) throw new Error('Invalid HAR');
  const records = [], pending = [];
  let invalid = 0;
  for (const e of har.log.entries) {
    let path; try { path = new URL(e.request?.url).pathname; } catch { continue; }
    if (!['/locate-selection','/resolve-products'].includes(path) || e.request?.method !== 'POST') continue;
    let request; try { request = JSON.parse(e.request.postData.text); } catch { invalid++; continue; }
    const dateMs = Date.parse(e.startedDateTime);
    if (!Number.isFinite(dateMs)) { invalid++; continue; }
    if (path === '/locate-selection') {
      const point = request.point;
      if (!point || ![point.x,point.y].every(x=>typeof x==='number' && Number.isFinite(x) && x>=0 && x<=1)) {invalid++;continue;}
      let response; try { response=JSON.parse(e.response.content.text); } catch { response=null; }
      pending.push({dateMs,point, box: response && [response.x,response.y,response.width,response.height].every(Number.isFinite)
        ? {x:response.x,y:response.y,width:response.width,height:response.height}:null});
      continue;
    }
    const ctx = request.context ?? {};
    // Match nearest unmatched preceding localization. Do not silently pair distant events.
    const candidates = pending.map((p,i)=>({p,i,gap:dateMs-p.dateMs})).filter(v=>v.gap>=0 && v.gap<=maxGapMs);
    const closest = candidates.sort((a,b)=>a.gap-b.gap)[0];
    if (closest) pending.splice(closest.i,1);
    records.push({
      sequence: records.length+1, timestamp: e.startedDateTime,
      content_ref: typeof ctx.content_ref==='string' ? ctx.content_ref : null,
      video_timestamp_ms: Number.isSafeInteger(ctx.timestamp_ms) ? ctx.timestamp_ms:null,
      click:closest?.p.point??null, localization_box:closest?.p.box??null,
      correlation: closest ? 'SEQUENTIAL_UNVERIFIED' : 'MISSING',
      correlation_gap_ms:closest?.gap??null,
      hypothesis: request.description?.model_candidate??null,
      // Analysis and observed result are NOT the reviewed answer.
      review:{status:'UNREVIEWED',truth:null,canonical_sku:null,reviewer:null}
    });
  }
  return {version:1,status:'REVIEW_REQUIRED',resolutions:records.length,
    click_pairs:records.filter(r=>r.click).length, unmatched_localizations:pending.length,
    invalid, cases:records};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [input,output]=process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node tools/correlate-scoop-har-clicks.mjs input.har PRIVATE_NEW_REPORT.json');
  if (existsSync(output)) throw new Error('Refusing to overwrite private report');
  const result=correlateHarClicks(JSON.parse(readFileSync(input,'utf8')));
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({resolutions:result.resolutions,click_pairs:result.click_pairs,
    unmatched_localizations:result.unmatched_localizations,invalid:result.invalid},null,2));
}
