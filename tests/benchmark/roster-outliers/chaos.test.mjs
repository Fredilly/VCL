import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateChaosManifest, validateChaosPrediction, chaosInput, stageMetrics, assessChaos, chaosScenarios } from './chaos.mjs';
import { replayChaos } from './chaos-replay.mjs';
import { runOrderStress } from './order-stress.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const fixture = () => ({id:'private-label',scenario:'family_lookalike',truth:'IN_ROSTER',expected_class:'A',
  catalog_id:'catalog',source_group:'source',category:'bags',reviewed_by:'reviewer',split:'holdout',
  roster:[{canonical_key:'A',title:'Bag A',references:[{path:'ref.png',sha256:sha('reference')} ]},
    {canonical_key:'B',title:'Bag B',references:[]}],
  input:{click:{x:.5,y:.5},frames:[{path:'frame.png',sha256:sha('source'),timestamp_ms:1000}],context:{video_title:'Title'}}});
const prediction = (key='A') => ({status:'OK',predicted_class:key,result_class:key==='NONE'?null:'EXACT',
  retrieved_keys:['A','B'],verified_keys:['A','B'],cost_usd:0,provider_calls:0});
const row = (c,p=prediction(),order=0) => ({...c,...p,order,roster_bucket:'2-16',latency_ms:10});

test('canonical SKU, independent split and frozen reference contracts fail closed', () => {
  const c=fixture(); validateChaosManifest({version:2,cases:[c]});
  for (const mutate of [
    x=>{x.roster.push({...x.roster[0]});},
    x=>{x.roster[0].references[0].sha256='changed';},
    x=>{x.reviewed_by='';},x=>{x.expected_class='missing';},
  ]) { const bad=structuredClone(c); mutate(bad); assert.throws(()=>validateChaosManifest({version:2,cases:[bad]})); }
  for (const shared of ['catalog_id','source_group','frame']) {
    const other=structuredClone(c); other.id='other';other.split='development';other.catalog_id='other';other.source_group='other';other.input.frames[0].sha256=sha('other');
    if(shared==='frame') other.input.frames[0].sha256=c.input.frames[0].sha256; else other[shared]=c[shared];
    assert.throws(()=>validateChaosManifest({version:2,cases:[c,other]}),/leakage|duplicate observation/);
  }
  assert.throws(()=>validateChaosManifest({version:2,cases:[c,{...c,id:'copy'}]}),/duplicate observation/);
  validateChaosManifest({version:2,cases:[{...c,roster:[],truth:'OUT_OF_ROSTER',expected_class:'NONE'}]});
});

test('allowlisted adapter inputs exclude review labels and local paths', () => {
  const c=fixture(); c.input.context.truth='IN_ROSTER';c.roster[0].expected_class='A';
  const input=chaosInput(c,()=>Buffer.from('pixels'));
  const json=JSON.stringify(input);
  for(const text of ['private-label','reviewed_by','expected_class','source_group','frame.png','ref.png','IN_ROSTER']) assert.ok(!json.includes(text),text);
  assert.equal(input.roster[0].references[0].bytes.toString(),'pixels');
});

test('invalid traces and unverified Exact cannot count as successful retrieval', () => {
  const c=fixture(); validateChaosPrediction(prediction(),c.roster);
  for(const p of [
    {...prediction(),verified_keys:[]}, {...prediction(),retrieved_keys:['B'],verified_keys:['B']},
    {...prediction(),retrieved_keys:['A','A']}, {...prediction(),result_class:null},
    {...prediction(),cost_usd:NaN}, {...prediction(),provider_calls:.5},
    {...prediction('NONE'),result_class:'EXACT'}, {...prediction(),retrieved_keys:undefined},
  ]) assert.throws(()=>validateChaosPrediction(p,c.roster));
});

test('stage metrics distinguish retrieval misses, verifier misses, blocks and Exact uncertainty', () => {
  const c=fixture();
  const rows=[row(c),row({...c,id:'retrieval'}, {...prediction('NONE'),retrieved_keys:['B'],verified_keys:['B']}),
    row({...c,id:'verifier'},prediction('NONE')),row({...c,id:'blocked'},{status:'PROVIDER_BLOCKED'})];
  const m=stageMetrics(rows);
  assert.equal(m.recall_at_5,.5);assert.equal(m.in_roster_accuracy,.25);
  assert.deepEqual(m.retrieval_misses,['retrieval','blocked']);assert.deepEqual(m.verification_or_ranking_misses,['verifier']);
  assert.equal(m.exact_precision,1);assert.ok(m.zero_error_upper_95>.9);
  assert.equal(m.cost_usd,null);
});

