import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/load-ts.mjs';
const {verifiedRosterCanonicalRowsForContent,scopedPartnerRosterCandidates}=loadModule(new URL('../src/partner-roster.ts',import.meta.url).pathname);
const mapping=(sku,start,end)=>({platform:'youtube',content_ref:'video-1',scope:'entire_video',object_type:'bag',brand:'Demo',product_id:sku,title:'Demo '+sku,destination:'https://example.com/'+sku,provenance:'creator_verified',candidate_window_start_ms:start,candidate_window_end_ms:end});
test('out-of-window creator variants survive full-video retrieval; windows are only ranking hints',()=>{
 const full=verifiedRosterCanonicalRowsForContent([mapping('A',0,100),mapping('B',200,300)],'youtube','video-1',250);
 assert.equal(full.length,2);
 const ranked=scopedPartnerRosterCandidates({partner:full,durable:[],timestamp_ms:250});
 assert.equal(ranked[0].mapping.product_id,'B');
 assert.deepEqual(new Set(ranked.map(x=>x.mapping.product_id)),new Set(['A','B']));
});
test('foreign-video inventory is never admitted into retrieval',()=>{
 const full=verifiedRosterCanonicalRowsForContent([mapping('A',0,100),{...mapping('B',200,300),content_ref:'other-video'}],'youtube','video-1',250);
 assert.equal(full.map(x=>x.mapping.product_id).join(','),'A');
});
