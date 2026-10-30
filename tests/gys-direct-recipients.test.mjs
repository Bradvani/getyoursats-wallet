import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDirectRecipientDirectory,sparkAddressForIdentity} from '../site/server/gysDirectRecipients.mjs';
import {bech32m} from '@scure/base';

const key='0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const response={lightning_address:'alice@getyoursats.com',lnurl:'lnurlp://getyoursats.com/lnurlp/alice'};
const metadata={tag:'payRequest',callback:'https://getyoursats.com/lnurlp/alice/invoice',
  metadata:'[["text/identifier","alice@getyoursats.com"]]',allowsNostr:true,nostrPubkey:'a'.repeat(64)};
function harness({enabled=true}={}){
  let stored=null,current=metadata,failed=false;
  const commands=[];
  const env={GETYOURSATS_DIRECT_PAYMENTS_ENABLED:String(enabled),KV_REST_API_URL:'https://disposable.invalid',KV_REST_API_TOKEN:'write-test-token',KV_REST_API_READ_ONLY_TOKEN:'read-test-token'};
  const fetchImpl=async(_url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer write-test-token');
    const args=JSON.parse(options.body);commands.push(args);
    if(failed)throw new Error('Offline');
    if(args[0]==='EVAL'){stored=args[5];return Response.json({result:1});}
    assert.equal(args[0],'GET');
    return Response.json({result:stored});
  };
  const directory=createDirectRecipientDirectory({env,fetchImpl,lookup:async()=>current,now:()=>1000});
  return {directory,commands,setLookup(value){current=value;},fail(){failed=true;}};
}

test('simple Spark encoding binds the exact compressed identity with mainnet bech32m',()=>{
  const address=sparkAddressForIdentity(key);
  const decoded=bech32m.decode(address);
  assert.equal(decoded.prefix,'spark');
  assert.equal(Buffer.from(bech32m.fromWords(decoded.words)).toString('hex'),'0a21'+key);
  assert.throws(()=>sparkAddressForIdentity('02'+'ff'.repeat(32)));
});
test('only a matching native provider response can populate the directory',async()=>{
  const app=harness();
  for(const result of [{}, {...response,lightning_address:'alice@breez.tips'},
    {...response,username:'bob'},{...response,lnurl:'lnurlp://attacker.example/lnurlp/alice'}])await app.directory.capture(key,result);
  assert.equal(app.commands.length,0);
  await app.directory.capture(key,response);
  assert.equal(app.commands[0][0],'EVAL');
  const result=await app.directory.resolve('alice');
  assert.equal(result.available,true);
  assert.equal(result.identityPublicKey,key);
  assert.notEqual(result.identityPublicKey,metadata.nostrPubkey);
  assert.equal(result.expiresAt,61000);
  assert.match(result.bindingId,/^[a-f0-9]{64}$/);
});
test('revocation, ownership changes and malformed public metadata fail closed',async()=>{
  const app=harness();await app.directory.capture(key,response);
  app.setLookup({...metadata,nostrPubkey:'b'.repeat(64)});
  assert.deepEqual(await app.directory.resolve('alice'),{available:false});
  for(const patch of [{tag:'ERROR'},{allowsNostr:false},{callback:'https://attacker.example'},
    {metadata:'[["text/identifier","bob@getyoursats.com"]]'}]){
    app.setLookup({...metadata,...patch});
    await assert.rejects(()=>app.directory.resolve('alice'));
  }
});
test('disabled, missing and invalid names never invent a destination',async()=>{
  const disabled=harness({enabled:false});await disabled.directory.capture(key,response);
  assert.deepEqual(await disabled.directory.resolve('alice'),{available:false});
  assert.equal(disabled.commands.length,0);
  const app=harness();
  assert.deepEqual(await app.directory.resolve('alice'),{available:false});
  assert.deepEqual(await app.directory.resolve('../alice'),{available:false});
  app.fail();await assert.rejects(()=>app.directory.capture(key,response));
});
