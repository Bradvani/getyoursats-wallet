import {randomBytes} from 'node:crypto';
import {walletPubkey, verifySparkWebhook, vapidConfig, sendEmptyWebPush} from '../../server/pushCore.mjs';
import {storeReady, getWallet, listSubscriptions, receiptKey, redis, removeSubscription} from '../../server/pushStore.mjs';

const MAX_RAW=16_384;
const response=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store',
  'CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function configured(){
  if(process.env.GYS_PUSH_ENABLED!=='true'||!storeReady())return null;
  try{return vapidConfig();}catch{return null;}
}
// Use Vercel's Web Request signature so raw bytes are never modified by
// req.body's JSON helper before HMAC verification.
export async function POST(request){
  const config=configured();
  if(!config)return response(503,{error:'Notifications unavailable'});
  try{
    const input=new URL(request.url);
    const pub=walletPubkey(input.searchParams.get('wallet'));
    const wallet=await getWallet(pub);
    if(!wallet || wallet.registered!==true)
      return response(404,{error:'Webhook not registered'});
    const contentLength=request.headers.get('content-length');
    if(contentLength!=null&&(!/^\\d+$/.test(contentLength)||Number(contentLength)>MAX_RAW))
      return response(413,{error:'Invalid payload size'});
    const raw=Buffer.from(await request.arrayBuffer());
    if(!raw.length||raw.length>MAX_RAW)return response(413,{error:'Invalid payload size'});
    const parsed=verifySparkWebhook(raw,pub,wallet.secret,request.headers.get('x-spark-signature'));
    if(!parsed.ok)return response(parsed.reason==='unauthenticated'?401:400,{error:'Invalid webhook'});
    if(!parsed.notify)return response(200,{accepted:true,notified:false});
    const now=Date.now();
    const subscriptions=(await listSubscriptions(pub))
      .filter(x=>x.active===true && Number.isSafeInteger(x.enabledAt)
        && x.enabledAt<=parsed.ts+90_000 && now-x.enabledAt<180*86400_000);
    if(!subscriptions.length)return response(200,{accepted:true,notified:false});
    const lock=receiptKey(pub,parsed.id);
    const nonce=randomBytes(12).toString('hex');
    const claimed=await redis('SET',lock,nonce,'NX','EX',120);
    if(claimed!=='OK'){
      const marker=await redis('GET',lock);
      return response(marker==='delivered'?200:503,{accepted:marker==='delivered'});
    }
    let retry=false;
    for(const sub of subscriptions){
      try{
        const result=await sendEmptyWebPush(sub.endpoint,config);
        if(result.expired)await removeSubscription(pub,sub.endpoint);
        else if(!result.delivered)retry=true;
      }catch{retry=true;}
    }
    if(retry){
      // Breez retries non-2xx webhooks. Unlock only this delivery's lock.
      await redis('EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,lock,nonce);
      return response(503,{error:'Push service unavailable'});
    }
    await redis('SET',lock,'delivered','EX',30*86400);
    return response(200,{accepted:true});
  }catch(err){
    const status=Number.isSafeInteger(err?.status)?err.status:503;
    return response(status,{error:status===503?'Notification delivery unavailable':'Invalid notification event'});
  }
}
export function GET(){return response(405,{error:'Method not allowed'});}
