import {execFileSync} from 'node:child_process';
import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('dist-rollback');
async function files(dir){const out=[];for(const name of await readdir(dir)){const full=path.join(dir,name);if((await stat(full)).isDirectory())out.push(...await files(full));else out.push(full);}return out;}
const hashes={};
for(const file of (await files(root)).sort()){
 const relative=path.relative(root,file);if(relative==='rollback-manifest.json')continue;
 hashes[relative]=createHash('sha256').update(await readFile(file)).digest('hex');
}
const html=await readFile(path.join(root,'index.html'),'utf8');
if(!html.includes("connect-src 'none'")||!html.includes("worker-src 'none'"))throw new Error('Containment CSP missing');
for(const file of Object.keys(hashes).filter(f=>f.endsWith('.js'))){
 const js=await readFile(path.join(root,file),'utf8');
 for(const forbidden of ['localStorage.setItem','localStorage.removeItem','localStorage.clear','indexedDB.deleteDatabase','sendPayment','connectWithSigner','navigator.serviceWorker.register'])
  if(js.includes(forbidden))throw new Error('Unexpected capability in rollback artifact: '+forbidden);
}
const manifest={schema:1,kind:'read-only-containment-rollback',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 vaultFormats:[1],paymentJournalFormats:[1],signedRecoveryFormats:[1],pendingExitPolicy:'preserve byte-for-byte; never broadcast or rebuild',
 mutations:false,networkConnections:false,signing:false,fundsEnabled:false,physicalDeviceAcceptance:false,
 serviceWorkerPolicy:'refuse unlock while controlled by an existing worker; no automatic unregister or storage wipe',files:hashes};
await writeFile(path.join(root,'rollback-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
