#!/usr/bin/env node
// Opt-in private replay of previously clicked Scoop requests. No fresh video capture.
// Replays the captured object description and source image through the CURRENT
// commerce resolver. This does not measure fresh vision/localization correctness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex').slice(0,20);
const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };
function summarize(response) {
  const top = Array.isArray(response?.products) ? response.products[0] : null;
  return {
    state: typeof response?.state === 'string' ? response.state : null,
    top_identity: typeof top?.identity_key === 'string' ? top.identity_key : null,
    top_title: typeof top?.title === 'string' ? top.title.slice(0,240) : null,
    top_class: typeof top?.result_class === 'string' ? top.result_class : null,
    count: Array.isArray(response?.products) ? response.products.length : null,
    mapping_reason: typeof response?.verified_mapping?.reason === 'string' ? response.verified_mapping.reason : null,
    compared: Number.isFinite(response?.verification?.compared) ? response.verification.compared : null,
    latency_ms: Number.isFinite(response?.latency_ms) ? response.latency_ms : null,
    cost_usd: Number.isFinite(response?.cost_usage?.total_cost_usd) ? response.cost_usage.total_cost_usd : null,
  };
}
export function harvestReplayRequests(har, {contentRef=null}={}) {
  if (!Array.isArray(har?.log?.entries)) throw new Error('Invalid HAR');
  const cases=[];
  for (const e of har.log.entries) {
    let pathname;
    try {pathname=new URL(e?.request?.url).pathname;} catch {continue;}
    if(pathname!=='/resolve-products'||e.request?.method!=='POST')continue;
    const req=parse(e.request.postData?.text), res=parse(e.response?.content?.text);
    if(!req || !res || !req.description || typeof req.source_image!=='string')continue;
    if(contentRef && !String(req.context?.content_ref??'').includes(contentRef))continue;
    const case_id=digest(e.startedDateTime+'|'+(req.context?.content_ref??'')+'|'+(req.context?.timestamp_ms??'')+'|'+req.source_image);
    cases.push({case_id,request:{
      description:req.description,context:req.context,source_image:req.source_image,
      ...(req.vpm_observation_mode?{vpm_observation_mode:req.vpm_observation_mode}:{})
    },original:summarize(res)});
  }
  return cases;
}
export async function replayHar(har,{endpoint,contentRef=null,auth=null,fetchImpl=fetch,timeoutMs=30000,maxCases=30}={}) {
  const url=new URL(endpoint);
  if(url.protocol!=='https:' && !(url.hostname==='localhost' && url.protocol==='http:')) throw new Error('HTTPS required for live resolver');
  if(url.pathname!=='/resolve-products')throw new Error('Endpoint must be /resolve-products');
  if(!Number.isInteger(maxCases)||maxCases<1||maxCases>100)throw new Error('Invalid case budget');
  const cases=harvestReplayRequests(har,{contentRef}).slice(0,maxCases), rows=[];
  for(const c of cases){
    let current=null,status='OK';
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),timeoutMs);
    try {
      const headers={'content-type':'application/json'};
      if(auth)headers.authorization='Basic '+auth;
      const response=await fetchImpl(endpoint,{method:'POST',headers,
        body:JSON.stringify(c.request),signal:abort.signal,redirect:'error'});
      if(!response.ok)status='HTTP_'+response.status;
      else {const data=await response.json();current=summarize(data);}
    } catch {status='NETWORK_OR_PROVIDER_FAILURE';}
    finally {clearTimeout(timer);}
    rows.push({case_id:c.case_id,video_timestamp_ms:c.request.context?.timestamp_ms??null,
      original:c.original,current,status,
      changed:status==='OK'&&JSON.stringify(c.original)!==JSON.stringify(current)});
  }
  return {version:1,mode:'recorded_description_and_frame_resolver_replay',
    evaluation:'UNLABELED_NO_ACCURACY_CLAIM',count:rows.length,
    completed:rows.filter(r=>r.status==='OK').length,
    changed:rows.filter(r=>r.changed).length,
    note:'This replays historical object descriptions and source crops; it cannot test the current vision or prove SKU accuracy. Human-reviewed labels and real Golden are required.',
    rows};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output,endpoint]=process.argv.slice(2);
  if(!input||!output||!endpoint)throw Error('Usage: node tools/replay-scoop-har-resolver.mjs input.har PRIVATE_NEW_REPORT.json https://API/resolve-products');
  if(existsSync(output))throw Error('Refusing to overwrite report');
  if(process.env.SCOOP_HAR_REPLAY_CONFIRM!=='YES')throw Error('Set SCOOP_HAR_REPLAY_CONFIRM=YES to permit paid live API requests');
  const result=await replayHar(JSON.parse(readFileSync(input,'utf8')),{endpoint,
    contentRef:process.env.SCOOP_REPLAY_CONTENT_REF||null,
    auth:process.env.SCOOP_READER_BASIC_AUTH||null});
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({count:result.count,completed:result.completed,changed:result.changed},null,2));
  if(result.completed!==result.count)process.exitCode=1;
}
