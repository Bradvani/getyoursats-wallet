import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {createDirectRecipientDirectory} from '../site/server/gysDirectRecipients.mjs';

const execute=promisify(execFile);
const keys=['0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '0379be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'];
test('independent directory instances reject conflicting owners atomically in disposable Redis',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'gys-direct-directory-'));
  const socket=join(directory,'redis.sock');
  const child=spawn(process.env.GYS_REDIS_SERVER||'redis-server',['--port','0','--unixsocket',socket,
    '--save','','--appendonly','no','--dir',directory],{stdio:'ignore'});
  let startupError;
  child.on('error',error=>{startupError=error;});
  const closed=new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);});
  t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await closed;await rm(directory,{recursive:true,force:true});});
  const redis=async(...args)=>{
    const {stdout}=await execute(process.env.GYS_REDIS_CLI||'redis-cli',['-s',socket,'--json',...args.map(String)],{timeout:5000});
    return JSON.parse(stdout.trim());
  };
  for(let attempt=0;;attempt++){
    if(startupError)throw startupError;
    try{if(await redis('PING')==='PONG')break;}catch{if(attempt>=100)throw new Error('Redis unavailable');}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  const env={GETYOURSATS_DIRECT_PAYMENTS_ENABLED:'true',KV_REST_API_URL:'https://disposable.invalid',KV_REST_API_TOKEN:'disposable'};
  const fetchImpl=async(_url,options)=>Response.json({result:await redis(...JSON.parse(options.body))});
  const lookup=async name=>({tag:'payRequest',callback:`https://getyoursats.com/lnurlp/${name}/invoice`,
    metadata:JSON.stringify([['text/identifier',name+'@getyoursats.com']]),allowsNostr:true,nostrPubkey:'a'.repeat(64)});
  const first=createDirectRecipientDirectory({env,fetchImpl,lookup});
  const second=createDirectRecipientDirectory({env,fetchImpl,lookup});
  const response=name=>({lightning_address:name+'@getyoursats.com',lnurl:'lnurlp://getyoursats.com/lnurlp/'+name});
  await Promise.all([first.capture(keys[0],response('alice')),second.capture(keys[0],response('alice'))]);
  const before=await second.resolve('alice');
  assert.equal(before.available,true);
  assert.equal(before.identityPublicKey,keys[0]);
  await first.capture(keys[0],response('alice'));
  assert.equal((await second.resolve('alice')).bindingId,before.bindingId);
  await Promise.all([first.capture(keys[0],response('alice')),second.capture(keys[1],response('alice'))]);
  assert.deepEqual(await first.resolve('alice'),{available:false});
  await first.capture(keys[0],response('alice'));
  assert.deepEqual(await second.resolve('alice'),{available:false});
  assert.equal(await redis('TTL','gys:direct:v1:alice'),-1);
  await first.capture(keys[0],response('bravo'));
  assert.ok(await redis('TTL','gys:direct:v1:bravo')>0);
});
