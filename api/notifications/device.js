import {isIP} from 'node:net';
import {
  ORIGIN, walletPubkey, verifyOwnership, vapidConfig, checkedSubscription, pushEndpoint
} from '../../server/pushCore.mjs';
import {
  storeReady, issueChallenge, consumeChallenge, ensureWallet, getWallet,
  saveSubscription, activateSubscription, removeSubscription, getSubscription,
} from '../../server/pushStore.mjs';

const MAX_BODY=8192;
function respond(res,status,body){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function available(){
  if(process.env.GYS_PUSH_ENABLED!=='true'||!storeReady())return null;
  try{return vapidConfig();}catch{return null;}
}
async function readBody(req) {
  const declared=req.headers['content-length'];
  if(declared!=null&&(!/^\d+$/.test(String(declared))||Number(declared)>MAX_BODY))
    throw Object.assign(new Error('Invalid request size'),{status:413});
  if(typeof req.body==='object'&&req.body){
    if(Buffer.byteLength(JSON.stringify(req.body))>MAX_BODY)throw Object.assign(new Error('Invalid request size'),{status:413});
    return req.body;
  }
  if(typeof req.body==='string'){
    if(Buffer.byteLength(req.body)>MAX_BODY)throw Object.assign(new Error('Invalid request size'),{status:413});
    return JSON.parse(req.body);
  }
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    size+=Buffer.byteLength(chunk);
    if(size>MAX_BODY)throw Object.assign(new Error('Invalid request size'),{status:413});
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function clientIp(req){
  const ip=req.headers['x-vercel-forwarded-for'];
  if(typeof ip!=='string'||!isIP(ip)||/[\s,%\[\]]/.test(ip))
    throw Object.assign(new Error('Client identity unavailable'),{status:403});
  return ip;
}
const PURPOSES=new Set(['subscribe','activate','status','unsubscribe']);
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('CDN-Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const config=available();
  if(req.method==='GET'){
    respond(res,200,{available:!!config,vapidPublicKey:config?.pub??null,
      lightningInvoicePushAvailable:!!config,
      lightningAddressPushAvailable:false});return;
  }
  if(req.method!=='POST'){
    res.setHeader('Allow','GET, POST');
    respond(res,405,{error:'Method not allowed'});return;
  }
  if(req.headers.origin!==ORIGIN||
      typeof req.headers['content-type']!=='string'||
      req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json') {
    respond(res,403,{error:'Unsupported origin'});return;
  }
  if(!config){respond(res,503,{error:'Payment notifications are not enabled'});return;}
  try {
    const body=await readBody(req);
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw Object.assign(new Error('Invalid request'),{status:400});
    const action=body.action;
    const pub=walletPubkey(body.walletPubkey);
    if(action==='challenge') {
      if(!PURPOSES.has(body.purpose))
        throw Object.assign(new Error('Invalid purpose'),{status:400});
      const challenge=await issueChallenge(body.purpose,pub,clientIp(req));
      respond(res,200,challenge);return;
    }
    if(!PURPOSES.has(action))throw Object.assign(new Error('Invalid action'),{status:400});
    await consumeChallenge(action,pub,body.challengeId,body.signature,verifyOwnership);
    if(action==='status') {
      const endpoint=pushEndpoint(body.endpoint);
      const subscribed=await getSubscription(pub,endpoint);
      const wallet=await getWallet(pub);
      respond(res,200,{enabled:subscribed?.active===true,
        webhookRegistered:!!wallet?.registered});return;
    }
    if(action==='subscribe'){
      const subscription=checkedSubscription(body.subscription);
      const id=await saveSubscription(pub,subscription);
      const wallet=await ensureWallet(pub);
      respond(res,200,{
        subscriptionId:id,
        webhookRegistered:!!wallet.registered,
        webhookUrl:ORIGIN+'/api/notifications/spark?wallet='+pub,
        webhookSecret:wallet.secret,
        eventTypes:[{type:'lightningReceiveFinished'}]
      });return;
    }
    const endpoint=pushEndpoint(body.endpoint);
    if(action==='activate'){
      const webhookId=body.webhookId;
      const wallet=await getWallet(pub);
      if(!wallet || (wallet.registered!==true &&
        (typeof webhookId!=='string'|| !/^[A-Za-z0-9_-]{5,180}$/.test(webhookId))))
        throw Object.assign(new Error('Provider webhook not registered'),{status:409});
      await activateSubscription(pub,endpoint,webhookId||wallet.webhookId);
      respond(res,200,{enabled:true});return;
    }
    if(action==='unsubscribe'){
      await removeSubscription(pub,endpoint);
      respond(res,200,{enabled:false});return;
    }
  } catch(err) {
    const status=Number.isSafeInteger(err?.status)?err.status:400;
    respond(res,status,{error:status>=500?'Notification service unavailable':String(err?.message||'Invalid request')});
  }
}
