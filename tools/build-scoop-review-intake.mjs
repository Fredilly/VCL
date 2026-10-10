#!/usr/bin/env node
// Builds a private, independently reviewable join of real HAR frames and clicks.
// Not a chaos benchmark: no unreviewed ground truth or guessed SKU is promoted.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractHarSelections } from './extract-scoop-har-frames.mjs';
import { correlateHarClicks } from './correlate-scoop-har-clicks.mjs';

export function buildReviewIntake(har, folder, {write=false}={}) {
  if (write && existsSync(folder)) throw new Error('Refusing to overwrite review directory');
  // Both extractors traverse resolve-products requests in network-log order.
  const frames=extractHarSelections(har,folder,{write});
  const clicks=correlateHarClicks(har);
  if (frames.extracted !== clicks.resolutions || frames.skipped !== 0 || clicks.invalid !== 0)
    return {status:'BLOCKED_INCOMPLETE_CORRELATION',frame_count:frames.extracted,
      click_count:clicks.resolutions,skipped_frames:frames.skipped,invalid_events:clicks.invalid,
      note:'Do not align by index when entries are missing or malformed.'};
  const cases=frames.cases.map((f,i)=>{
    const c=clicks.cases[i];
    if (f.input.frames[0].timestamp_ms !== c.video_timestamp_ms)
      throw new Error('Frame/click timestamp mismatch at '+i);
    return {id:f.id,input:{...f.input,click:c.click},click_correlation:c.correlation,
      click_gap_ms:c.correlation_gap_ms,observation:f.observation,
      truth:'UNREVIEWED',expected_class:null,reviewed_by:null,
      // A roster and hash-pinned variant-specific catalog images are mandatory
      // before promotion into the v2 chaos benchmark.
      roster:null,catalog_id:null,source_group:null,category:null,split:null};
  });
  const ready=cases.filter(c=>c.input.click).length;
  const result={version:1,status:'REVIEW_REQUIRED_NOT_BENCHMARK_READY',
    total:cases.length,paired_clicks:ready,unpaired_clicks:cases.length-ready,
    note:'Sequential pairing is provisional. Independent frame/SKU review, verified roster references and held-out splits required before real-pixel replay.',
    cases};
  if(write)writeFileSync(join(folder,'joined-review-manifest.json'),
    JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  return result;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,folder]=process.argv.slice(2);
  if(!input||!folder)throw new Error('Usage: node tools/build-scoop-review-intake.mjs input.har PRIVATE_NEW_DIRECTORY');
  const result=buildReviewIntake(JSON.parse(readFileSync(input,'utf8')),resolve(folder),{write:true});
  console.log(JSON.stringify({status:result.status,total:result.total,
    paired_clicks:result.paired_clicks,unpaired_clicks:result.unpaired_clicks},null,2));
  if(result.status!=='REVIEW_REQUIRED_NOT_BENCHMARK_READY')process.exitCode=1;
}
