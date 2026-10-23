#!/usr/bin/env node
// Safe, aggregate-only coverage audit for any compiled video SKU corpus.
// This is NOT an accuracy or product identity benchmark.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarizeVideoSkuCorpus(corpus) {
  if (corpus?.status!=='CANDIDATE_CORPUS_NOT_GROUND_TRUTH' || !Array.isArray(corpus.cases) || !Array.isArray(corpus.sections) || !Array.isArray(corpus.offers))
    throw new Error('Expected compiled video SKU corpus');
  const sections = corpus.sections.map(s=>({
    id:s.id, family:s.family,
    candidate_offer_count:corpus.offers.filter(o=>o.section_id===s.id).length,
    captured_case_count:corpus.cases.filter(c=>c.candidate_sections.includes(s.id)).length
  }));
  const cases=corpus.cases;
  const reviewed=cases.filter(c=>['SKU','NONE','UNKNOWN'].includes(c.truth) && c.reviewed_by).length;
  const classCounts={EXACT:0,LIKELY:0,SIMILAR:0,RELATED:0,NONE:0,UNSPECIFIED:0};
  for(const c of cases) {
    const k=c.observation?.returned_top_class;
    if(k && Object.hasOwn(classCounts,k)) classCounts[k]++;
    else classCounts.UNSPECIFIED++;
  }
  return {
    schema_version:1,video:corpus.video,
    status:'COVERAGE_ONLY_NOT_ACCURACY',
    totals:{sections:sections.length,offers:corpus.offers.length,
      captured_cases:cases.length,
      cases_in_narration_window:cases.filter(c=>c.candidate_sections.length>0).length,
      cases_outside_narration_window:cases.filter(c=>c.candidate_sections.length===0).length,
      unpaired_clicks:cases.filter(c=>!c.click).length,
      reviewed_cases:reviewed,unreviewed_cases:cases.length-reviewed},
    observed_top_classes_not_truth:classCounts,
    section_coverage:sections,
    accuracy:null,exact_precision:null,recall_at_5:null,none_recall:null,
    next_gate:reviewed===cases.length && cases.every(c=>c.click)
      ? 'INDEPENDENT_LABEL_VALIDATION_AND_FRAME_COMPARISON'
      : 'INDEPENDENT_FRAME_LABELING_AND_CLICK_CORRELATION'
  };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [file]=process.argv.slice(2);
  if(!file) throw new Error('Usage: node tools/video-sku-coverage-audit.mjs PRIVATE_COMPILED_CORPUS.json');
  console.log(JSON.stringify(summarizeVideoSkuCorpus(JSON.parse(readFileSync(file,'utf8'))),null,2));
}
