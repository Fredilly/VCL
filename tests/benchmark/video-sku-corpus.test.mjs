import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileVideoSkuCorpus } from '../../tools/video-sku-corpus.mjs';
const inventory=JSON.parse(readFileSync(new URL('../fixtures/partner-regressions/n9u8ynhBdSo-inventory.json',import.meta.url),'utf8'));
test('actual Handbagholic research inventory becomes candidates, never truth',()=>{
 const result=compileVideoSkuCorpus({...inventory,clicks:[
  {id:'side-trunk',timestamp_ms:76000},
  {id:'trunkie',timestamp_ms:634000,truth:'UNREVIEWED'},
  {id:'background',timestamp_ms:990000}
 ]});
 assert.equal(result.counts.sections,10);
 assert.deepEqual(result.cases[0].candidate_sections,['1']);
 assert.deepEqual(result.cases[1].candidate_sections,['7']);
 assert.deepEqual(result.cases[2].candidate_sections,[]);
 assert.ok(result.cases.every(c=>c.decision==='ABSTAIN_UNVERIFIED'));
 assert.equal(result.counts.reviewed,0);
 assert.ok(result.sections[0].variants.every(v=>v.on_screen==='unknown'));
});
test('arbitrary video and multiple seller offers for one section remain distinct',()=>{
 const result=compileVideoSkuCorpus({
  video:{platform:'youtube',id:'different-video'},
  sections:[{section:1,family:'Sneakers',discussion_window_ms:[0,5000]}],
  offers:[{section_id:'1',url:'https://shop.example/a',variant:'black'},
          {section_id:'1',url:'https://seller.example/b',variant:'white'}],
  clicks:[{timestamp_ms:1234}]
 });
 assert.deepEqual(result.cases[0].candidate_offer_ids,['1','2']);
 assert.equal(result.counts.offers,2);
 assert.equal(result.cases[0].truth,'UNREVIEWED');
});
test('invalid truth, unsupported URLs and fabricated review labels are rejected or never promoted',()=>{
 const input={video:{platform:'youtube',id:'x'},sections:[{family:'Bag',discussion_window_ms:[1,10]}]};
 assert.throws(()=>compileVideoSkuCorpus({...input,offers:[{section_id:'1',url:'http://example.com'}]}),/https/);
 assert.throws(()=>compileVideoSkuCorpus({...input,clicks:[{timestamp_ms:3,truth:'SKU'}]}),/canonical_sku/);
 const result=compileVideoSkuCorpus({...input,clicks:[{timestamp_ms:3,truth:'SKU',canonical_sku:'M123'}]});
 assert.equal(result.counts.reviewed,0);
 assert.equal(result.cases[0].decision,'ABSTAIN_UNVERIFIED');
});
