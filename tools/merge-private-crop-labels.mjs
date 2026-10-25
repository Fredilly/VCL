#!/usr/bin/env node
// Offline reviewed-label merge. Writes a new file; never changes the source corpus.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {applyLabels} from './private-crop-review-core.mjs';
const [manifestPath,labelsPath,rosterPath,outputPath]=process.argv.slice(2);
if(!manifestPath||!labelsPath||!rosterPath||!outputPath){
 console.error('Usage: node tools/merge-private-crop-labels.mjs joined-review-manifest.json scoop-reviewed-labels.json roster.json OUTPUT.json');
 process.exit(2);
}
if(existsSync(outputPath))throw Error('Refusing overwrite');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const result=applyLabels(read(manifestPath),read(labelsPath),read(rosterPath));
writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({cases:result.cases.length,reviewed:result.cases.filter(x=>x.reviewed_by).length,output:outputPath}));
