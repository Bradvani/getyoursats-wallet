import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import qs from 'qs';

for(const encodeValuesOnly of [false,true]){
 test(`comma serialization tolerates untrusted object coercion (encodeValuesOnly=${encodeValuesOnly})`,()=>{
  for(const value of [{toString:'x'},Object.assign(Object.create(null),{b:'c'}),[{toString:'x'}]]){
   assert.doesNotThrow(()=>qs.stringify({a:[value]},{arrayFormat:'comma',encodeValuesOnly}));
  }
  assert.equal(qs.stringify({a:['first','second']},{arrayFormat:'comma',encodeValuesOnly}),
   encodeValuesOnly?'a=first,second':'a=first%2Csecond');
 });
}
test('browser URL polyfill retains repeated query values',()=>{
 const require=createRequire(import.meta.url);
 const browserUrl=require('url/');
 assert.equal(browserUrl.format({pathname:'/pay',query:{value:['first','second']}}),'/pay?value=first&value=second');
});
