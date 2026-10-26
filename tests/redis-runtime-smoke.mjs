import {createHash,randomBytes} from 'node:crypto';

const QA_BRANCH='getyoursats/native-redis-qa-20261026';
const ROOT_SITE_PROJECT_ID='prj_bCTyVL32guivsY5i5M0mDXQ0cC03';
const MAX_TTL_SECONDS=120;

class SmokeFailure extends Error {
  constructor(code){super(code);this.code=code;}
}

function requireCondition(condition,code){if(!condition)throw new SmokeFailure(code);}

export function extractSendBudgetScript(source){
  const matches=[...source.matchAll(/const SEND_BUDGET_SCRIPT=`([\s\S]*?)`;/g)];
  requireCondition(matches.length===1&&!/\\|\$\{/.test(matches[0][1]),'script_source_invalid');
  return matches[0][1];
}

function validScope(env,requestHeaders,allowProtectedProduction){
  if(env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF===QA_BRANCH)return true;
  return allowProtectedProduction===true&&env.VERCEL_ENV==='production'&&
    env.VERCEL_PROJECT_ID===ROOT_SITE_PROJECT_ID&&typeof env.VERCEL_URL==='string'&&
    /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL)&&requestHeaders?.host===env.VERCEL_URL;
}

export async function runRedisRuntimeSmoke(script,{env=process.env,fetchImpl=globalThis.fetch,
  delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),requestHeaders,allowProtectedProduction=false}={}){
  requireCondition(validScope(env,requestHeaders,allowProtectedProduction),'protected_scope_required');
  requireCondition(typeof script==='string'&&script.length>0&&script.length<8000,'script_source_invalid');
  const url=new URL(env.KV_REST_API_URL);
  const writable=env.KV_REST_API_TOKEN,readonly=env.KV_REST_API_READ_ONLY_TOKEN;
  requireCondition(url.protocol==='https:'&&!url.username&&!url.password&&
    typeof writable==='string'&&writable.length>0&&typeof readonly==='string'&&readonly.length>0,
  'redis_configuration_invalid');

  const prefix='gys:smoke:redis-runtime:'+randomBytes(16).toString('hex')+':';
  const ownedKeys=new Set(),checks={},failures=[];
  let requests=0,cleanup={completed:false,remainingKeys:null};
  const key=name=>{const value=prefix+name;ownedKeys.add(value);return value;};
  const keysFor=name=>Array.from({length:6},(_,index)=>key(name+':'+index));
  const rules=(seconds=MAX_TTL_SECONDS,limits=[80,4,4,8,1,1])=>limits.flatMap(max=>[max,seconds,seconds*1000]);

  async function redis(command,{readOnly=false,allowError=false}={}){
    const [operation,...args]=command;
    let touched;
    if(['GET','PTTL'].includes(operation))touched=args;
    else if(['MGET','DEL'].includes(operation))touched=args;
    else if(operation==='SET'){
      const [entry,,expiry,ttl]=args;
      requireCondition(args.length===4&&expiry==='EX'&&Number.isInteger(ttl)&&ttl>0&&ttl<=MAX_TTL_SECONDS,'unsafe_smoke_command');
      touched=[entry];
    }else if(operation==='EVAL'){
      const [body,count,...rest]=args;
      requireCondition(body===script&&count===6&&rest.length===24,'unsafe_smoke_command');
      touched=rest.slice(0,count);
      const limits=rest.slice(count);
      requireCondition(limits.every(Number.isSafeInteger),'unsafe_smoke_command');
      for(let index=0;index<count;index++){
        requireCondition(limits[index*3]>0&&limits[index*3+1]>0&&limits[index*3+1]<=MAX_TTL_SECONDS&&
          limits[index*3+2]>0&&limits[index*3+2]<=MAX_TTL_SECONDS*1000,'unsafe_smoke_command');
      }
    }else throw new SmokeFailure('unsafe_smoke_command');
    requireCondition(touched.length>0&&touched.every(entry=>typeof entry==='string'&&entry.startsWith(prefix)&&ownedKeys.has(entry)),
      'unsafe_smoke_key');
    requests++;
    let response,payload;
    try{
      response=await fetchImpl(url.href,{
        method:'POST',headers:{Authorization:'Bearer '+(readOnly?readonly:writable),'Content-Type':'application/json'},
        body:JSON.stringify(command),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(7500)
      });
      payload=await response.json();
    }catch{throw new SmokeFailure('redis_transport_failed');}
    if(allowError&&payload&&typeof payload.error==='string'&&
        (response.ok||response.status===400||response.status===401||response.status===403))return {error:payload.error};
    requireCondition(response.ok&&payload&&typeof payload==='object'&&!payload.error&&Object.hasOwn(payload,'result'),
      'redis_command_failed');
    return {result:payload.result};
  }

  const value=async command=>(await redis(command)).result;
  const reserve=(entries,args=rules(),options)=>redis(['EVAL',script,6,...entries,...args],options);
  const assertAccepted=result=>requireCondition(Array.isArray(result)&&result.length===2&&result[0]===0&&result[1]===0,
    'reservation_not_accepted');
  const assertDenied=(result,index)=>requireCondition(Array.isArray(result)&&result.length===2&&
    (Array.isArray(index)?index.includes(result[0]):result[0]===index)&&Number.isSafeInteger(result[1])&&result[1]>0&&result[1]<=120000,
  'reservation_not_denied');
  async function check(name,operation){
    try{await operation();checks[name]=true;}
    catch(error){checks[name]=false;failures.push({check:name,code:error instanceof SmokeFailure?error.code:'smoke_check_failed'});}
  }

  try{
    await Promise.all([
      check('reservation_and_readonly_permissions',async()=>{
        const entries=keysFor('permissions');
        assertAccepted((await reserve(entries)).result);
        requireCondition((await value(['MGET',...entries])).every(entry=>String(entry)==='1'),'reservation_values_invalid');
        const ttls=await Promise.all(entries.map(entry=>value(['PTTL',entry])));
        requireCondition(ttls.every(ttl=>Number.isSafeInteger(ttl)&&ttl>0&&ttl<=120000),'reservation_expiry_invalid');
        requireCondition(String((await redis(['GET',entries[0]],{readOnly:true})).result)==='1','readonly_read_failed');
        const writeProbe=key('readonly-write-probe');
        const denied=await redis(['SET',writeProbe,'probe','EX',MAX_TTL_SECONDS],{readOnly:true,allowError:true});
        requireCondition(typeof denied.error==='string'&&/read.?only|not allowed|not permitted|permission|NOPERM|ACL/i.test(denied.error),
          'readonly_write_not_denied');
        requireCondition(await value(['GET',writeProbe])===null,'readonly_write_created_key');
      }),
      check('daily_denial_preserves_allowances',async()=>{
        const entries=keysFor('daily-denial');
        await value(['SET',entries[0],'80','EX',MAX_TTL_SECONDS]);
        const before=await value(['PTTL',entries[0]]);
        for(let index=0;index<3;index++)assertDenied((await reserve(entries)).result,1);
        const counts=await value(['MGET',...entries]);
        requireCondition(String(counts[0])==='80'&&counts.slice(1).every(entry=>entry===null),'denial_changed_allowances');
        const after=await value(['PTTL',entries[0]]);
        requireCondition(after>0&&after<=before,'denial_extended_expiry');
      }),
      check('cooldown_denial_preserves_allowances',async()=>{
        const entries=keysFor('cooldown');
        assertAccepted((await reserve(entries)).result);
        assertDenied((await reserve(entries)).result,[5,6]);
        requireCondition((await value(['MGET',...entries])).every(entry=>String(entry)==='1'),'cooldown_changed_allowances');
      }),
      check('latest_blocker_controls_retry',async()=>{
        const entries=keysFor('latest-blocker');
        await Promise.all([
          value(['SET',entries[0],'80','EX',10]),
          value(['SET',entries[2],'4','EX',30])
        ]);
        const result=(await reserve(entries)).result;
        assertDenied(result,3);
        requireCondition(result[1]>10000&&result[1]<=30000,'latest_retry_invalid');
        const counts=await value(['MGET',...entries]);
        requireCondition(String(counts[0])==='80'&&String(counts[2])==='4'&&
          counts.filter((_,index)=>index!==0&&index!==2).every(entry=>entry===null),'latest_denial_changed_allowances');
      }),
      check('concurrent_final_slot_has_one_winner',async()=>{
        const first=keysFor('concurrent-a'),second=keysFor('concurrent-b');
        second[0]=first[0];
        await value(['SET',first[0],'79','EX',MAX_TTL_SECONDS]);
        const results=await Promise.all([reserve(first),reserve(second)]);
        const winner=results.findIndex(entry=>entry.result?.[0]===0);
        requireCondition(winner>=0,'concurrent_reservation_no_winner');
        assertAccepted(results[winner].result);
        assertDenied(results[1-winner].result,1);
        const entries=[first,second],losing=await value(['MGET',...entries[1-winner].slice(1)]);
        requireCondition(losing.every(entry=>entry===null),'concurrent_denial_changed_allowances');
        requireCondition(String(await value(['GET',first[0]]))==='80','concurrent_global_limit_invalid');
      }),
      check('malformed_counters_fail_before_writes',async()=>{
        for(const [index,invalid] of ['1e0','1.0','-1','broken','9007199254740992'].entries()){
          const entries=keysFor('malformed-'+index);
          await value(['SET',entries[5],invalid,'EX',MAX_TTL_SECONDS]);
          const result=await reserve(entries,rules(),{allowError:true});
          requireCondition(typeof result.error==='string'&&/^(?:ERR )?Invalid send budget state$/.test(result.error),
            'malformed_counter_not_rejected');
          const counts=await value(['MGET',...entries]);
          requireCondition(counts.slice(0,5).every(entry=>entry===null)&&counts[5]===invalid,'malformed_counter_changed_allowances');
        }
      }),
      check('excessive_expiry_fails_before_writes',async()=>{
        const entries=keysFor('invalid-expiry');
        await value(['SET',entries[5],'1','EX',MAX_TTL_SECONDS]);
        const args=rules();args[17]=1000;
        const result=await reserve(entries,args,{allowError:true});
        requireCondition(typeof result.error==='string'&&/^(?:ERR )?Invalid send budget state$/.test(result.error),'invalid_expiry_not_rejected');
        requireCondition((await value(['MGET',...entries.slice(0,5)])).every(entry=>entry===null),'invalid_expiry_changed_allowances');
      }),
      check('expired_windows_accept_new_reservation',async()=>{
        const entries=keysFor('expiry'),args=rules(1,[1,1,1,1,1,1]);
        assertAccepted((await reserve(entries,args)).result);
        assertDenied((await reserve(entries,args)).result,[1,2,3,4,5,6]);
        await delay(1100);
        requireCondition((await value(['MGET',...entries])).every(entry=>entry===null),'window_did_not_expire');
        assertAccepted((await reserve(entries,args)).result);
        requireCondition((await value(['MGET',...entries])).every(entry=>String(entry)==='1'),'expired_window_not_reset');
      })
    ]);
  }finally{
    try{
      const entries=[...ownedKeys];
      await value(['DEL',...entries]);
      const remaining=await value(['MGET',...entries]);
      requireCondition(Array.isArray(remaining)&&remaining.length===entries.length,'cleanup_result_invalid');
      cleanup={completed:remaining.every(entry=>entry===null),remainingKeys:remaining.filter(entry=>entry!==null).length};
      if(!cleanup.completed)failures.push({check:'cleanup',code:'smoke_cleanup_incomplete'});
    }catch{failures.push({check:'cleanup',code:'smoke_cleanup_failed'});}
  }
  return {ok:failures.length===0,scriptSha256:createHash('sha256').update(script).digest('hex'),
    checks,failures,requests,temporaryKeys:ownedKeys.size,maxKeyTtlSeconds:MAX_TTL_SECONDS,cleanup};
}

export function createRedisSmokeHandler(script,{allowProtectedProduction=false}={}){
  let result;
  return async function handler(req,res){
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('CDN-Cache-Control','no-store');
    res.setHeader('Vercel-CDN-Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(!validScope(process.env,req.headers,allowProtectedProduction)){
      res.statusCode=404;res.end(JSON.stringify({ok:false,error:'unavailable'}));return;
    }
    if(req.method!=='GET'){res.setHeader('Allow','GET');res.statusCode=405;res.end(JSON.stringify({ok:false,error:'method_not_allowed'}));return;}
    try{
      result??=runRedisRuntimeSmoke(script,{requestHeaders:req.headers,allowProtectedProduction});
      const report=await result;
      res.statusCode=report.ok?200:503;
      res.end(JSON.stringify(report));
    }catch(error){
      res.statusCode=503;
      res.end(JSON.stringify({ok:false,error:error instanceof SmokeFailure?error.code:'smoke_setup_failed'}));
    }
  };
}
