import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTimeline} from '../../tools/offline-video-sku-map.mjs';
const row=(timestamp_ms,candidates)=>({timestamp_ms,frame_sha256:String(timestamp_ms),candidates});
const candidate=(sku,similarity,visual_compared=true,contradiction=false)=>({sku,similarity,visual_compared,contradiction});
test('multiple independent visually grounded frames are required for review window',()=>{
 const result=buildTimeline([row(1000,[candidate('A',.96),candidate('B',.1)]),row(2000,[candidate('A',.94),candidate('B',.2)])]);
 assert.equal(result.windows[0].proposed_sku,'A');
 assert.equal(result.windows[0].status,'NEEDS_HUMAN_REVIEW');
});
test('a single frame never produces a reviewable verified mapping',()=>{
 const result=buildTimeline([row(1000,[candidate('A',.99)])]);
 assert.equal(result.windows[0].status,'UNKNOWN');
});
test('closely matched sibling SKUs abstain rather than invent identity',()=>{
 const result=buildTimeline([row(1000,[candidate('Capucines',.94),candidate('Multi Pochette',.92)])]);
 assert.equal(result.points[0].state,'UNKNOWN');
});
test('visual contradictions veto even a high-similarity candidate',()=>{
 const result=buildTimeline([row(1000,[candidate('A',.99,true,true)])]);
 assert.equal(result.points[0].proposed_sku,null);
});
test('uncompared text guesses never become mappings',()=>{
 const result=buildTimeline([row(1000,[candidate('A',1,false,false)])]);
 assert.equal(result.points[0].state,'UNKNOWN');
});
test('out-of-roster/no visual evidence remains unknown',()=>{
 const result=buildTimeline([row(1000,[]),row(2000,[])]);
 assert.equal(result.windows[0].status,'UNKNOWN');
});

test('same SKU appearances separated by a long unseen interval become distinct windows',()=>{
 const result=buildTimeline([
  row(1000,[candidate('A',.98)]),row(2000,[candidate('A',.97)]),
  row(100000,[candidate('A',.96)]),row(101000,[candidate('A',.98)])
 ]);
 assert.equal(result.windows.length,2);
 assert.deepEqual(result.windows.map(w=>[w.start_ms,w.end_ms]),[[1000,2000],[100000,101000]]);
 assert.ok(result.windows.every(w=>w.status==='NEEDS_HUMAN_REVIEW'));
});
test('reused identical image hashes do not count as independent visual evidence',()=>{
 const result=buildTimeline([
  {...row(1000,[candidate('A',.98)]),frame_sha256:'identical'},
  {...row(2000,[candidate('A',.98)]),frame_sha256:'identical'}
 ]);
 assert.equal(result.windows.length,1);
 assert.equal(result.windows[0].status,'UNKNOWN');
});
test('unknown intervals must not become one invented continuous appearance across gaps',()=>{
 const result=buildTimeline([row(1000,[]),row(80000,[])]);
 assert.equal(result.windows.length,2);
 assert.ok(result.windows.every(w=>w.status==='UNKNOWN'));
});
