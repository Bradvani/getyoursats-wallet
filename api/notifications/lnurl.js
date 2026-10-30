import {createHmac,timingSafeEqual} from 'node:crypto';
import {walletPubkey,vapidConfig,readBoundedRawBody,breezLnurlSecret} from '../../server/pushCore.mjs';
import {storeReady} from '../../server/pushStore.mjs';
import {notifyWallet} from '../../server/notifyFanout.mjs';

const MAX_RAW=16_384;
const response=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store',
  'CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function ready(){
  const secret=breezLnurlSecret();
  if(!secret||!storeReady())return null;
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
    let event;
    try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{return response(400,{error:'Invalid event payload'});}
    if(!event||typeof event!=='object'||Array.isArray(event))
      return response(400,{error:'Invalid event payload'});
    if(event.template!=='spark_payment_received')
      return response(200,{accepted:true,notified:false});
    if(!event.data||typeof event.data!=='object'||Array.isArray(event.data))
      return response(400,{error:'Invalid event payload'});
    const payload=event.data;
    let pub;
    try{pub=walletPubkey(payload.user_pubkey);}
    catch{return response(400,{error:'Invalid wallet identifier'});}
    const address=payload.lightning_address;
    // Breez documents a nullable address. The domain's HMAC secret and signed
    // user_pubkey identify the receiver in that case. A supplied foreign domain
    // is rejected; breez.tips invoices are outside this domain webhook's scope.
    if(address!==null && (typeof address!=='string'|| !/^[^@\s]{1,64}@getyoursats\.com$/i.test(address)))
      return response(400,{error:'Unsupported payment address'});
    const hash=payload.payment_hash;
    if(typeof hash!=='string'|| !/^[a-f0-9]{64}$/i.test(hash))
      return response(400,{error:'Invalid payment reference'});
    if(!Number.isSafeInteger(payload.timestamp)||Date.now()-payload.timestamp>7*86400_000||payload.timestamp-Date.now()>300_000)
      return response(400,{error:'Invalid event age'});
    const result=await notifyWallet(pub,'lightning:'+hash.toLowerCase(),payload.timestamp,cfg.vapid);
    if(result.status!==200)return response(503,{error:'Push temporarily unavailable'});
    return response(200,{accepted:true,notified:result.notified});
  }catch(error){
    if(error?.status===413)return response(413,{error:'Invalid event size'});
    return response(503,{error:'Notification delivery unavailable'});
  }
}
export function GET(){return response(405,{error:'Method not allowed'});}
