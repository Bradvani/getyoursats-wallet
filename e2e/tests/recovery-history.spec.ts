import {test,expect,type Page} from '@playwright/test';

async function lab(page:Page){
 await page.goto('/e2e/fixtures/recovery-history.html');
 await page.waitForFunction(()=>Reflect.has(window,'__gysRecoveryHistoryLab'));
}
test.beforeEach(async({context,page})=>{
 await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await lab(page);
});
test('the installed IndexedDB adapter preserves and verifies all 215 SDK-visible history rows after reload',async({page})=>{
 const setup=await page.evaluate(()=>Reflect.get(window,'__gysRecoveryHistoryLab').prepare(215));
 const first=await page.evaluate(name=>Reflect.get(window,'__gysRecoveryHistoryLab').read(name),setup.name);
 expect(first).toMatchObject({count:215,displayCount:100,more:true,calls:6,state:'unknown',unresolved:{payments:1,incoming:0,deposits:0,recoveries:0}});
 expect(first.journals).toEqual(setup.before);
 await page.reload();await page.waitForFunction(()=>Reflect.has(window,'__gysRecoveryHistoryLab'));
 const restored=await page.evaluate(name=>Reflect.get(window,'__gysRecoveryHistoryLab').read(name),setup.name);
 expect(restored).toEqual(first);
});
test('a change beyond the first 100 rows invalidates the scan without resolving the pending payment',async({page})=>{
 const setup=await page.evaluate(()=>Reflect.get(window,'__gysRecoveryHistoryLab').prepare(215));
 const error=await page.evaluate(async name=>{try{await Reflect.get(window,'__gysRecoveryHistoryLab').read(name,'between-scans');return '';}catch(e){return String(e);}},setup.name);
 expect(error).toContain('Wallet history changed');
 const current=await page.evaluate(name=>Reflect.get(window,'__gysRecoveryHistoryLab').read(name),setup.name);
 expect(current.count).toBe(215);expect(current.state).toBe('unknown');expect(current.journals).toEqual(setup.before);
});
test('a failed later page is not reported as successful recovery of the first page',async({page})=>{
 const setup=await page.evaluate(()=>Reflect.get(window,'__gysRecoveryHistoryLab').prepare(215));
 const error=await page.evaluate(async name=>{try{await Reflect.get(window,'__gysRecoveryHistoryLab').read(name,'late-page');return '';}catch(e){return String(e);}},setup.name);
 expect(error).toContain('Injected second-page read failure');
 const retried=await page.evaluate(name=>Reflect.get(window,'__gysRecoveryHistoryLab').read(name),setup.name);
 expect(retried.count).toBe(215);expect(retried.journals).toEqual(setup.before);
});
