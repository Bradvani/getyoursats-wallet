import {randomBytes} from 'node:crypto';
import {sendEmptyWebPush} from './pushCore.mjs';
import {listSubscriptions, receiptKey, redis, removeSubscription} from './pushStore.mjs';

/** Never report or create a wallet receipt here. This only attempts a private
 * OS alert after the upstream provider has cryptographically signed a settled
 * transaction. The actual balance/history is re-read from the wallet SDK. */
export async function notifyWallet(pub,id,eventAt,vapid) {
  const now=Date.now();
  const targets=(await listSubscriptions(pub))
    .filter(x=>x.active===true && Number.isSafeInteger(x.enabledAt)
      && x.enabledAt<=eventAt+90_000 && now-x.enabledAt<180*86400_000);
  if(!targets.length)return {status:200,notified:false};
  const lock=receiptKey(pub,id);
  const nonce=randomBytes(12).toString('hex');
  const acquired=await redis('SET',lock,nonce,'NX','EX',120);
  if(acquired!=='OK'){
    const marker=await redis('GET',lock);
    return {status:marker==='delivered'?200:503,notified:marker==='delivered'};
  }
  let retry=false;
  for(const sub of targets){
    try{
      const result=await sendEmptyWebPush(sub.endpoint,vapid);
      if(result.expired)await removeSubscription(pub,sub.endpoint);
      else if(!result.delivered)retry=true;
    }catch{retry=true;}
  }
  if(retry){
    const release="if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
    await redis('EVAL',release,1,lock,nonce);
    return {status:503,notified:false};
  }
  await redis('SET',lock,'delivered','EX',30*86400);
  return {status:200,notified:true};
}
