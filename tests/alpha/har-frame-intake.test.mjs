import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHarSelections } from '../../tools/extract-scoop-har-frames.mjs';

const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const entry = (url, image=frame) => ({
  request:{url,method:'POST',postData:{text:JSON.stringify({
    source_image:'data:image/jpeg;base64,'+image,
    context:{platform:'youtube',content_ref:'video-1',timestamp_ms:12000},
    description:{model_candidate:'Petite Malle'}
  })}},
  response:{content:{text:JSON.stringify({products:[{title:'Side Trunk',result_class:'SIMILAR'}],verification:{retrieved:9,compared:5,image_failures:2}})}}
});
test('extracts hash-pinned real selection and does not convert guessed descriptions to ground truth',()=>{
  const m=extractHarSelections({log:{entries:[entry('https://api.example.com/resolve-products')]}},'/unused',{write:false});
  assert.equal(m.extracted,1);
  assert.equal(m.cases[0].observation.vision_model_hypothesis,'Petite Malle');
  assert.equal(m.cases[0].observation.returned_top_title,'Side Trunk');
  assert.equal(m.cases[0].reviewed_truth,'UNREVIEWED');
  assert.equal(m.cases[0].input.click,null);
  assert.match(m.cases[0].input.frames[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(m.status,'REVIEW_REQUIRED_NOT_BENCHMARK_READY');
});
test('refuses malformed HAR and skips non-resolution and invalid image entries',()=>{
  assert.throws(()=>extractHarSelections({},'/unused',{write:false}),/Invalid HAR/);
  const m=extractHarSelections({log:{entries:[
    entry('https://api.example.com/feedback'),entry('https://api.example.com/resolve-products','_notbase64')
  ]}},'/unused',{write:false});
  assert.equal(m.extracted,0);
  assert.equal(m.skipped,1);
});
