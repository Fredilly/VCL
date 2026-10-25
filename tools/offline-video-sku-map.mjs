// Offline, consented video-to-SKU timeline builder. No product-specific rules.
// Frames and SKU reference images are local files. The vision adapter supplies
// independent candidate comparisons; this layer cannot invent image evidence.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const valid = s => typeof s === 'string' && s.length > 0;
const unit = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const image = p => /\.(png|jpe?g|webp)$/i.test(p);
export async function loadMappingInputs(manifestPath) {
  const dir = dirname(resolve(manifestPath));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.video?.source || !Array.isArray(manifest.frames) || !manifest.frames.length
      || !Array.isArray(manifest.catalog) || !manifest.catalog.length) throw Error('Missing video, frames, or catalog');
  const keys = new Set();
  const catalog = [];
  for (const row of manifest.catalog) {
    if (!valid(row.sku) || keys.has(row.sku)) throw Error('Duplicate/missing SKU');
    keys.add(row.sku);
    if (!Array.isArray(row.images) || !row.images.length) throw Error('SKU missing images: '+row.sku);
    const references = [];
    for (const entry of row.images) {
      if (!valid(entry.path) || !image(entry.path) || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) throw Error('Invalid SKU image reference: '+row.sku);
      const bytes = await readFile(resolve(dir, entry.path));
      if (hash(bytes) !== entry.sha256) throw Error('SKU image hash mismatch: '+row.sku);
      references.push({sha256:entry.sha256, bytes});
    }
    catalog.push({sku:row.sku,title:row.title ?? row.sku, references});
  }
  const frames = [];
  let previous = -1;
  for (const frame of manifest.frames) {
    if (!Number.isInteger(frame.timestamp_ms) || frame.timestamp_ms <= previous
        || !valid(frame.path) || !image(frame.path) || !/^[0-9a-f]{64}$/.test(frame.sha256 ?? '')) throw Error('Invalid frame ordering/evidence');
    previous = frame.timestamp_ms;
    const bytes = await readFile(resolve(dir, frame.path));
    if (hash(bytes) !== frame.sha256) throw Error('Frame hash mismatch at '+frame.timestamp_ms);
    frames.push({timestamp_ms:frame.timestamp_ms, sha256:frame.sha256, bytes});
  }
  return {source:manifest.video.source, catalog, frames, manifest_sha256:hash(await readFile(manifestPath))};
}
export function buildTimeline(observations, {minIndependentFrames=2, minSimilarity=.90, minMargin=.08, maxGapMs=15000}={}) {
  if (!Number.isSafeInteger(maxGapMs) || maxGapMs <= 0) throw Error('Invalid mapping continuity gap');
  // Raw similarity alone does not create a VERIFIED assertion. A human must
  // review exported appearances before anything enters trusted product memory.
  const points = observations.map(o => {
    const sorted = [...o.candidates].sort((a,b)=>b.similarity-a.similarity);
    const [best,second] = sorted;
    const decisive = best && best.visual_compared === true && best.contradiction !== true
      && best.similarity >= minSimilarity && best.similarity-(second?.similarity ?? 0)>=minMargin;
    return {...o, proposed_sku: decisive ? best.sku : null, state:decisive?'CANDIDATE':'UNKNOWN'};
  });
  const windows=[];
  for(const p of points) {
    const last=windows.at(-1);
    if(last && last.proposed_sku===p.proposed_sku && p.timestamp_ms-last.end_ms<=maxGapMs) {
      last.end_ms=p.timestamp_ms;
      last.frame_sha256.push(p.frame_sha256);
      last.timestamps_ms.push(p.timestamp_ms);
    } else windows.push({proposed_sku:p.proposed_sku,start_ms:p.timestamp_ms,end_ms:p.timestamp_ms,
      frame_sha256:[p.frame_sha256],timestamps_ms:[p.timestamp_ms]});
  }
  return {points,windows:windows.map(w=>({...w,
    status:w.proposed_sku && new Set(w.frame_sha256).size>=minIndependentFrames ? 'NEEDS_HUMAN_REVIEW':'UNKNOWN'}))};
}
export async function mapVideoManifest(manifestPath, adapterPath) {
  const {predict} = await import(pathToFileURL(resolve(adapterPath)).href);
  if(typeof predict!=='function') throw Error('Adapter must export predict({frame,catalog})');
  const inputs = await loadMappingInputs(manifestPath);
  const observations=[];
  for(const frame of inputs.frames) {
    const result = await predict({frame, catalog:inputs.catalog});
    if(!Array.isArray(result?.candidates)) throw Error('Adapter must return candidates');
    const seen=new Set();
    for(const c of result.candidates) {
      if(!inputs.catalog.some(v=>v.sku===c.sku) || seen.has(c.sku) || !unit(c.similarity)
          || typeof c.visual_compared!=='boolean' || typeof c.contradiction!=='boolean') throw Error('Invalid evidence for candidate');
      seen.add(c.sku);
    }
    observations.push({timestamp_ms:frame.timestamp_ms,frame_sha256:frame.sha256,candidates:result.candidates});
  }
  return {version:1,mode:'offline_video_sku_mapping',video_source:inputs.source,
    manifest_sha256:inputs.manifest_sha256,review_status:'UNVERIFIED',...buildTimeline(observations)};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [manifest,adapter,output]=process.argv.slice(2);
  if(!manifest||!adapter||!output) throw Error('Usage: node tools/offline-video-sku-map.mjs manifest.json adapter.mjs report.json');
  const report=await mapVideoManifest(manifest,adapter);
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({frames:report.points.length,windows:report.windows.length,review_status:report.review_status}));
}
