import test from 'node:test';
import assert from 'node:assert/strict';
import {compileVideoSkuCorpus} from '../../tools/video-sku-corpus.mjs';
import {summarizeVideoSkuCorpus} from '../../tools/video-sku-coverage-audit.mjs';
test('counts window coverage without pretending old predictions are correct',()=>{
 const corpus=compileVideoSkuCorpus({video:{platform:'youtube',id:'test'},
  sections:[{section:1,family:'Shoe',discussion_window_ms:[100,200]}],
  offers:[{section_id:'1',url:'https://seller.test/a'},{section_id:'1',url:'https://seller.test/b'}],
  clicks:[{timestamp_ms:120,click:{x:.5,y:.5},observation:{returned_top_class:'EXACT'}},
          {timestamp_ms:220,click:null,observation:{returned_top_class:'RELATED'}}]});
 const audit=summarizeVideoSkuCorpus(corpus);
 assert.equal(audit.totals.captured_cases,2);
 assert.equal(audit.totals.cases_in_narration_window,1);
 assert.equal(audit.totals.cases_outside_narration_window,1);
 assert.equal(audit.totals.unpaired_clicks,1);
 assert.equal(audit.section_coverage[0].candidate_offer_count,2);
 assert.equal(audit.observed_top_classes_not_truth.EXACT,1);
 assert.equal(audit.accuracy,null);
 assert.equal(audit.exact_precision,null);
 assert.equal(audit.next_gate,'INDEPENDENT_FRAME_LABELING_AND_CLICK_CORRELATION');
});
test('rejects uncompiled records',()=>{
 assert.throws(()=>summarizeVideoSkuCorpus({cases:[]}),/compiled video SKU corpus/);
});
