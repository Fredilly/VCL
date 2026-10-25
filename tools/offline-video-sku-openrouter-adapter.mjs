// OpenRouter multimodal adapter for offline review-only SKU comparisons.
// Supplies evidence proposals; never certified identity or an EXACT claim.
const endpoint='https://openrouter.ai/api/v1/chat/completions';
function mime(bytes) {
  if(bytes[0]===0xff&&bytes[1]===0xd8) return 'image/jpeg';
  if(bytes[0]===0x89&&bytes[1]===0x50) return 'image/png';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP') return 'image/webp';
  throw Error('Unsupported image bytes');
}
function url(bytes) { return 'data:'+mime(bytes)+';base64,'+bytes.toString('base64'); }
const schema={
  type:'object',additionalProperties:false,required:['candidates'],
  properties:{candidates:{type:'array',items:{type:'object',additionalProperties:false,
    required:['sku','similarity','visual_compared','contradiction'],
    properties:{sku:{type:'string'},similarity:{type:'number'},visual_compared:{type:'boolean'},contradiction:{type:'boolean'}}}}}
};
export function partitionCatalog(catalog, size=24) {
  if (!Array.isArray(catalog) || !catalog.length || !Number.isSafeInteger(size) || size<1 || size>24) throw Error('Invalid catalog batch');
  const seen=new Set();
  for(const item of catalog) {
    if(typeof item?.sku!=='string' || !item.sku.trim() || seen.has(item.sku)) throw Error('Missing or duplicate catalog SKU');
    seen.add(item.sku);
  }
  const batches=[];
  for(let i=0;i<catalog.length;i+=size) batches.push(catalog.slice(i,i+size));
  return batches;
}

async function predictBatch({frame,catalog}) {
  const key=process.env.OPENROUTER_API_KEY;
  if(!key) throw Error('OPENROUTER_API_KEY required');
  if(catalog.some(c=>!c.references?.length)) throw Error('Missing reference image');
  const parts=[{type:'text',text:`Compare the first image (video frame) against the numbered SKU image references that follow.
Return JSON only, candidates containing one entry for every SKU. A SKU must not be asserted solely from its title.
Compare shape, construction, strap/handle placement, hardware, pattern, and visible marks. If the frame has no recognizable product, mark all candidates not visually compared and similarity 0.
High similarity means near-identical product geometry, not the same brand/category. Set contradiction true if high-confidence visual evidence disagrees. Be conservative. This is only a review proposal.
Catalog order: ${catalog.map((c,i)=>`${i+1}: ${c.sku}: ${c.title} (${c.references.length} images)`).join('; ')}`},{type:'image_url',image_url:{url:url(frame.bytes)}}];
  for(const c of catalog) for(const image of c.references.slice(0,2)) {
    parts.push({type:'text',text:'Reference image for SKU '+c.sku});
    parts.push({type:'image_url',image_url:{url:url(image.bytes)}});
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),90000);
  try {
    const res=await fetch(endpoint,{method:'POST',signal:controller.signal,headers:{
      'authorization':'Bearer '+key,'content-type':'application/json'
    },body:JSON.stringify({model:process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',temperature:0,
      response_format:{type:'json_schema',json_schema:{name:'sku_comparison',strict:true,schema}},
      messages:[{role:'user',content:parts}]})});
    if(!res.ok) throw Error('Vision provider HTTP '+res.status);
    const body=await res.json();
    const raw=body.choices?.[0]?.message?.content;
    if(typeof raw!=='string') throw Error('Vision provider response missing');
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed.candidates) || parsed.candidates.length!==catalog.length) throw Error('Incomplete SKU comparison');
    const expected=new Set(catalog.map(x=>x.sku));
    if(new Set(parsed.candidates.map(x=>x.sku)).size!==expected.size
        || parsed.candidates.some(x=>!expected.has(x.sku))) throw Error('Missing or foreign SKU');
    return parsed;
  } finally {clearTimeout(timer);}
}

// Compare every SKU even for chaotic rosters larger than a single model batch.
// Fail closed on any missing/failed batch: incomplete evidence must never look
// like full-catalog recall or an absent SKU. Scores are proposals, not Exact.
export async function predict({frame,catalog}) {
  const batches=partitionCatalog(catalog);
  const candidates=[];
  for(const batch of batches) {
    const result=await predictBatch({frame,catalog:batch});
    candidates.push(...result.candidates);
  }
  if(candidates.length!==catalog.length) throw Error('Incomplete cross-batch SKU comparison');
  return {candidates};
}
