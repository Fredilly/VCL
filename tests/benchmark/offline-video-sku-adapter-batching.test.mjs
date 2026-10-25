import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionCatalog,predict} from '../../tools/offline-video-sku-openrouter-adapter.mjs';

const catalog=Array.from({length:49},(_,i)=>({sku:'sku-'+(i+1),title:'Variant '+(i+1),references:[{bytes:Buffer.from([0xff,0xd8,0xff])}]}));
const frame={bytes:Buffer.from([0xff,0xd8,0xff])};

test('catalogs over 24 are partitioned without losing or duplicating SKUs',()=>{
 const batches=partitionCatalog(catalog);
 assert.deepEqual(batches.map(b=>b.length),[24,24,1]);
 assert.deepEqual(batches.flat().map(v=>v.sku),catalog.map(v=>v.sku));
});
test('duplicate catalog SKU is refused before comparing frames',()=>{
 assert.throws(()=>partitionCatalog([catalog[0],catalog[0]]),/duplicate/);
});
test('all batches must return evidence before full-roster proposal exists',async()=>{
 const original=globalThis.fetch,key=process.env.OPENROUTER_API_KEY;
 const batches=[];
 try {
  process.env.OPENROUTER_API_KEY='test-only';
  globalThis.fetch=async (_url,opts)=>{
   const body=JSON.parse(opts.body);
   const descriptions=body.messages[0].content.filter(p=>p.type==='text' && p.text.startsWith('Reference image for SKU '));
   const keys=descriptions.map(p=>p.text.slice('Reference image for SKU '.length));
   batches.push(keys);
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({candidates:keys.map(sku=>({sku,similarity:.3,visual_compared:true,contradiction:false}))})}}]})};
  };
  const result=await predict({frame,catalog});
  assert.deepEqual(batches.map(b=>b.length),[24,24,1]);
  assert.deepEqual(result.candidates.map(x=>x.sku),catalog.map(x=>x.sku));
 } finally {
  globalThis.fetch=original;
  if(key===undefined)delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY=key;
 }
});
test('failed later batch never returns an apparently complete catalog',async()=>{
 const original=globalThis.fetch,key=process.env.OPENROUTER_API_KEY;
 let calls=0;
 try {
  process.env.OPENROUTER_API_KEY='test-only';
  globalThis.fetch=async (_url,opts)=>{
   calls++;
   if(calls===2)return {ok:false,status:429};
   const body=JSON.parse(opts.body);
   const keys=body.messages[0].content.filter(p=>p.type==='text' && p.text.startsWith('Reference image for SKU ')).map(p=>p.text.slice(24));
   return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({candidates:keys.map(sku=>({sku,similarity:0,visual_compared:false,contradiction:false}))})}}]})};
  };
  await assert.rejects(predict({frame,catalog}),/HTTP 429/);
  assert.equal(calls,2);
 } finally {
  globalThis.fetch=original;
  if(key===undefined)delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY=key;
 }
});
