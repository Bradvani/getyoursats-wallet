import {createChainClient,type ChainClient,DEFAULT_REQUEST_TIMEOUT_MS} from '../services/chain';
import {esploraBaseUrl} from '../services/esplora';
import type {Network} from '@breeztech/breez-sdk-spark';
export interface RecoveryTransport extends ChainClient {
 confirmed(txId:string,txHex:string):Promise<boolean>;
}
/** A failed request or a mempool acknowledgement is not settlement. No signing
 * or broadcast occurs here. This uses the configured chain-service trust model,
 * not independent SPV/header verification. */
export function createRecoveryTransport(network:Network):RecoveryTransport{
 const chain=createChainClient(network);
 const base=esploraBaseUrl(network);
 const get=async(path:string)=>fetch(base+path,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)});
 return {...chain,async confirmed(txId:string,txHex:string):Promise<boolean>{
  if(!/^[0-9a-f]{64}$/.test(txId))throw new Error('Invalid recovery transaction ID');
  const statusResponse=await get('/tx/'+txId+'/status');
  if(statusResponse.status===404)return false;
  if(!statusResponse.ok)throw new Error('Recovery transaction status is unavailable');
  const status:unknown=await statusResponse.json();
  if(!status||typeof status!=='object'||Reflect.get(status,'confirmed')!==true)return false;
  const height=Reflect.get(status,'block_height'),hash=Reflect.get(status,'block_hash');
  if(!Number.isSafeInteger(height)||height<0||typeof hash!=='string'||!/^[0-9a-f]{64}$/.test(hash))
   throw new Error('Invalid recovery confirmation evidence');
  const [raw,canonical,tip]=await Promise.all([get('/tx/'+txId+'/hex'),get('/block-height/'+height),get('/blocks/tip/height')]);
  if(!raw.ok||!canonical.ok||!tip.ok)throw new Error('Recovery confirmation could not be verified');
  const [rawText,blockHash,tipText]=await Promise.all([raw.text(),canonical.text(),tip.text()]);
  const tipHeight=Number(tipText.trim());
  if(!Number.isSafeInteger(tipHeight)||tipHeight<height)return false;
  // A stale status from an orphaned block or a substituted transaction cannot
  // clear the recovery guard. Retain bytes for later rechecking/rebroadcast.
  return rawText.trim().toLowerCase()===txHex.toLowerCase()&&blockHash.trim()===hash;
 }};
}
