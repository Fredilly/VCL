#!/usr/bin/env node
// Adapt locally reviewed frame/click evidence and research offers to the generic corpus.
// Raw frames, HAR files and private review payloads must NEVER be committed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileVideoSkuCorpus } from './video-sku-corpus.mjs';

export function parseOfferCsv(source) {
  const rows=[]; let row=[], field='', quoted=false;
  for (let i=0;i<source.length;i++) {
    const ch=source[i];
    if (quoted) {
      if (ch==='"' && source[i+1]==='"') { field+='"'; i++; }
      else if (ch==='"') quoted=false;
      else field+=ch;
    } else if(ch==='"') quoted=true;
    else if(ch===',') {row.push(field);field='';}
    else if(ch==='\n') {row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || row.length) {row.push(field);rows.push(row);}
  const header=rows.shift()??[];
  if (!['section','url','link_type'].every(h=>header.includes(h)))
    throw new Error('CSV must have section, url, link_type');
  return rows.filter(r=>r.some(Boolean)).map((r,i)=>Object.fromEntries(header.map((h,j)=>[h,r[j]??''])));
}
export function adaptVideoResearch({ sectionsFile, reviewFile, offerCsv }) {
  const sections=sectionsFile?.sections?.map(s=>({
    section:s.section,family:s.family,
    discussion_window_ms:[s.window_start_ms,s.window_end_ms+1],
    reference_offer:{product_id:s.existing_seed_identifier,identity_status:'UNVERIFIED'}
  }))??[];
  const videoId=sectionsFile?.video_id;
  if (!videoId || reviewFile?.video_id !== videoId)
    throw new Error('Review and research video IDs must agree');
  const offerRows=parseOfferCsv(offerCsv);
  const offers=[]; const excluded=[];
  for (const [i,o] of offerRows.entries()) {
    // A search page is not a seller offer; retain it in the audit only.
    if(o.link_type==='search_page') {excluded.push({source_line:o.source_line,reason:'SEARCH_PAGE'});continue;}
    // Some exported Markdown CSV links contain URL](URL fragments. Use the first URL
    // only when two explicitly identical copies exist; otherwise reject for review.
    let url=o.url.trim();
    if(url.includes('](')) {
      const [a,b]=url.split('](');
      if(a!==b) {excluded.push({source_line:o.source_line,reason:'MALFORMED_URL'});continue;}
      url=a;
    }
    if(!/^https:\/\/[^\s]+$/.test(url)) {
      excluded.push({source_line:o.source_line,reason:'MALFORMED_URL'});continue;
    }
    offers.push({id:'offer-'+(o.source_line||i+1),section_id:String(o.section),
      url,variant:o.variant_note||'',source:o.merchant||''});
  }
  const clicks=(reviewFile.clicks??[]).map(c=>({
    id:c.id,timestamp_ms:c.video_timestamp_ms,click:c.point,
    observation:{
      vision_model_hypothesis:c.vision_hypothesis??null,
      returned_top_title:c.returned_top_title??null,
      returned_top_class:c.returned_top_class??null,
      result_count:c.result_count??null
    },
    // The review-file labels are not trusted unless an independent reviewer signed them.
    truth:c.reviewed_by && ['SKU','NONE','UNKNOWN'].includes(c.truth) ? c.truth : 'UNREVIEWED',
    canonical_sku:c.reviewed_by?c.true_sku:null,
    reviewed_by:c.reviewed_by??null
  }));
  const corpus=compileVideoSkuCorpus({
    video:{platform:'youtube',id:videoId},sections,offers,clicks
  });
  return {...corpus,source_status:'PRIVATE_REVIEW_INPUT',
    audit:{source_click_count:clicks.length,source_offer_rows:offerRows.length,
      excluded_offers:excluded,provisional_clicks:clicks.filter(c=>c.click).length,
      reviewed_truth_count:corpus.counts.reviewed},
    note:'Output is a review candidate set. No SKU/variant is automatically verified. Do not publish outputs from private captures.'};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [sectionsPath,reviewPath,offersPath]=process.argv.slice(2);
  if(!sectionsPath||!reviewPath||!offersPath)
    throw new Error('Usage: node tools/video-sku-review-adapter.mjs video_sections.json private_click_review.json seller_references.csv');
  const data=adaptVideoResearch({
    sectionsFile:JSON.parse(readFileSync(sectionsPath,'utf8')),
    reviewFile:JSON.parse(readFileSync(reviewPath,'utf8')),
    offerCsv:readFileSync(offersPath,'utf8')
  });
  process.stdout.write(JSON.stringify(data,null,2)+'\n');
}
