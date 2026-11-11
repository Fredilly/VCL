import test from 'node:test';
import assert from 'node:assert/strict';
import { accuracy } from '../../tools/compare-roster-replay.mjs';

const rows = [
  {case_id:'1',current:{top_class:'EXACT',top_identity:'video-local:V-1'}},
  {case_id:'2',current:{top_class:'RELATED',top_identity:'brave:web-search:x'}},
  {case_id:'3',current:{top_class:'NONE',mapping_reason:'visual_rejected'}},
  {case_id:'4',current:{top_class:'EXACT',top_identity:'verified:WRONG'}},
  {case_id:'5',current:{top_class:'NONE',mapping_reason:'incomplete_comparison'}},
];
test('scoring uses class-specific denominators and excludes ambiguous cases',()=>{
  const labels=[
    {case_id:'1',in_roster:true,expected_identity:'V-1'},
    {case_id:'2',in_roster:false},
    {case_id:'3',in_roster:false},
    {case_id:'4',in_roster:true,expected_identity:'correct'},
    {case_id:'5',in_roster:null},
  ];
  const score=accuracy({rows},labels);
  assert.equal(score.status,'MEASURED');
  assert.equal(score.in_roster_cases,2);
  assert.equal(score.out_of_roster_cases,2);
  assert.equal(score.ambiguous_excluded,1);
  assert.equal(score.in_roster_exact_accuracy,0.5);
  assert.equal(score.out_of_roster_clean_rejection_rate,0.5);
  assert.equal(score.false_exact,1);
  assert.equal(score.non_exact_out_of_roster_fallbacks,1);
});
test('scorer refuses missing expected identity and duplicate labels',()=>{
  assert.equal(accuracy({rows},[{case_id:'1',in_roster:true}]).status,'NOT_MEASURABLE');
  assert.equal(accuracy({rows},[{case_id:'1',in_roster:false},{case_id:'1',in_roster:false}]).status,'NOT_MEASURABLE');
});
