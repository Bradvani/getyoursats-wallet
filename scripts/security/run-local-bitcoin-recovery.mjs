/** Reproducible local-only recovery acceptance. Never uses a user datadir,
 * faucet, external operator, mainnet or supplied wallet credentials. */
import {spawn,execFileSync} from 'node:child_process';
import {access,chmod,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createWriteStream,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const options=new Map();
for(let i=2;i<process.argv.length;i+=2){
 const key=process.argv[i],value=process.argv[i+1];
 if(!['--bitcoind','--bitcoin-cli','--evidence-dir'].includes(key)||!value||options.has(key))throw Error('Expected --bitcoind, --bitcoin-cli and --evidence-dir, each once.');
 options.set(key,value);
}
if(options.size!==3)throw Error('All three explicit paths are required.');
const daemon=resolve(options.get('--bitcoind')),cli=resolve(options.get('--bitcoin-cli')),out=resolve(options.get('--evidence-dir'));
await access(daemon,constants.X_OK);await access(cli,constants.X_OK);
await mkdir(out,{recursive:true});
if((await readdir(out)).length)throw Error('Use a new empty evidence directory; earlier receipts are never overwritten.');
const hash=data=>createHash('sha256').update(data).digest('hex');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const receipt={schema:1,scope:'local-only Bitcoin Core controller/transport acceptance',
 sourceRevision:git('rev-parse','HEAD'),sourceTree:git('rev-parse','HEAD^{tree}'),sourceDirty:git('status','--porcelain')!=='',
 startedAt:new Date().toISOString(),publicProviderOperations:0,mainnetOperations:0,
 binaries:{bitcoind:hash(await readFile(daemon)),bitcoinCli:hash(await readFile(cli))},
 version:execFileSync(daemon,['--version'],{encoding:'utf8'}).split('\n')[0],
 limits:['Core supplies the signed transaction; Spark SDK signing is not verified',
 'Restart is controller/session reconstruction, not browser or Core-process restart',
 'No Lightning/Spark settlement, legacy-wallet migration, hardware or independent audit approval'],
 result:'NOT_RUN',cleanupComplete:false};
for(const port of [18443,3002])await new Promise((resolve,reject)=>{
 const server=createServer();server.once('error',()=>reject(Error(`Local acceptance port ${port} is already in use; no existing service was changed.`)));
 server.listen(port,'127.0.0.1',()=>server.close(resolve));
});
const dataDir=await mkdtemp(join(tmpdir(),'gys-core-acceptance-'));await chmod(dataDir,0o700);
const streams=[];
function launch(command,args,log,env=process.env){
 const stream=createWriteStream(join(out,log),{flags:'wx'});streams.push(stream);
 const child=spawn(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});
 child.on('error',()=>{});return child;
}
const rpc=(method,...args)=>{
 const result=execFileSync(cli,['-regtest',`-datadir=${dataDir}`,method,...args],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','pipe']});
 try{return JSON.parse(result);}catch{return result.trim();}
};
async function waitFor(check,ms){const until=Date.now()+ms;let last;while(Date.now()<until){try{return await check();}catch(e){last=e;await delay(150);}}throw last??Error('Acceptance startup timed out');}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),delay(4000,undefined,{ref:false})]);
 if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await ended;}
}
let core,bridge,tests,error;
try{
 core=launch(daemon,['-regtest',`-datadir=${dataDir}`,'-connect=0','-listen=0','-dnsseed=0','-discover=0',
  '-upnp=0','-natpmp=0','-server=1','-txindex=1','-fallbackfee=0.0001','-rpcbind=127.0.0.1','-rpcallowip=127.0.0.1'], 'core.log');
 await waitFor(()=>{if(core.exitCode!==null)throw Error('Local Bitcoin Core did not start');const state=rpc('getblockchaininfo');if(state.chain!=='regtest')throw Error('Unexpected chain');return state;},15000);
 if(rpc('getpeerinfo').length!==0)throw Error('Local regtest unexpectedly has peers');
 bridge=launch('python3',['scripts/security/bitcoin-regtest-server.py'],'bridge.log',{...process.env,BITCOIN_CLI:cli,BITCOIN_REGTEST_DATADIR:dataDir});
 const url='http://127.0.0.1:3002';
 await waitFor(async()=>{if(bridge.exitCode!==null)throw Error('Local bridge did not start');const r=await fetch(url+'/test/state',{signal:AbortSignal.timeout(1500)});if(!r.ok||(await r.json()).chain!=='regtest')throw Error('Local bridge not ready');},20000);
 tests=launch(process.execPath,['node_modules/vitest/vitest.mjs','run','src/security/bitcoinRegtest.integration.test.ts',
  '--reporter=json',`--outputFile=${join(out,'result.json')}`],'test.log',{...process.env,GYS_DISPOSABLE_BITCOIN_REGTEST:'1'});
 const exit=await Promise.race([new Promise(r=>{tests.once('exit',r);tests.once('error',()=>r(-1));}),delay(100000,undefined,{ref:false}).then(()=>-2)]);
 if(exit!==0)throw Error(`Local Bitcoin recovery test failed (exit ${exit}).`);
 const report=JSON.parse(await readFile(join(out,'result.json'),'utf8'));
 if(report.success!==true||report.numPassedTests!==1||report.numFailedTests!==0||report.numPendingTests!==0)throw Error('The required real-node test was not executed successfully');
 const response=await fetch(url+'/test/state',{signal:AbortSignal.timeout(2000)});const state=await response.json();
 if(state.chain!=='regtest'||state.posts.length!==2||state.posts[0]!==state.posts[1]||state.mempool.length!==0||rpc('getpeerinfo').length!==0)throw Error('Unexpected final local-node evidence');
 receipt.chain='regtest';receipt.sameTransactionBroadcasts=state.posts;receipt.peerCount=0;
 receipt.finalHeight=rpc('getblockcount');receipt.result='PASS';receipt.reportSha256=hash(await readFile(join(out,'result.json')));
}catch(e){error=e;receipt.result='FAIL';receipt.error=e instanceof Error?e.message:String(e);}
finally{
 await stop(tests);await stop(bridge);
 if(core&&core.exitCode===null){try{rpc('stop');await Promise.race([new Promise(r=>core.once('exit',r)),delay(4000,undefined,{ref:false})]);}catch{}await stop(core);}
 await rm(dataDir,{recursive:true,force:true});
 for(const stream of streams)await new Promise(r=>stream.end(r));
 receipt.cleanupComplete=true;receipt.finishedAt=new Date().toISOString();
 await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
}
console.log(JSON.stringify(receipt));
if(error)throw error;
