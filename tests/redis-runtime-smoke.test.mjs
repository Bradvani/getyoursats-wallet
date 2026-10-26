import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extractSendBudgetScript,runRedisRuntimeSmoke} from './redis-runtime-smoke.mjs';

const source=await readFile(new URL('../api/account/email.js',import.meta.url),'utf8');
const script=extractSendBudgetScript(source);
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'getyoursats/native-redis-qa-20261026',
  KV_REST_API_URL:'https://private-test-store.invalid',KV_REST_API_TOKEN:'private-write-token',
  KV_REST_API_READ_ONLY_TOKEN:'private-read-token'};

function memoryRedis({readonlyCanWrite=false,luaError='ERR Invalid send budget state',commandErrorStatus=400}={}){
  let now=0;
  const values=new Map(),deadlines=new Map(),commands=[];
  const get=key=>{
    if(deadlines.get(key)<=now){values.delete(key);deadlines.delete(key);}
    return values.get(key)??null;
  };
  function execute(command){
    const [op,...args]=command;
    if(op==='GET')return {result:get(args[0])};
    if(op==='MGET')return {result:args.map(get)};
    if(op==='PTTL')return {result:get(args[0])===null?-2:deadlines.get(args[0])-now};
    if(op==='SET'){
      assert.equal(args[2],'EX');assert.ok(args[3]>0&&args[3]<=120);
      values.set(args[0],String(args[1]));deadlines.set(args[0],now+args[3]*1000);
      return {result:'OK'};
    }
    if(op==='DEL'){
      let removed=0;
      for(const key of args){removed+=Number(get(key)!==null);values.delete(key);deadlines.delete(key);}
      return {result:removed};
    }
    assert.equal(op,'EVAL');
    assert.equal(args[0],script);assert.equal(args[1],6);
    const keys=args.slice(2,8),rules=args.slice(8);
    let blocked=0,retryMs=0;
    for(const [index,key] of keys.entries()){
      const current=get(key);
      if(current===null)continue;
      const count=Number(current),ttl=deadlines.get(key)-now;
      if(!/^[1-9][0-9]*$/.test(current)||!Number.isSafeInteger(count)||ttl<0||ttl>rules[index*3+2]){
        return {error:luaError};
      }
      if(count>=rules[index*3]&&Math.max(1,ttl)>retryMs){blocked=index+1;retryMs=Math.max(1,ttl);}
    }
    if(blocked)return {result:[blocked,retryMs]};
    for(const [index,key] of keys.entries()){
      const count=Number(get(key)??0)+1;
      values.set(key,String(count));
      if(count===1)deadlines.set(key,now+rules[index*3+1]*1000);
    }
    return {result:[0,0]};
  }
  return {values,deadlines,commands,delay:async ms=>{assert.ok(ms<2000);now+=ms;},fetchImpl:async(url,options)=>{
    assert.equal(url,env.KV_REST_API_URL+'/');
    assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
    const command=JSON.parse(options.body);
    commands.push(command);
    if(options.headers.Authorization==='Bearer '+env.KV_REST_API_READ_ONLY_TOKEN){
      if(command[0]!=='GET'&&!readonlyCanWrite)return Response.json({error:'NOPERM read only token cannot write'},{status:400});
    }else assert.equal(options.headers.Authorization,'Bearer '+env.KV_REST_API_TOKEN);
    const payload=execute(command);
    return Response.json(payload,{status:payload.error?commandErrorStatus:200});
  }};
}

test('runtime probe extracts the exact source script and rejects unsafe extraction or preview scope',async()=>{
  assert.ok(source.includes('const SEND_BUDGET_SCRIPT=`'+script+'`;'));
  assert.throws(()=>extractSendBudgetScript('const SEND_BUDGET_SCRIPT=`${dynamic}`;'));
  assert.throws(()=>extractSendBudgetScript(source+source));
  const fail=()=>assert.fail('No Redis call is allowed outside the exact preview scope');
  for(const overrides of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'main'}]){
    await assert.rejects(runRedisRuntimeSmoke(script,{env:{...env,...overrides},fetchImpl:fail}),/protected_scope_required/);
  }
});

