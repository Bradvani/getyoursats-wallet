import {describe,it,expect} from 'vitest';
import {snapshotDigest,type Snapshot} from './database';
import {walletStorageNames} from './ownedStorage';
const snapshot=(value:unknown):Snapshot=>({schema:{version:23,stores:[{name:'settings',keyPath:'key',autoIncrement:false,indexes:[]}]},rows:[{name:'settings',entries:[{key:'public-fixture',value}]}]});
describe('migration typed snapshot identity',()=>{
 it('is independent of plain object property insertion order',async()=>{expect(await snapshotDigest(snapshot({a:1,b:2}))).toBe(await snapshotDigest(snapshot({b:2,a:1})));});
 it.each([{a:1,b:'1'},{a:1n,b:1},{a:undefined,b:null},{a:new Uint8Array([1,2]),b:[1,2]},{a:new Uint8Array([1,2]),b:new Int8Array([1,2])},{a:new Date(0),b:'1970-01-01T00:00:00.000Z'},{a:-0,b:0}])('does not erase structured-clone type distinctions %#',async({a,b})=>{expect(await snapshotDigest(snapshot(a))).not.toBe(await snapshotDigest(snapshot(b)));});
 it('does not collapse sparse array keys',async()=>{const sparse=new Array(2);sparse[1]=1;expect(await snapshotDigest(snapshot(sparse))).not.toBe(await snapshotDigest(snapshot([undefined,1])));});
 it.each([{value:NaN},{value:Infinity},{value:new Map()},{value:new Set()},{value:()=>0}])('refuses an unsupported storage value without attempting lossy serialization %#',async({value})=>{await expect(snapshotDigest(snapshot(value))).rejects.toThrow();});
 it('preserves binary offsets in the digest',async()=>{const array=new Uint8Array([9,1,2,9]);expect(await snapshotDigest(snapshot(array.subarray(1,3)))).toBe(await snapshotDigest(snapshot(new Uint8Array([1,2]))));});
 it('bounds cyclic and excessively deep objects',async()=>{const value:{self?:unknown}={};value.self=value;await expect(snapshotDigest(snapshot(value))).rejects.toThrow(/deeply nested/);});
});
describe('full identity storage namespaces',()=>{
 const identity='02698b27ac308b275671b3ca25436346469d04a5bba578ae39feba1d65897a6abc';
 it('retains the exact original lookup name while making the new directory full-digest scoped',async()=>{const result=await walletStorageNames('spark-wallet-example','regtest',identity);expect(result.pairs[0].source).toBe('spark-wallet-example/regtest/da91de82');expect(result.directory).toMatch(/^spark-wallet-example-v2-[0-9a-f]{64}$/);expect(result.pairs[1].source).toBe(result.pairs[0].source+'-tree');});
 it('separates networks and identities without deriving a new signing key',async()=>{const a=await walletStorageNames('public-root','regtest',identity),b=await walletStorageNames('public-root','mainnet',identity),c=await walletStorageNames('public-root','regtest','03'+'11'.repeat(32));expect(a.pairs[0].target).not.toBe(b.pairs[0].target);expect(a.pairs[0].target).not.toBe(c.pairs[0].target);});
 it.each(['../wallet','wallet/root','wallet\\root','wallet\0root',''])('refuses unsafe storage root %j',async root=>{await expect(walletStorageNames(root,'regtest',identity)).rejects.toThrow();});
});
