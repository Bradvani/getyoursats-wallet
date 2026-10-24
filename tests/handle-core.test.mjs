import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validUsername,normalizeSourceAddress,checkSourceLNURL,DOMAIN} from '../server/handleCore.mjs';

test('only normal, unambiguous and unreserved usernames can be claimed',()=>{
  for(const name of ['bharat','sats123','mywallet'])assert.equal(validUsername(name),true);
  for(const name of ['ABCD','ad','1name','my-name','support','getyoursats','admin','a'.repeat(25),'../etc'])assert.equal(validUsername(name),false);
  assert.equal(DOMAIN,'getyoursats.com');
});
test('only explicitly supported Breez source addresses are linkable',()=>{
  assert.equal(normalizeSourceAddress('User123@BREEZ.TIPS'),'user123@breez.tips');
  for(const address of ['someone@example.com','abc@getyoursats.com','a@breez.tips','a..b@breez.tips','x@breez.tips.evil.net']){
    assert.throws(()=>normalizeSourceAddress(address));
  }
});
test('LNURL forwarding retains trusted callback and original metadata unchanged',async()=>{
  const original=globalThis.fetch;
  const metadata='[[\"text/plain\",\"Pay to original Lightning wallet\"]]';
  globalThis.fetch=async url=>{
    assert.equal(url,'https://breez.tips/.well-known/lnurlp/example');
    return new Response(JSON.stringify({tag:'payRequest',callback:'https://breez.tips/lnurlp/example?nonce=a',
      minSendable:1000,maxSendable:10000000,metadata,commentAllowed:0}),{status:200});
  };
  try{
    const value=await checkSourceLNURL('example@breez.tips');
    assert.equal(value.metadata,metadata);
    assert.equal(value.callback,'https://breez.tips/lnurlp/example?nonce=a');
  }finally{globalThis.fetch=original}
});
test('rejects spoofed or untrusted callbacks',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({tag:'payRequest',callback:'https://evil.example/steal',
    minSendable:1000,maxSendable:10000000,metadata:'[]'}),{status:200});
  try{await assert.rejects(checkSourceLNURL('example@breez.tips'),/Untrusted/)}
  finally{globalThis.fetch=original}
});
