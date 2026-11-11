/** Offline provenance gate. This module never imports an SDK or opens a wallet. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCanonicalInstalledSdk} from './verify-canonical-installed-sdk.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();

export async function acceptanceSourceBinding(origin){
 assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/,'Acceptance must use an explicit local origin');
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','Commit acceptance source before opening profiles');
 const canonical=verifyCanonicalInstalledSdk();
 const files={};
 for(const name of ['e2e/fixtures/disposable-wallet-acceptance.html','e2e/fixtures/disposable-wallet-acceptance.ts',
  'scripts/security/accept-disposable-spark.mjs','scripts/security/acceptance-run-binding.mjs']){
  files[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
 }
 return {schema:1,network:'regtest',realFunds:false,origin,sourceCommit:git('rev-parse','HEAD'),
  sourceTree:git('rev-parse','HEAD^{tree}'),packageArchiveSha256:canonical.packageArchiveSha256,
  patchSha256:canonical.patchSha256,packageInventorySha256:canonical.packageInventorySha256,files};
}

/** A new run must own a new directory. Resume requires exactly the same binding. */
export async function bindAcceptanceDirectory(output,binding,resume=false){
 assert(path.isAbsolute(output),'Acceptance evidence directory must be absolute');
 assert.equal(path.resolve(output),output,'Acceptance directory must be normalized');
 assert.notEqual(output,path.parse(output).root,'A dedicated acceptance directory is required');
 assert.equal(binding.network,'regtest');assert.equal(binding.realFunds,false);
 const manifest=path.join(output,'acceptance-source.json');
 if(resume){
  const stat=await lstat(output);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'Profile root must be a real directory');
  assert.equal(await realpath(output),output,'Profile ancestry must not use symbolic links');
  const fileStat=await lstat(manifest);assert(fileStat.isFile()&&!fileStat.isSymbolicLink(),'A regular source binding is required');
  assert.deepEqual(JSON.parse(await readFile(manifest,'utf8')),binding,'Retained profiles belong to a different source, SDK or origin; preserve them');
  for(const name of ['profiles','profiles/wallet-0','profiles/wallet-1']){
   const entry=path.join(output,name),stat=await lstat(entry);
   assert(stat.isDirectory()&&!stat.isSymbolicLink(),'Bound profiles must already exist');
   assert.equal(await realpath(entry),entry,'Profile paths must not use symbolic links');
  }
 }else{
  assert.equal(await realpath(path.dirname(output)),path.dirname(output),'Run parent must be an existing real directory');
  await mkdir(output,{mode:0o700}); // EEXIST deliberately refuses even an empty old run.
  await writeFile(manifest,JSON.stringify(binding,null,2)+'\n',{flag:'wx',mode:0o600});
  await mkdir(path.join(output,'profiles'),{mode:0o700});
 }
 return binding;
}
