// Shared browser/Node validation for reviewed crop labels.
export const TRUTH = Object.freeze(['SKU','NONE','UNKNOWN']);
export function rosterIds(manifest){
 const entries=Array.isArray(manifest)?manifest:
   Array.isArray(manifest?.products)?manifest.products:
   Array.isArray(manifest?.roster)?manifest.roster:
   Array.isArray(manifest?.items)?manifest.items:[];
 return [...new Set(entries.map(x=>typeof x==='string'?x:
   x.canonical_product_id??x.canonical_key??x.sku??x.id).filter(x=>typeof x==='string'&&x.trim()))];
}
export function validateLabel(label,allowed){
 if(!TRUTH.includes(label.truth))throw Error('Choose SKU, NONE or UNKNOWN');
 if(!label.reviewed_by?.trim())throw Error('Reviewer ID required');
 if(label.truth==='SKU'){
  if(!label.true_sku||!allowed.includes(label.true_sku))throw Error('Select a SKU from the provided roster');
 }else if(label.true_sku)throw Error('Only SKU labels can specify a variant');
 if(label.truth==='UNKNOWN'&&!label.uncertainty_reason)throw Error('Explain why the variant is unknown');
 return true;
}
export function exportLabels(cases,labels){
 return {schema:'scoop-private-labels-v2',source:'local-crop-review',model_output_hidden:true,
  cases:cases.map(c=>labels[c.id]||{case_id:c.id,truth:'UNREVIEWED'})};
}
export function applyLabels(manifest,exported,roster){
 if(!Array.isArray(manifest.cases)||!Array.isArray(exported.cases))throw Error('Invalid manifest or labels');
 const allowed=rosterIds(roster),ids=new Set(manifest.cases.map(c=>c.id)),seen=new Set();
 const map=new Map();
 for(const l of exported.cases){
  if(!ids.has(l.case_id)||seen.has(l.case_id))throw Error('Missing/duplicate/foreign case ID');
  seen.add(l.case_id);
  if(l.truth==='UNREVIEWED')continue;
  validateLabel(l,allowed);map.set(l.case_id,l);
 }
 return {...manifest,cases:manifest.cases.map(c=>{
  const l=map.get(c.id);if(!l)return c;
  return {...c,truth:l.truth==='SKU'?'IN_ROSTER':l.truth==='NONE'?'OUT_OF_ROSTER':'AMBIGUOUS',
   true_sku:l.true_sku||null,expected_class:l.truth==='NONE'?'NONE':l.truth==='UNKNOWN'?'UNKNOWN':null,
   reviewed_by:l.reviewed_by,reviewed_at:l.reviewed_at,review_notes:l.notes||'',
   uncertainty_reason:l.uncertainty_reason||null,
   possible_variants:l.possible_variants||[]};
 })};
}
