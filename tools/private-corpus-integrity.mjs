#!/usr/bin/env node
// Local private corpus integrity index, NOT a cloud vault or a replay benchmark.
// Contents and image bytes never leave the local machine.
import { readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = /\.(json|csv|png|jpe?g|webp)$/i;
const secretNames = /(^|[-_.])(cookie|token|secret|credentials|password|session|authorization|\.env)([-_.]|$)/i;
const validHex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function safeName(name) {
  return typeof name === 'string' && name && name !== '.' && name !== '..'
    && !name.includes('/') && !name.includes('\\')
    && !secretNames.test(name) && allowed.test(name);
}
async function listFiles(root) {
  const out = [];
  async function visit(dir) {
    for (const name of (await readdir(dir)).sort()) {
      if(name === 'corpus-integrity.json') continue;
      if(!safeName(name) && !name.includes('.')) throw Error('Unsafe directory entry: '+name);
      const full = join(dir,name);
      const stat = await lstat(full);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw Error('Symlinks/special files forbidden');
      if (stat.isDirectory()) {
        if (secretNames.test(name) || name==='..' || name==='.') throw Error('Unsafe directory');
        await visit(full);
      } else {
        if (!safeName(name) || /\.har$/i.test(name)) throw Error('Unsafe file: '+name);
        out.push({path:relative(root,full).split(sep).join('/'),size:stat.size,sha256:sha(await readFile(full))});
      }
    }
  }
  await visit(root);
  return out.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function indexPrivateCorpus(dir, {corpusId,consented=false}={}) {
  if (!consented) throw Error('Permission/consent confirmation required');
  if(typeof corpusId!=='string' || !/^[a-zA-Z0-9_-]{3,64}$/.test(corpusId)) throw Error('Invalid corpus ID');
  const root=resolve(dir);
  if(!(await lstat(root)).isDirectory()) throw Error('Corpus must be a directory');
  const files=await listFiles(root);
  if(!files.length) throw Error('Empty corpus');
  const jsonFiles=files.filter(f=>/\.json$/i.test(f.path));
  if(!jsonFiles.length) throw Error('Corpus needs a JSON review manifest');
  return {schema_version:1,corpus_id:corpusId,consent_asserted:true,
    // The hash is over stable metadata. No machine-specific absolute paths.
    files,inventory_sha256:sha(Buffer.from(JSON.stringify(files))),
    status:'LOCAL_INTEGRITY_ONLY_NOT_DURABLE_STORAGE'};
}
export async function verifyPrivateCorpus(dir,index) {
  if(index?.schema_version!==1 || !Array.isArray(index.files)
      || !validHex(index.inventory_sha256) || !index.consent_asserted) throw Error('Invalid integrity index');
  const actual=await listFiles(resolve(dir));
  if (actual.some(x=>!validHex(x.sha256)) || !index.files.every(x=>safeName(x.path.split('/').at(-1)) && validHex(x.sha256)))
    throw Error('Invalid corpus file record');
  if(sha(Buffer.from(JSON.stringify(index.files)))!==index.inventory_sha256
      || JSON.stringify(actual)!==JSON.stringify(index.files)) throw Error('Corpus integrity mismatch');
  return {verified:true,files:actual.length,corpus_id:index.corpus_id};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [mode,dir,arg]=process.argv.slice(2);
  if(mode==='index'){
    const result=await indexPrivateCorpus(dir,{corpusId:arg,consented:process.env.SCOOP_CORPUS_PERMISSION==='confirmed'});
    await writeFile(join(resolve(dir),'corpus-integrity.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({status:result.status,files:result.files.length,inventory_sha256:result.inventory_sha256}));
  } else if(mode==='verify'){
    const index=JSON.parse(await readFile(join(resolve(dir),'corpus-integrity.json'),'utf8'));
    console.log(JSON.stringify(await verifyPrivateCorpus(dir,index)));
  } else throw Error('Usage: SCOOP_CORPUS_PERMISSION=confirmed node tools/private-corpus-integrity.mjs index DIRECTORY CORPUS_ID | verify DIRECTORY');
}
