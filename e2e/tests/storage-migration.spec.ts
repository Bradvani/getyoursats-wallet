import {test,expect} from '@playwright/test';
const root=()=>`migration-${crypto.randomUUID()}`;
// All records are synthetic. The owner-bound fixture is not an attestation for
// previously untagged production databases. No wallet/service connection occurs.
test.beforeEach(async({page})=>{await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());await page.goto('/e2e/fixtures/storage-migration.html');await page.waitForFunction(()=>!!Reflect.get(window,'gysStorageMigrationLab'));});
test('known-owner handover preserves all stores and remains readable by unchanged SDK adapters',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);const before=await lab.inspect(root);const directory=await lab.prepare(root);const after=await lab.inspect(root);const adapter=await lab.adapterRead(root);return {before,after,adapter,directory,journal:localStorage.getItem('gys:payment-journal:public-fixture'),oldRejected:await lab.oldOpenRejected(root)};},root());
 expect(r.after[1].digest).toBe(r.before[0].digest);expect(r.after[3].digest).toBe(r.before[2].digest);
 expect(r.adapter).toMatchObject({amount:'1234',deposits:1,treeVersion:6});expect(r.journal).toBe('retained-uncertain');expect(r.oldRejected).toEqual([true,true]);expect(r.directory).toMatch(/-v2-[a-f0-9]{64}$/);
});
test('unknown ownership is refused without changing any original database or creating targets',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root,'unowned');const before=await lab.inspect(root);let code='';try{await lab.prepare(root);}catch(e){code=(e as {code:string}).code;}return {before,after:await lab.inspect(root),code};},root());expect(r.code).toBe('OWNERSHIP_REQUIRED');expect(r.after).toEqual(r.before);
});
test('a mismatching full identity never inherits an existing namespace',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root,'wrong-owner');const before=await lab.inspect(root);let rejected=false;try{await lab.prepare(root);}catch{rejected=true;}return {before,after:await lab.inspect(root),rejected};},root());expect(r.rejected).toBe(true);expect(r.after).toEqual(r.before);
});
test('noncooperating old connections block migration and cancelled upgrades cannot commit later',async({page})=>{
 const name=root();const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);const before=await lab.inspect(root);await lab.keepOldOpen(root);let code='';try{await lab.prepare(root);}catch(e){code=(e as {code:string}).code;}lab.closeOld();await new Promise(r=>setTimeout(r,50));return {before,after:await lab.inspect(root),code};},name);
 expect(r.code).toBe('CLOSE_OLD_TABS');expect(r.after).toEqual(r.before);
 await page.evaluate(root=>Reflect.get(window,'gysStorageMigrationLab').prepare(root),name);
});
test('interrupted copy keeps the source and resumes without duplicating records',async({page})=>{
 const name=root();const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);const before=await lab.inspect(root);const restore=await lab.abortNextCopy(root);let rejected=false;try{await lab.prepare(root);}catch{rejected=true;}finally{restore();}const interrupted=await lab.inspect(root);await lab.prepare(root);return {before,interrupted,after:await lab.inspect(root),rejected,adapter:await lab.adapterRead(root)};},name);
 expect(r.rejected).toBe(true);expect(r.interrupted[0].digest).toBe(r.before[0].digest);expect(r.after[1].digest).toBe(r.before[0].digest);expect(r.adapter.amount).toBe('1234');
});
test('missing already-activated target blocks rollback to an obsolete snapshot',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);await lab.prepare(root);await lab.mutateTarget(root);await lab.removeTargetFixture(root);let message='';try{await lab.prepare(root);}catch(e){message=String(e);}return {message,after:await lab.inspect(root)};},root());expect(r.message).toMatch(/Committed wallet storage is missing/);expect(r.after[1].exists).toBe(false);
});
test('fresh wallets get identity-bound targets and durable old-version tombstones',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root,'empty');const first=await lab.prepare(root);const second=await lab.prepare(root);return {first,second,after:await lab.inspect(root),oldRejected:await lab.oldOpenRejected(root)};},root());expect(r.first).toBe(r.second);expect(r.after[0].owner.state).toBe('retired');expect(r.after[1].owner.state).toBe('active');expect(r.oldRejected).toEqual([true,true]);
});
test('repeat handover never replaces operational records written after activation',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);await lab.prepare(root);await lab.mutateTarget(root);const before=await lab.inspect(root);await lab.prepare(root);return {before,after:await lab.inspect(root)};},root());expect(r.after).toEqual(r.before);
});

