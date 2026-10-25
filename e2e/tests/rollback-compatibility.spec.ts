import {test,expect,type Page} from '@playwright/test';
const fixture='/e2e/fixtures/rollback-migration.html',rollback='/recovery-rollback/';
const password='disposable-rollback-password-2026';
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
async function migrate(page:Page){
 await page.goto(fixture);await page.getByRole('button',{name:'Migrate public fixture'}).click();
 await expect(page.locator('#result')).toHaveText('MIGRATED');
 return page.evaluate(()=>((window as unknown as {rollbackFixture:{fingerprint:()=>Promise<string>}}).rollbackFixture.fingerprint()));
}
async function verifyPreserved(page:Page,before:string){
 await page.goto(fixture);
 expect(await page.evaluate(()=>((window as unknown as {rollbackFixture:{fingerprint:()=>Promise<string>}}).rollbackFixture.fingerprint()))).toBe(before);
 expect(await page.evaluate(()=>((window as unknown as {rollbackFixture:{verifyOriginal:()=>Promise<boolean>}}).rollbackFixture.verifyOriginal()))).toBe(true);
}
test('migrates the original phrase then reads it from the built rollback without altering any local or SDK state',async({page})=>{
 const before=await migrate(page);await page.goto(rollback);
 await expect(page.getByRole('heading',{name:'Your wallet data stays intact.'})).toBeVisible();
 await page.getByLabel('Wallet password',{exact:true}).fill('wrong-wallet-password');
 await page.getByRole('button',{name:'Unlock recovery words',exact:true}).click();
 await expect(page.locator('#message')).toContainText('Incorrect password');
 await expect(page.locator('#words')).toBeHidden();
 await page.getByLabel('Wallet password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Unlock recovery words',exact:true}).click();
 await expect(page.locator('#message')).toContainText('Original encrypted recovery words verified');
 await page.getByLabel(/I am in a private place/).check();
 await page.getByRole('button',{name:'Reveal original words',exact:true}).click();
 await expect(page.locator('#words')).toHaveText(words);
 await page.getByRole('button',{name:'Lock recovery view',exact:true}).click();
 await expect(page.locator('#words')).toBeHidden();await expect(page.locator('#words')).toHaveText('');
 await verifyPreserved(page,before);
});
test('clears plaintext on page suspension and never persists recovery words',async({page})=>{
 const before=await migrate(page);await page.goto(rollback);
 await page.getByLabel('Wallet password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Unlock recovery words',exact:true}).click();
 await expect(page.locator('#revealer')).toBeVisible();
 await page.getByLabel(/I am in a private place/).check();await page.getByRole('button',{name:'Reveal original words',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect(page.locator('#words')).toBeHidden();await expect(page.locator('#words')).toHaveText('');
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain(words);
 await verifyPreserved(page,before);
});
test('retains malformed journal and exit records rather than deleting or upgrading them',async({page})=>{
 await migrate(page);
 await page.evaluate(()=>{localStorage.setItem('gys:payment-journal:v9:damaged','{unreadable');localStorage.setItem('recovery-plan:unknown:mainnet','{unreadable');});
 const before=await page.evaluate(()=>((window as unknown as {rollbackFixture:{fingerprint:()=>Promise<string>}}).rollbackFixture.fingerprint()));
 await page.goto(rollback);await expect(page.locator('#compatibility')).toContainText('damaged or from another version');
 await verifyPreserved(page,before);
});
test('rejects an unsupported vault version without overwriting any record',async({page})=>{
 await migrate(page);
 const original=await page.evaluate(()=>localStorage.getItem('gys:wallet-vault:v1'));
 await page.evaluate(()=>{const r=JSON.parse(localStorage.getItem('gys:wallet-vault:v1')!);r.v=999;localStorage.setItem('gys:wallet-vault:v1',JSON.stringify(r));});
 const damaged=await page.evaluate(()=>localStorage.getItem('gys:wallet-vault:v1'));
 await page.goto(rollback);await expect(page.getByRole('button',{name:'Unlock recovery words',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>localStorage.getItem('gys:wallet-vault:v1'))).toBe(damaged);
 // Test fixture cleanup restores its disposable ciphertext, never user state.
 await page.evaluate(value=>localStorage.setItem('gys:wallet-vault:v1',value!),original);
});
test('containment CSP blocks network calls and the build has no wallet SDK',async({page})=>{
 await migrate(page);await page.goto(rollback);
 const assets=await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>(n as HTMLScriptElement).src));
 expect(assets.every(url=>url.includes('/recovery-rollback/assets/'))).toBe(true);
 const blocked=await page.evaluate(async()=>{try{await fetch('/should-never-contact');return false;}catch{return true;}});
 expect(blocked).toBe(true);
 await expect(page.locator('body')).not.toContainText('Send payment');
});
