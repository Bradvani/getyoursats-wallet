import {walletPubkey, verifySparkWebhook, vapidConfig} from '../../server/pushCore.mjs';
import {notifyWallet} from '../../server/notifyFanout.mjs';
import {storeReady, getWallet} from '../../server/pushStore.mjs';

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
    const result=await notifyWallet(pub,'spark:'+parsed.id,parsed.ts,config);
    if(result.status!==200)return response(503,{error:'Push service unavailable'});
    return response(200,{accepted:true});
  }catch(err){
    const status=Number.isSafeInteger(err?.status)?err.status:503;
    return response(status,{error:status===503?'Notification delivery unavailable':'Invalid notification event'});
  }
}
export function GET(){return response(405,{error:'Method not allowed'});}
