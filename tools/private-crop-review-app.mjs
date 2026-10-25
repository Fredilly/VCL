import {rosterIds,validateLabel,exportLabels} from './private-crop-review-core.mjs';
const $=id=>document.getElementById(id);
let cases=[],allowed=[],labels={},index=0,images=new Map(),urls=[],dirty=false,visible=false;
const key=()=>cases.map(c=>c.id).join('|');
function markDirty(){dirty=true;$('status').textContent='Unsaved changes. Export labels before leaving.'}
function imageCandidates(c){const f=c.input?.frames?.[0]||{};return [f.path,f.file,f.filename,f.image_path,f.crop_path,c.image_path,c.crop_path,c.image_file,c.id+'.png',c.id+'.jpg'].filter(x=>typeof x==='string').map(x=>x.split('/').pop())}
function render(){
 if(!cases.length)return;
 const c=cases[index],l=labels[c.id]||{},f=c.input?.frames?.[0]||{};
 $('caseTitle').textContent='Case '+c.id;
 $('truth').value=l.truth||'UNREVIEWED';$('sku').value=l.true_sku||'';
 $('reason').value=l.uncertainty_reason||'';$('possible').value=(l.possible_variants||[]).join(', ');
 $('notes').value=l.notes||'';
 const url=imageCandidates(c).map(n=>images.get(n)).find(Boolean);
 visible=Boolean(url);$('photo').removeAttribute('src');
 if(url)$('photo').src=url;
 $('imageStatus').textContent=visible?'Crop loaded':'MISSING CROP: labels disabled';
 $('metadata').textContent='Timestamp: '+String(f.timestamp_ms??'unknown')+' ms | click coordinates crop-relative';
 $('progress').textContent=(index+1)+' / '+cases.length+' | reviewed '+Object.keys(labels).length;
}
function commit(){
 if(!cases.length)return false;
 const truth=$('truth').value,c=cases[index];
 if(truth==='UNREVIEWED'){return true}
 if(!visible){alert('Load the image before labeling');return false}
 const label={case_id:c.id,truth,true_sku:truth==='SKU'?$('sku').value:null,
  uncertainty_reason:truth==='UNKNOWN'?$('reason').value:null,
  possible_variants:$('possible').value.split(',').map(x=>x.trim()).filter(Boolean),
  reviewed_by:$('reviewer').value.trim(),reviewed_at:new Date().toISOString(),notes:$('notes').value.trim()};
 if(label.possible_variants.some(x=>!allowed.includes(x))){alert('Possible variants must exist in roster');return false}
 try{validateLabel(label,allowed)}catch(e){alert(e.message);return false}
 labels[c.id]=label;markDirty();return true;
}
function navigate(step){
 if(!cases.length)return;
 if(!commit())return;
 index=Math.max(0,Math.min(cases.length-1,index+step));render();
}
$('previous').onclick=()=>navigate(-1);
$('next').onclick=()=>navigate(1);
$('save').onclick=()=>navigate(1);
for(const id of ['truth','sku','reason','possible','notes'])$(id).addEventListener('change',markDirty);
$('manifest').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 if((Object.keys(labels).length||dirty)&&!confirm('Discard existing review? Export first if needed.')){e.target.value='';return}
 try{
  const data=JSON.parse(await f.text());if(!Array.isArray(data.cases))throw Error('Missing cases');
  const ids=data.cases.map(c=>c.id);if(ids.some(x=>!x)||new Set(ids).size!==ids.length)throw Error('Duplicate/invalid cases');
  cases=data.cases;labels={};index=0;dirty=false;$('status').textContent=cases.length+' cases loaded';render();
 }catch(err){alert(err.message)}
};
$('roster').onchange=async e=>{
 if(Object.keys(labels).length&&!confirm('Changing roster invalidates reviewed IDs. Export first?')){e.target.value='';return}
 try{
  const data=JSON.parse(await e.target.files[0].text());allowed=rosterIds(data);
  if(!allowed.length)throw Error('No canonical variant identifiers in roster');
  labels={};const select=$('sku');select.replaceChildren(new Option('Select a variant',''));
  for(const id of allowed)select.add(new Option(id,id));
  render();$('status').textContent='Roster: '+allowed.length+' variants';
 }catch(err){alert(err.message)}
};
$('images').onchange=e=>{
 urls.forEach(URL.revokeObjectURL);urls=[];images=new Map();
 for(const file of e.target.files){const url=URL.createObjectURL(file);urls.push(url);images.set(file.name,url)}
 render();
};
$('resume').onchange=async e=>{
 if(!cases.length||!allowed.length){alert('Load manifest and roster first');return}
 try{
  const data=JSON.parse(await e.target.files[0].text()),seen=new Set(),next={};
  for(const l of data.cases||[]){
   if(!cases.some(c=>c.id===l.case_id)||seen.has(l.case_id))throw Error('Unknown or duplicate case');
   seen.add(l.case_id);
   if(l.truth==='UNREVIEWED')continue;
   validateLabel(l,allowed);next[l.case_id]=l;
  }
  if(Object.keys(labels).length&&!confirm('Replace current labels with imported labels?'))return;
  labels=next;dirty=false;render();
 }catch(err){alert(err.message)}
};
$('export').onclick=()=>{
 if(!cases.length||!allowed.length){alert('Load cases and roster');return}
 if(!commit())return;
 const data=exportLabels(cases,labels);
 const blob=new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='scoop-reviewed-labels.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false;$('status').textContent='Exported labels. Keep this file private.';
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
