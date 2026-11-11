import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {bindAcceptanceDirectory} from '../scripts/security/acceptance-run-binding.mjs';

const binding={schema:1,network:'regtest',realFunds:false,origin:'http://127.0.0.1:5173',sourceCommit:'source-a',
 sourceTree:'tree-a',packageArchiveSha256:'package-a',patchSha256:'patch-a',packageInventorySha256:'inventory-a',files:{fixture:'hash-a'}};
async function fixture(t){
 const parent=await mkdtemp(path.join(tmpdir(),'gys-binding-'));
 t.after(()=>rm(parent,{recursive:true,force:true}));
 const output=path.join(parent,'run');
 await bindAcceptanceDirectory(output,binding);
 for(const name of ['wallet-0','wallet-1'])await mkdir(path.join(output,'profiles',name));
 return {parent,output};
}
test('fresh run binds provenance and identical resume preserves it',async t=>{
 const {output}=await fixture(t),before=await readFile(path.join(output,'acceptance-source.json'),'utf8');
 await bindAcceptanceDirectory(output,binding,true);
 assert.equal(await readFile(path.join(output,'acceptance-source.json'),'utf8'),before);
});
test('fresh creation cannot overwrite retained profiles or a prior run',async t=>{
 const {output}=await fixture(t);
 await assert.rejects(bindAcceptanceDirectory(output,binding),{code:'EEXIST'});
});
for(const key of ['sourceCommit','sourceTree','packageArchiveSha256','patchSha256','packageInventorySha256','origin','files']){
 test(`resume refuses changed ${key} without replacing provenance`,async t=>{
  const {output}=await fixture(t),before=await readFile(path.join(output,'acceptance-source.json'),'utf8');
  await assert.rejects(bindAcceptanceDirectory(output,{...binding,[key]:key==='files'?{fixture:'changed'}:'changed'},true),/different source/);
  assert.equal(await readFile(path.join(output,'acceptance-source.json'),'utf8'),before);
 });
}
test('historical profiles without source binding are refused',async t=>{
 const {output}=await fixture(t);await rm(path.join(output,'acceptance-source.json'));
 await assert.rejects(bindAcceptanceDirectory(output,binding,true),{code:'ENOENT'});
});
test('missing profiles are not silently created during resume',async t=>{
 const {output}=await fixture(t);await rm(path.join(output,'profiles','wallet-1'),{recursive:true});
 await assert.rejects(bindAcceptanceDirectory(output,binding,true),{code:'ENOENT'});
});
test('symlinked profile cannot redirect acceptance to another wallet',async t=>{
 const {output,parent}=await fixture(t);const target=path.join(parent,'other');await mkdir(target);
 await rm(path.join(output,'profiles','wallet-1'),{recursive:true});await symlink(target,path.join(output,'profiles','wallet-1'));
 await assert.rejects(bindAcceptanceDirectory(output,binding,true),/already exist/);
});
