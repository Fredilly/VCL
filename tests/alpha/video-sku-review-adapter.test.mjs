import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferCsv,adaptVideoResearch } from '../../tools/video-sku-review-adapter.mjs';

const sectionsFile={video_id:'other-video',sections:[
 {section:1,family:'Sneaker',window_start_ms:100,window_end_ms:999,existing_seed_identifier:'SKU-A'},
 {section:2,family:'Hat',window_start_ms:1000,window_end_ms:2000,existing_seed_identifier:'SKU-B'}
]};
const reviewFile={video_id:'other-video',clicks:[
 {id:'a',video_timestamp_ms:500,point:{x:.2,y:.3},vision_hypothesis:'Sneaker',returned_top_class:'EXACT',truth:'SKU',true_sku:'SKU-A'},
 {id:'b',video_timestamp_ms:1100,point:null,truth:'UNREVIEWED'}
]};
const offerCsv='source_line,section,url,link_type,variant_note,merchant\n'+
 '1,1,https://a.example/s1,offer,black,a.example\n'+
 '2,1,https://b.example/s2,offer,white,b.example\n'+
 '3,1,https://example.com/search,search_page,all,example.com\n'+
 '4,2,https://hat.example/p,offer,blue,hat.example\n';
test('CSV parser handles embedded quoted commas',()=>{
 const rows=parseOfferCsv('section,url,link_type,variant_note\n1,https://a.example/x,offer,"black, red"\n');
 assert.equal(rows[0].variant_note,'black, red');
});
test('private review adapter maps candidates and preserves unreviewed truth',()=>{
 const out=adaptVideoResearch({sectionsFile,reviewFile,offerCsv});
 assert.equal(out.counts.sections,2);
 assert.equal(out.counts.offers,3);
 assert.equal(out.audit.excluded_offers[0].reason,'SEARCH_PAGE');
 assert.equal(out.counts.reviewed,0);
 assert.equal(out.counts.unreviewed,2);
 assert.deepEqual(out.cases[0].candidate_offer_ids,['offer-1','offer-2']);
 assert.equal(out.cases[0].truth,'UNREVIEWED');
 assert.equal(out.cases[0].decision,'ABSTAIN_UNVERIFIED');
 assert.deepEqual(out.cases[1].candidate_sections,['2']);
});
test('independently signed labels are preserved but do not become automatic decisions',()=>{
 const signed={...reviewFile,clicks:[{...reviewFile.clicks[0],reviewed_by:'reviewer-one'}]};
 const out=adaptVideoResearch({sectionsFile,reviewFile:signed,offerCsv});
 assert.equal(out.counts.reviewed,1);
 assert.equal(out.cases[0].truth,'SKU');
 assert.equal(out.cases[0].decision,'ABSTAIN_UNVERIFIED');
});
test('wrong video and invalid seller destinations are blocked',()=>{
 assert.throws(()=>adaptVideoResearch({sectionsFile,reviewFile:{...reviewFile,video_id:'wrong'},offerCsv}),/video IDs/);
 const out=adaptVideoResearch({sectionsFile,reviewFile,offerCsv:offerCsv+'5,1,http://unsafe.example,offer,,unsafe\n'});
 assert.equal(out.audit.excluded_offers.at(-1).reason,'MALFORMED_URL');
});
