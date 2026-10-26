import {createHmac,createPublicKey,ECDH,verify as verifySignature,timingSafeEqual} from 'node:crypto';

export function walletPubkey(value) {
  if (typeof value !== 'string'||!/^(02|03)[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid wallet identity');
  return value.toLowerCase();
}
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('Invalid email');
  const email=value.trim().toLowerCase();
  if(email.length>254||!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,250}[a-z0-9])?\.[a-z]{2,63}$/.test(email)
    ||email.includes('..')||email.includes('\r')||email.includes('\n'))throw new Error('Invalid email');
  const [local,domain]=email.split('@');
  if(local.startsWith('.')||local.endsWith('.')||domain.split('.').some(label=>
    label.length>63||!(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))))throw new Error('Invalid email');
  return email;
}
export function digest(secret,value) {
  return createHmac('sha256',secret).update(value,'utf8').digest('hex');
}
export function equalHex(left,right) {
  if(typeof left!=='string'||typeof right!=='string'||!/^([0-9a-f]{64})$/i.test(left)||!/^([0-9a-f]{64})$/i.test(right))return false;
  return timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
}
/** Breez Spark signMessage(compact:true) signs SHA256(message) with the
 * identity secp256k1 key. Verify the pinned compressed identity public key,
 * never a pubkey supplied separately by an unauthenticated browser claim. */
export function verifyWalletProof(message,pubkey,signature) {
  try {
    const compressed=walletPubkey(pubkey);
    if(typeof message!=='string'||message.length>320||!/^gys-email-v1:/.test(message))return false;
    if(typeof signature!=='string'||!/^[0-9a-f]{128}$/i.test(signature))return false;
    const uncompressed=ECDH.convertKey(compressed,'secp256k1','hex','hex','uncompressed');
    const spki=Buffer.concat([
      Buffer.from('3056301006072a8648ce3d020106052b8104000a03420004','hex'),
      Buffer.from(uncompressed.slice(2),'hex')
    ]);
    const key=createPublicKey({key:spki,format:'der',type:'spki'});
    return verifySignature('sha256',Buffer.from(message,'utf8'),{key,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'hex'));
  } catch {return false;}
}
