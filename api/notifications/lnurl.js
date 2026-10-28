import {createHmac,timingSafeEqual} from 'node:crypto';
import {walletPubkey,vapidConfig ,readBoundedRawBody} from '../../server/pushCore.mjs';
import {storeReady} from '../../server/pushStore.mjs';
import {notifyWallet} from '../../server/notifyFanout.mjs';

const MAX_RAW=16_384;
const response=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store',
  'CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function ready(){
  if(process.env.GYS_PUSH_ENABLED!=='true'||process.env.GYS_BREEZ_LNURL_PUSH_ENABLED!=='true'||!storeReady())return null;
  const secret=process.env.GYS_BREEZ_LNURL_WEBHOOK_SECRET;
  if(typeof secret!=='string'||secret.length<32)return null;
  try{return {secret,vapid:vapidConfig()};}catch{return null;}
}
export async function POST(request){
  const cfg=ready();
  if(!cfg)return response(503,{error:'Lightning Address notifications unavailable'});
  try{
    const raw=await readBoundedRawBody(request,MAX_RAW);
    if(!raw.length||raw.length>MAX_RAW)return response(413,{error:'Invalid event size'});
    const signature=request.headers.get('x-breez-signature');
    if(!signature||!/^[a-f0-9]{64}$/i.test(signature))
      return response(401,{error:'Invalid signature'});
    const expected=createHmac('sha256',cfg.secret).update(raw).digest();
    if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))
      return response(401,{error:'Invalid signature'});
    const event=JSON.parse(raw.toString('utf8'));
    if(event?.template!=='spark_payment_received'||!event.data||
      typeof event.data!=='object'||Array.isArray(event.data))
      return response(200,{accepted:true,notified:false});
    const payload=event.data;
    const pub=walletPubkey(payload.user_pubkey);
    const address=payload.lightning_address;
    if(typeof address!=='string'|| !/^[a-z][a-z0-9]{2,23}@getyoursats\.com$/i.test(address))
      return response(400,{error:'Unsupported payment address'});
    const hash=payload.payment_hash;
    if(typeof hash!=='string'|| !/^[a-f0-9]{64}$/i.test(hash))
      return response(400,{error:'Invalid payment reference'});
    if(!Number.isSafeInteger(payload.timestamp)||Math.abs(Date.now()-payload.timestamp)>7*86400_000)
      return response(400,{error:'Invalid event age'});
    const result=await notifyWallet(pub,'lnurl:'+hash.toLowerCase(),payload.timestamp,cfg.vapid);
    if(result.status!==200)return response(503,{error:'Push temporarily unavailable'});
    return response(200,{accepted:true,notified:result.notified});
  }catch{
    return response(503,{error:'Notification delivery unavailable'});
  }
}
export function GET(){return response(405,{error:'Method not allowed'});}
