#!/usr/bin/env node
// Opt-in private replay of previously clicked Scoop requests. No fresh video capture.
// Replays the captured object description and source image through the CURRENT
// commerce resolver. This does not measure fresh vision/localization correctness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = value => createHash('sha256').update(value).digest('hex').slice(0,20);
const parse = raw => { try { return JSON.parse(raw); } catch { return null; } };
// Respect production rate limits: bounded backoff, never rotate install IDs or
// override server quotas to force a replay through.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function retryDelay(response, attempt) {
  if (![429, 502, 503, 504].includes(response.status) || attempt >= 2) return null;
  const retryAfter = response.headers.get('retry-after');
  let ms = 2000 * 2 ** attempt;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const until = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(until)) ms = Math.max(0, until);
  }
  // A longer server-enforced quota is not a transient network problem.
  return ms <= 30000 ? ms : null;
}
function summarize(response) {
  const top = Array.isArray(response?.products) ? response.products[0] : null;
  return {
    state: typeof response?.state === 'string' ? response.state : null,
    top_identity: typeof top?.identity_key === 'string' ? top.identity_key : null,
    top_title: typeof top?.title === 'string' ? top.title.slice(0,240) : null,
    top_class: typeof top?.result_class === 'string' ? top.result_class : null,
    count: Array.isArray(response?.products) ? response.products.length : null,
    mapping_reason: typeof response?.verified_mapping?.reason === 'string' ? response.verified_mapping.reason : null,
    roster_retrieved: Array.isArray(response?.verified_mapping?.roster_retrieval?.retrieved_keys) ? response.verified_mapping.roster_retrieval.retrieved_keys.length : null,
    roster_unresolved: Array.isArray(response?.verified_mapping?.roster_retrieval?.unresolved_keys) ? response.verified_mapping.roster_retrieval.unresolved_keys.length : null,
    visual_failures: Number.isFinite(response?.verified_mapping?.visual_failures) ? response.verified_mapping.visual_failures : null,
    visual_failure_reasons: response?.verified_mapping?.visual_failure_reasons && typeof response.verified_mapping.visual_failure_reasons === 'object'
      ? Object.fromEntries(Object.entries(response.verified_mapping.visual_failure_reasons)
        .filter(([key,value]) => /^[a-z0-9_]{1,60}$/.test(key) && Number.isInteger(value) && value >= 0)
        .slice(0,20)) : null,
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
      // Preserve every field of the original successful HTTP 200 request,
      // including explicitly null optional fields. Previous replay rebuilt
      // the payload and dropped fields the API contract may require.
      ...req,
      telemetry: req.telemetry ? {
        ...req.telemetry, event_id:randomUUID(), session_id:randomUUID(),
        interaction_started_at:Date.now(),
      } : req.telemetry,
    },original:summarize(res)});
  }
  return cases;
}
export async function replayHar(har,{endpoint,contentRef=null,auth=null,fetchImpl=fetch,timeoutMs=45000,maxCases=30}={}) {
  const url=new URL(endpoint);
  if(url.protocol!=='https:' && !(url.hostname==='localhost' && url.protocol==='http:')) throw new Error('HTTPS required for live resolver');
  if(url.pathname!=='/resolve-products')throw new Error('Endpoint must be /resolve-products');
  if(!Number.isInteger(maxCases)||maxCases<1||maxCases>100)throw new Error('Invalid case budget');
  const cases=harvestReplayRequests(har,{contentRef}).slice(0,maxCases), rows=[];
  // Live alpha guard requires an install identifier. Use a new isolated UUID
  // per replay run rather than reusing the original user's installation ID.
  const replayInstallId=randomUUID();
  for(const c of cases){
    let current=null,status='OK',error_code=null,validation_fields=[],error_shape=null,error_category=null;
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),timeoutMs);
    try {
      const headers={'content-type':'application/json','x-scoop-install-id':replayInstallId};
      if(auth)headers.authorization='Basic '+auth;
      let response;
      for (let attempt=0; attempt<3; attempt++) {
        response=await fetchImpl(endpoint,{method:'POST',headers,
          body:JSON.stringify(c.request),signal:abort.signal,redirect:'error'});
        const delay=retryDelay(response,attempt);
        if(delay===null)break;
        // Release rejected responses before retrying. The per-case abort signal
        // still bounds the entire operation to timeoutMs.
        await response.body?.cancel();
        await wait(delay);
      }
      if(!response.ok) {
        status='HTTP_'+response.status;
        // Do not echo arbitrary response bodies: they can contain private source data.
        try {
          const payload=await response.json();
          error_shape=typeof payload==='string' ? 'json_string' : Array.isArray(payload) ? 'json_array' : (payload && typeof payload==='object' ? 'json_object' : 'json_scalar');
          const message=typeof payload==='string' ? payload : [payload?.message,payload?.error?.message,typeof payload?.error==='string' ? payload.error : null].find(x=>typeof x==='string');
          if(typeof message==='string') {
            const m=message.toLowerCase();
            error_category=/auth|unauthoriz|forbidden|credential|permission|token/.test(m) ? 'AUTH' :
              /size|large|payload too/.test(m) ? 'PAYLOAD_SIZE' :
              /json|parse|syntax/.test(m) ? 'JSON_PARSE' :
              /schema|valid|missing|required|field|body|parameter/.test(m) ? 'VALIDATION' :
              /quota|rate.limit/.test(m) ? 'QUOTA' : 'OTHER';
          }
          const code=payload?.code ?? payload?.error?.code;
          if(typeof code==='string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(code)) error_code=code;
          const issues=Array.isArray(payload?.issues) ? payload.issues :
            Array.isArray(payload?.error?.issues) ? payload.error.issues : [];
          const allowed=new Set(['description','context','source_image','telemetry',
            'vpm_observation_mode','body','timestamp_ms','event_id','session_id',
            'interaction_started_at']);
          validation_fields=[...new Set(issues.flatMap(issue=>
            Array.isArray(issue?.path) ? issue.path.map(String).filter(p=>allowed.has(p)) : []
          ))].slice(0,8);
        } catch {}
      }
      else {const data=await response.json();current=summarize(data);}
    } catch (error) {
      // Do not conflate a 45-second client timeout with a provider/network
      // failure. The two causes require different production fixes.
      status=abort.signal.aborted ? 'CLIENT_TIMEOUT' : 'NETWORK_OR_PROVIDER_FAILURE';
      error_category=abort.signal.aborted ? 'TIMEOUT' : 'NETWORK';
    }
    finally {clearTimeout(timer);}
    rows.push({case_id:c.case_id,video_timestamp_ms:c.request.context?.timestamp_ms??null,
      original:c.original,current,status,error_code,validation_fields,error_shape,error_category,
      identity_changed:status==='OK'&&c.original.top_identity!==current?.top_identity,
      confidence_changed:status==='OK'&&c.original.top_class!==current?.top_class,
      offers_changed:status==='OK'&&c.original.count!==current?.count,
      changed:status==='OK'&&JSON.stringify([c.original.top_identity,c.original.top_class,c.original.count])!==JSON.stringify([current?.top_identity,current?.top_class,current?.count])});
  }
  return {version:1,mode:'recorded_description_and_frame_resolver_replay',
    evaluation:'UNLABELED_NO_ACCURACY_CLAIM',count:rows.length,
    completed:rows.filter(r=>r.status==='OK').length,
    changed:rows.filter(r=>r.changed).length,
    identity_changed:rows.filter(r=>r.identity_changed).length,
    confidence_changed:rows.filter(r=>r.confidence_changed).length,
    offers_changed:rows.filter(r=>r.offers_changed).length,
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
    auth:process.env.SCOOP_READER_BASIC_AUTH||null,
    maxCases:Number(process.env.SCOOP_REPLAY_MAX_CASES || '5')});
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({count:result.count,completed:result.completed,changed:result.changed},null,2));
  if(result.completed!==result.count)process.exitCode=1;
}
