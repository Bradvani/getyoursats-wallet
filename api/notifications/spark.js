import {randomBytes} from 'node:crypto';
import {walletPubkey, verifySparkWebhook, vapidConfig, sendEmptyWebPush} from '../../server/pushCore.mjs';
import {storeReady, getWallet, listSubscriptions, receiptKey, redis, removeSubscription} from '../../server/pushStore.mjs';

const MAX_RAW=16_384;
function respond(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
async function rawRequest(req){
  const declared=req.headers['content-length'];
  if(declared!=null&&(!/^\d+$/.test(String(declared))||Number(declared)>MAX_RAW))
    throw Object.assign(new Error('Invalid webhook payload'),{status:413});
  if(Buffer.isBuffer(req.body)){
    if(req.body.length>MAX_RAW)throw Object.assign(new Error('Invalid webhook payload'),{status:413});
    return req.body;
  }
  if(typeof req.body==='string'){
    const bytes=Buffer.from(req.body,'utf8');
    if(bytes.length>MAX_RAW)throw Object.assign(new Error('Invalid webhook payload'),{status:413});
    return bytes;
  }
  if(req.body && typeof req.body==='object'){
    // Strictly fail closed: Vercel must preserve original raw bytes for HMAC.
    throw Object.assign(new Error('Raw webhook body unavailable'),{status:400});
  }
  let length=0;const bytes=[];
  for await (const part of req){
    const chunk=Buffer.from(part);
    length+=chunk.length;
    if(length>MAX_RAW)throw Object.assign(new Error('Invalid webhook payload'),{status:413});
    bytes.push(chunk);
  }
  return Buffer.concat(bytes);
}
function configured(){
  if(process.env.GYS_PUSH_ENABLED!=='true'||!storeReady())return null;
  try{return vapidConfig();}catch{return null;}
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    respond(res,405,{error:'Method not allowed'});return;
  }
  const config=configured();
  if(!config){respond(res,503,{error:'Notifications unavailable'});return;}
  try{
    const input=new URL(req.url,'https://wallet.getyoursats.com');
    const pub=walletPubkey(input.searchParams.get('wallet'));
    const wallet=await getWallet(pub);
    if(!wallet || wallet.registered!==true){
      respond(res,404,{error:'Webhook not registered'});return;
    }
    const raw=await rawRequest(req);
    const parsed=verifySparkWebhook(raw,pub,wallet.secret,req.headers['x-spark-signature']);
    if(!parsed.ok){
      respond(res,parsed.reason==='unauthenticated'?401:400,{error:'Invalid webhook'});return;
    }
    if(!parsed.notify){
      respond(res,200,{accepted:true,notified:false});return;
    }
    const now=Date.now();
    const subscriptions=(await listSubscriptions(pub))
      .filter(x=>x.active===true && Number.isSafeInteger(x.enabledAt) && x.enabledAt<=parsed.ts+90_000
        && now-x.enabledAt<180*86400_000);
    if(!subscriptions.length){
      respond(res,200,{accepted:true,notified:false});return;
    }
    const lock=receiptKey(pub,parsed.id);
    const nonce=randomBytes(12).toString('hex');
    const claimed=await redis('SET',lock,nonce,'NX','EX',120);
    if(claimed!=='OK'){
      const marker=await redis('GET',lock);
      respond(res,marker==='delivered'?200:503,{accepted:marker==='delivered'});return;
    }
    let retry=false;
    try{
      for(const sub of subscriptions){
        try{
          const result=await sendEmptyWebPush(sub.endpoint,config);
          if(result.expired)await removeSubscription(pub,sub.endpoint);
          else if(!result.delivered && result.transient)retry=true;
          else if(!result.delivered)retry=true;
        }catch{
          retry=true;
        }
      }
    }catch{
      retry=true;
    }
    if(retry){
      // A provider retries 5xx callbacks. Unlock only if this delivery
      // invocation still owns the lock; never destroy another worker's lock.
      await redis('EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,lock,nonce);
      respond(res,503,{error:'Push service unavailable'});return;
    }
    await redis('SET',lock,'delivered','EX',30*86400);
    respond(res,200,{accepted:true});
  }catch(err){
    const status=Number.isSafeInteger(err?.status)?err.status:503;
    respond(res,status,{error:status===503?'Notification delivery unavailable':'Invalid notification event'});
  }
}