test('source retirement survives interruption immediately before activation',async({page})=>{
 const name=root();const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);const restore=await lab.interruptActivation(root);let rejected=false;try{await lab.prepare(root);}catch{rejected=true;}finally{restore();}const interrupted=await lab.inspect(root);lab.resume();await lab.prepare(root);return {rejected,interrupted,after:await lab.inspect(root),adapter:await lab.adapterRead(root)};},name);
 expect(r.rejected).toBe(true);expect(r.interrupted[0].owner.state).toBe('retired');expect(r.interrupted[1].owner.state).toBe('ready');expect(r.after[1].owner.state).toBe('active');expect(r.adapter.amount).toBe('1234');
});
test('quota exhaustion aborts a target copy without touching original rows',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);const before=await lab.inspect(root),restore=await lab.injectQuota(root);let rejected=false;try{await lab.prepare(root);}catch{rejected=true;}finally{restore();}const interrupted=await lab.inspect(root);await lab.prepare(root);return {before,interrupted,after:await lab.inspect(root),rejected};},root());expect(r.rejected).toBe(true);expect(r.interrupted[0].digest).toBe(r.before[0].digest);expect(r.after[1].digest).toBe(r.before[0].digest);
});
test('missing strict durability blocks acknowledgement and allows a safe explicit retry',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);const restore=await lab.noStrictDurability();let rejected=false;try{await lab.prepare(root);}catch{rejected=true;}finally{restore();}await lab.prepare(root);return {rejected,adapter:await lab.adapterRead(root)};},root());expect(r.rejected).toBe(true);expect(r.adapter.amount).toBe('1234');
});
test('a separate noncooperating tab must close before the handover can commit',async({page,context})=>{
 const name=root();const setup=await page.evaluate(root=>Reflect.get(window,'gysStorageMigrationLab').setup(root),name);
 const old=await context.newPage();await old.goto('/e2e/fixtures/storage-migration.html');await old.waitForFunction(()=>!!Reflect.get(window,'gysStorageMigrationLab'));
 await old.evaluate(root=>Reflect.get(window,'gysStorageMigrationLab').keepOldOpen(root),name);
 const code=await page.evaluate(async root=>{try{await Reflect.get(window,'gysStorageMigrationLab').prepare(root);return 'unexpected-success';}catch(e){return (e as {code:string}).code;}},name);expect(code).toBe('CLOSE_OLD_TABS');
 await old.close();await page.evaluate(root=>Reflect.get(window,'gysStorageMigrationLab').prepare(root),name);
 expect(await page.evaluate(root=>Reflect.get(window,'gysStorageMigrationLab').oldOpenRejected(root),name)).toEqual([true,true]);expect(setup.pairs).toHaveLength(2);
});
test('the pinned schema matches initialization by the actual unchanged adapters',async({page})=>{
 const r=await page.evaluate(root=>Reflect.get(window,'gysStorageMigrationLab').verifyAdapterSchema(root),root());expect(r.actual).toEqual(r.expected);
});
test('actual old adapter records without a full owner binding remain untouched',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.originalAdapterFixture(root);const before=await lab.inspect(root);let code='';try{await lab.prepare(root);}catch(e){code=(e as {code:string}).code;}return {before,after:await lab.inspect(root),code};},root());expect(r.code).toBe('OWNERSHIP_REQUIRED');expect(r.after).toEqual(r.before);
});

test('a missing paired original database is not silently replaced with an empty one',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root);await lab.removeSourceFixture(root,'tree');const before=await lab.inspect(root);let message='';try{await lab.prepare(root);}catch(e){message=String(e);}return {before,after:await lab.inspect(root),message};},root());expect(r.message).toMatch(/paired original wallet database is missing/);expect(r.after).toEqual(r.before);
});
test('revocation before handover creates no database and changes no local wallet records',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');await lab.setup(root,'empty');lab.revoke();let rejected=false;try{await lab.prepare(root);}catch{rejected=true;}lab.resume();return {rejected,after:await lab.inspect(root)};},root());expect(r.rejected).toBe(true);expect(r.after.every((x:{exists:boolean})=>!x.exists)).toBe(true);
});

test('support export selects the active target and never a retired stale source',async({page})=>{
 const r=await page.evaluate(async root=>{const lab=Reflect.get(window,'gysStorageMigrationLab');const {pairs}=await lab.setup(root);const legacy=await lab.exportName(root);await lab.prepare(root);const migrated=await lab.exportName(root);await lab.removeTargetFixture(root);let rejected=false;try{await lab.exportName(root);}catch{rejected=true;}return {legacy,migrated,pairs,rejected};},root());expect(r.legacy).toBe(r.pairs[0].source);expect(r.migrated).toBe(r.pairs[0].target);expect(r.rejected).toBe(true);
});
