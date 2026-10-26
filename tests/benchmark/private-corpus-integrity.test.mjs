import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {indexPrivateCorpus,verifyPrivateCorpus} from '../../tools/private-corpus-integrity.mjs';
const sandbox = async fn => {
 const dir=await mkdtemp(join(tmpdir(),'scoop-corpus-'));
 try {await fn(dir);} finally {await rm(dir,{recursive:true,force:true});}
};
test('private manifest+image may be indexed and verified without uploading them',()=>sandbox(async dir=>{
 await writeFile(join(dir,'joined-review-manifest.json'),'{"cases":[]}');
 await writeFile(join(dir,'frame.jpg'),Buffer.from([255,216,255,217]));
 const index=await indexPrivateCorpus(dir,{corpusId:'test-set-1',consented:true});
 assert.equal(index.status,'LOCAL_INTEGRITY_ONLY_NOT_DURABLE_STORAGE');
 assert.equal((await verifyPrivateCorpus(dir,index)).verified,true);
 await writeFile(join(dir,'frame.jpg'),Buffer.from([255,216,255,0]));
 await assert.rejects(verifyPrivateCorpus(dir,index),/integrity mismatch/);
}));
test('review capture requires permission confirmation',()=>sandbox(async dir=>{
 await writeFile(join(dir,'manifest.json'),'{}');
 await assert.rejects(indexPrivateCorpus(dir,{corpusId:'pilot-1'}),/Permission/);
}));
test('reject HAR, tokens and symlink escape',()=>sandbox(async dir=>{
 await writeFile(join(dir,'manifest.json'),'{}');
 await writeFile(join(dir,'capture.har'),'{}');
 await assert.rejects(indexPrivateCorpus(dir,{corpusId:'pilot-1',consented:true}),/Unsafe file/);
 await rm(join(dir,'capture.har'));
 await writeFile(join(dir,'session-token.json'),'{}');
 await assert.rejects(indexPrivateCorpus(dir,{corpusId:'pilot-1',consented:true}),/Unsafe file/);
 await rm(join(dir,'session-token.json'));
 await symlink('/etc/passwd',join(dir,'image.jpg'));
 await assert.rejects(indexPrivateCorpus(dir,{corpusId:'pilot-1',consented:true}),/Symlinks/);
}));
test('tampered index cannot pass verification',()=>sandbox(async dir=>{
 await writeFile(join(dir,'manifest.json'),'{}');
 const index=await indexPrivateCorpus(dir,{corpusId:'pilot-1',consented:true});
 index.files[0].sha256='a'.repeat(64);
 await assert.rejects(verifyPrivateCorpus(dir,index),/integrity mismatch/);
}));
