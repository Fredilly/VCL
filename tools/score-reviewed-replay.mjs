#!/usr/bin/env node
// Private offline scoring: only signed reviewer labels count as ground truth.
// No images, raw observations or input files are committed by this tool.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const clean=x=>typeof x==='string'?x.trim():'';
const norm=x=>clean(x).toUpperCase();
export function scoreReviewedReplay(manifest){
 if(!Array.isArray(manifest?.cases))throw Error('Expected manifest.cases');
 const seen=new Set(),rows=[];
 for(const c of manifest.cases){
  if(!clean(c.id)||seen.has(c.id))throw Error('Missing or duplicate case ID');
  seen.add(c.id);
  const truth=norm(c.truth),signed=Boolean(clean(c.reviewed_by));
  const eligible=signed&&['IN_ROSTER','OUT_OF_ROSTER','AMBIGUOUS'].includes(truth);
  const obs=c.observation??{},predicted=clean(obs.returned_top_canonical_key??obs.returned_top_sku??obs.canonical_key);
  const resultClass=norm(obs.returned_top_class??obs.result_class);
  // Reviewer-signed verdict on a returned EXACT when the result carries no canonical ID.
  const verdict=norm(c.exact_verdict);
  const expected=clean(c.true_sku??c.canonical_sku??c.expected_class);
  const none=!predicted&&!clean(obs.returned_top_title)&&(obs.result_count===0||resultClass==='NONE');
  let outcome='UNREVIEWED';
  if(eligible){
   if(truth==='IN_ROSTER'){
    if(!expected||expected==='NONE'||expected==='UNKNOWN')outcome='UNSCORABLE_MISSING_TRUTH_ID';
    else if(!predicted&&verdict==='MATCH'&&resultClass==='EXACT')outcome='CORRECT_SKU';
    else if(!predicted&&verdict==='MISMATCH')outcome='WRONG_SKU';
    else if(!predicted)outcome=none?'RETRIEVAL_OR_RESULT_MISSING':'UNSCORABLE_MISSING_RESULT_ID';
    else outcome=predicted===expected?'CORRECT_SKU':'WRONG_SKU';
   }else if(truth==='OUT_OF_ROSTER'){
    // An EXACT claim for an out-of-roster product is a false Exact whether or not a canonical key was recorded.
    if(resultClass==='EXACT')outcome='OUT_OF_ROSTER_FALSE_MATCH';
    else if(resultClass==='NONE'||none)outcome='CORRECT_ABSTENTION';
    else if(['SIMILAR','RELATED'].includes(resultClass))outcome='OUT_OF_ROSTER_LABELED_NON_EXACT';
    else outcome='UNSCORABLE_RESULT_STATUS';
   }
   else outcome=resultClass==='EXACT'?'AMBIGUOUS_FALSE_EXACT':!predicted?'CORRECT_ABSTENTION':'AMBIGUOUS_MATCH';
  }
  const falseExact=eligible&&resultClass==='EXACT'&&['WRONG_SKU','OUT_OF_ROSTER_FALSE_MATCH','AMBIGUOUS_FALSE_EXACT'].includes(outcome);
  rows.push({id:c.id,truth:eligible?truth:'UNREVIEWED',expected:expected||null,predicted:predicted||null,result_class:resultClass||null,outcome,false_exact:falseExact});
 }
 const evaluated=rows.filter(x=>x.outcome!=='UNREVIEWED'&&!x.outcome.startsWith('UNSCORABLE'));
 const exact=evaluated.filter(x=>x.result_class==='EXACT');
 const count=o=>rows.filter(x=>x.outcome===o).length;
 return {total:rows.length,signed:rows.filter(x=>x.truth!=='UNREVIEWED').length,evaluated:evaluated.length,
  unscorable:rows.length-evaluated.length,correct_sku:count('CORRECT_SKU'),wrong_sku:count('WRONG_SKU'),
  false_exact:rows.filter(x=>x.false_exact).length,exact_count:exact.length,
  exact_precision:exact.length?exact.filter(x=>x.outcome==='CORRECT_SKU').length/exact.length:null,
  retrieval_or_result_missing:count('RETRIEVAL_OR_RESULT_MISSING'),
  note:'Requires signed canonical SKU labels and recorded canonical result IDs. Titles cannot establish SKU accuracy. Retrieval recall@k and latency require traces.',
  rows};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw Error('Usage: node tools/score-reviewed-replay.mjs PRIVATE-merged-manifest.json NEW-report.json');
 if(existsSync(output))throw Error('Refusing overwrite');
 const result=scoreReviewedReplay(JSON.parse(readFileSync(input,'utf8')));
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({total:result.total,signed:result.signed,evaluated:result.evaluated,false_exact:result.false_exact,unscorable:result.unscorable}));
}