test('protected production scope requires opt-in, exact project and real generated Host',async()=>{
  const production={...env,VERCEL_ENV:'production',VERCEL_PROJECT_ID:'prj_bCTyVL32guivsY5i5M0mDXQ0cC03',
    VERCEL_URL:'getyoursats-site-isolated-smoke.vercel.app'};
  const fail=()=>assert.fail('Rejected request scopes must not reach Redis');
  for(const options of [
    {requestHeaders:{host:production.VERCEL_URL}},
    {allowProtectedProduction:true,requestHeaders:{host:'getyoursats.com'}},
    {allowProtectedProduction:true,requestHeaders:{host:'www.getyoursats.com'}},
    {allowProtectedProduction:true,requestHeaders:{host:'getyoursats.com','x-forwarded-host':production.VERCEL_URL}},
    {allowProtectedProduction:true,requestHeaders:{'x-forwarded-host':production.VERCEL_URL}},
    {allowProtectedProduction:true,requestHeaders:{host:'another-deployment.vercel.app','x-original-host':production.VERCEL_URL}},
    {allowProtectedProduction:true,requestHeaders:{host:[production.VERCEL_URL]}},
    {allowProtectedProduction:true,requestHeaders:{host:production.VERCEL_URL},env:{...production,VERCEL_PROJECT_ID:'different-project'}},
    {allowProtectedProduction:true,requestHeaders:{host:'getyoursats.com'},env:{...production,VERCEL_URL:'getyoursats.com'}},
    {allowProtectedProduction:true,requestHeaders:{host:production.VERCEL_URL},env:{...production,VERCEL_URL:undefined}}
  ]){
    await assert.rejects(runRedisRuntimeSmoke(script,{env:production,fetchImpl:fail,...options}),/protected_scope_required/);
  }
  const storage=memoryRedis();
  const report=await runRedisRuntimeSmoke(script,{env:production,...storage,allowProtectedProduction:true,
    requestHeaders:{host:production.VERCEL_URL}});
  assert.equal(report.ok,true,JSON.stringify(report));
  assert.deepEqual(report.cleanup,{completed:true,remainingKeys:0});
});

test('runtime probe confines all commands to temporary keys and cleans every key after success',async()=>{
  const storage=memoryRedis();
  const report=await runRedisRuntimeSmoke(script,{env,...storage});
  assert.equal(report.ok,true,JSON.stringify(report));
  assert.equal(Object.keys(report.checks).length,8);
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.deepEqual(report.cleanup,{completed:true,remainingKeys:0});
  assert.equal(storage.values.size,0);
  assert.equal(report.scriptSha256,createHash('sha256').update(script).digest('hex'));
  assert.equal(report.maxKeyTtlSeconds,120);
  const prefixes=new Set();
  for(const command of storage.commands){
    const keys=command[0]==='EVAL'?command.slice(3,9):command[0]==='SET'?command.slice(1,2):command.slice(1);
    for(const key of keys){
      const match=key.match(/^gys:smoke:redis-runtime:[0-9a-f]{32}:/);
      assert.ok(match,key);prefixes.add(match[0]);
    }
  }
  assert.equal(prefixes.size,1);
  const serialized=JSON.stringify(report);
  for(const privateValue of [env.KV_REST_API_URL,env.KV_REST_API_TOKEN,env.KV_REST_API_READ_ONLY_TOKEN,...prefixes]){
    assert.equal(serialized.includes(privateValue),false);
  }
});

test('runtime probe reports unsafe read-only permissions without exposing values and still cleans up',async()=>{
  const storage=memoryRedis({readonlyCanWrite:true});
  const report=await runRedisRuntimeSmoke(script,{env,...storage});
  assert.equal(report.ok,false);
  assert.equal(report.checks.reservation_and_readonly_permissions,false);
  assert.deepEqual(report.failures,[{check:'reservation_and_readonly_permissions',code:'readonly_write_not_denied'}]);
  assert.deepEqual(report.cleanup,{completed:true,remainingKeys:0});
  assert.equal(storage.values.size,0);
  assert.equal(JSON.stringify(report).includes(env.KV_REST_API_READ_ONLY_TOKEN),false);
});

test('runtime probe accepts only the intended HTTP400 Lua error and never treats provider failures as expected rejection',async()=>{
  for(const options of [{luaError:'ERR unsupported command private-provider-detail'},{commandErrorStatus:503}]){
    const storage=memoryRedis(options);
    const report=await runRedisRuntimeSmoke(script,{env,...storage});
    assert.equal(report.ok,false);
    assert.equal(report.checks.malformed_counters_fail_before_writes,false);
    assert.equal(report.checks.excessive_expiry_fails_before_writes,false);
    assert.equal(report.failures.length,2);
    assert.deepEqual(report.cleanup,{completed:true,remainingKeys:0});
    assert.equal(JSON.stringify(report).includes('private-provider-detail'),false);
    assert.equal(JSON.stringify(report).includes('unsupported command'),false);
  }
});
