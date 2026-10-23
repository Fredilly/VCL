import test from 'node:test';
import assert from 'node:assert/strict';
import { compileVideoSkuCorpus } from '../../tools/video-sku-corpus.mjs';
import { summarizeVideoSkuCorpus } from '../../tools/video-sku-coverage-audit.mjs';

const make=(points)=>compileVideoSkuCorpus({
 video:{platform:'youtube',id:'test-video'},
 sections:[{section:1,family:'Bag',discussion_window_ms:[0,100000]}],
 clicks:points.map((click,i)=>({timestamp_ms:i*100+1,click}))
});
test('warns on repeated center coordinates but does not mislabel products',()=>{
 const summary=summarizeVideoSkuCorpus(make(Array.from({length:9},()=>({x:.5,y:.5}))));
 assert.equal(summary.totals.center_clicks,9);
 assert.equal(summary.totals.suspicious_center_click_concentration,true);
 assert.equal(summary.next_gate,'VERIFY_CLICK_LOCALIZATION_BEFORE_SKU_SCORING');
 assert.equal(summary.accuracy,null);
});
test('non-center clicks do not trigger this gate',()=>{
 const summary=summarizeVideoSkuCorpus(make(Array.from({length:9},(_,i)=>({x:.12+i*.06,y:.4}))));
 assert.equal(summary.totals.suspicious_center_click_concentration,false);
 assert.equal(summary.next_gate,'INDEPENDENT_FRAME_LABELING_AND_CLICK_CORRELATION');
});
test('insufficient sample is never presented as an anomaly',()=>{
 const summary=summarizeVideoSkuCorpus(make([{x:.5,y:.5}]));
 assert.equal(summary.totals.suspicious_center_click_concentration,false);
});
