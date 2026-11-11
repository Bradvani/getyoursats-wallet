import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const descriptor=JSON.parse(readFileSync(new URL('../src/security/storageMigration/pinnedSchemas.json',import.meta.url)));
for(const [role,path] of [['sdk','storage/index.js'],['tree','tree-store/index.js']])test(`migration ${role} schema is bound to the installed adapter bytes`,()=>{
 const bytes=readFileSync(new URL('../node_modules/@breeztech/breez-sdk-spark/web/'+path,import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),descriptor.adapterSha256[role]);
 assert.equal(descriptor[role].version,role==='sdk'?23:6);
 assert(descriptor[role].stores.every(s=>s.autoIncrement===false),'Key generator state requires separate migration support; do not silently reset it');
 assert(!descriptor[role].stores.some(s=>s.name==='__gys_storage_owner_v1'));
});