// These synthetic rows test the evaluator, never the recognizer. A passing
// evaluator fixture must not be exported as product-quality evidence.
function covered() {
  const cases=[];const rows=[];
  for(let catalog=0;catalog<3;catalog++) for(const bucket of ['single','2-16','17-64','65+']) {
    for(const [truth,n] of [['IN_ROSTER',5],['OUT_OF_ROSTER',5],['AMBIGUOUS',2]]) for(let j=0;j<n;j++) {
      const c={...fixture(),id:`${catalog}-${bucket}-${truth}-${j}`,catalog_id:`catalog-${catalog}`,category:`category-${catalog}`,
        source_group:`source-${catalog}-${j%2}`,truth,expected_class:truth==='IN_ROSTER'?'A':'NONE',scenario:chaosScenarios[cases.length%chaosScenarios.length]};
      cases.push(c);rows.push({...row(c,prediction(truth==='IN_ROSTER'?'A':'NONE')),roster_bucket:bucket});
    }
  }
  const empty={...fixture(),id:'empty',roster:[],truth:'OUT_OF_ROSTER',expected_class:'NONE'};
  // Use an already represented held-out catalog/category.
  Object.assign(empty,{catalog_id:'catalog-0',category:'category-0',source_group:'source-0-0'});
  cases.push(empty);rows.push({...row(empty,{...prediction('NONE'),retrieved_keys:[],verified_keys:[]}),roster_bucket:'empty'});
  return {cases,rows};
}

test('complete synthetic evaluator control passes; permutations cannot inflate evidence', () => {
  const {cases,rows}=covered();assert.equal(assessChaos(cases,rows).gate.passed,true);
  const copied=rows.map(r=>({...r,order:1}));
  assert.equal(assessChaos(cases,[...rows,...copied]).metrics.observations,rows.length);
  copied[0].predicted_class='B';
  const bad=assessChaos(cases,[...rows,...copied]);
  assert.ok(bad.gate.failures.includes('ROSTER_ORDER_INSTABILITY'));assert.ok(bad.gate.failures.includes('FALSE_EXACT'));
});

test('easy negatives cannot conceal failed positive slices; insufficient data cannot promote', () => {
  const {cases,rows}=covered();
  const bad=rows.map(r=>r.truth==='IN_ROSTER' && r.catalog_id==='catalog-0'?{...r,predicted_class:'NONE',result_class:null}:r);
  assert.ok(assessChaos(cases,bad).gate.failures.includes('SLICE_ACCURACY:catalog_id:catalog-0'));
  const alwaysNone=rows.map(r=>({...r,predicted_class:'NONE',result_class:null}));
  assert.equal(assessChaos(cases,alwaysNone).gate.passed,false);
  assert.equal(assessChaos([],[]).gate.passed,false);
  assert.ok(assessChaos([fixture()],[row(fixture())]).gate.failures.includes('INSUFFICIENT_COVERAGE'));
});

async function withFiles(fn) {
  const dir=mkdtempSync(join(tmpdir(),'scoop-chaos-'));
  try {
    writeFileSync(join(dir,'frame.png'),'source');writeFileSync(join(dir,'ref.png'),'reference');
    writeFileSync(join(dir,'manifest.json'),JSON.stringify({version:2,cases:[fixture()]}));
    await fn(dir,join(dir,'manifest.json'),join(dir,'adapter.mjs'));
  } finally {rmSync(dir,{recursive:true,force:true});}
}

test('pixel replay exposes order dependence and verifies reference hashes before inference', async () => {
  await withFiles(async(dir,manifest,adapter)=>{
    writeFileSync(adapter,`export async function predict(input) {
      const key=input.roster[0].canonical_key;
      if(input.answer_space[0]!==key) throw Error('answer order');
      return {status:'OK',predicted_class:key,result_class:'EXACT',retrieved_keys:[key],verified_keys:[key],cost_usd:0,provider_calls:0};
    }`);
    const r=await replayChaos(manifest,adapter);
    assert.equal(r.rows.length,2);assert.deepEqual(r.unstable_case_ids,['private-label']);
    assert.ok(r.gate.failures.includes('FALSE_EXACT'));
    writeFileSync(join(dir,'ref.png'),'tampered');
    await assert.rejects(replayChaos(manifest,adapter),/hash mismatch/);
  });
});

test('malformed output remains a system failure; provider blocking is distinct', async () => {
  await withFiles(async(dir,manifest,adapter)=>{
    writeFileSync(adapter,`export async function predict() {return {status:'OK',predicted_class:'NONE',result_class:null};}`);
    const r=await replayChaos(manifest,adapter);
    assert.equal(r.metrics.system_failures,1);assert.equal(r.rows[0].failure,'ADAPTER_ERROR_OR_INVALID_TRACE');
  });
  await withFiles(async(dir,manifest,adapter)=>{
    writeFileSync(adapter,`export async function predict() {return {status:'PROVIDER_BLOCKED'};}`);
    const r=await replayChaos(manifest,adapter);
    assert.equal(r.metrics.provider_blocked,1);assert.ok(r.gate.failures.includes('PROVIDER_BLOCKED'));
  });
});

test('timeout cancels the run without launching subsequent provider work', async () => {
  await withFiles(async(dir,manifest,adapter)=>{
    writeFileSync(adapter,`let calls=0; export async function predict(input,{signal}) {calls++;if(calls>1) throw Error('extra call'); return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({status:'SYSTEM_FAIL'})));}`);
    const r=await replayChaos(manifest,adapter,{timeoutMs:10});
    assert.equal(r.rows[0].failure,'TIMEOUT');assert.equal(r.rows[1].failure,'RUN_CANCELLED_AFTER_TIMEOUT');
  });
});

test('frozen production resolver is invariant to every candidate position and reversal', () => {
  const r=runOrderStress();assert.equal(r.gate.passed,true,JSON.stringify(r.gate));assert.deepEqual(r.unstable_case_ids,[]);
});
