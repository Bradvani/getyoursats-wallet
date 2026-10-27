import {test,expect,type Page} from '@playwright/test';

test.use({trace:'off',video:'off',screenshot:'off'});
const fixture='/e2e/fixtures/browser-vault-security.html';
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const other='legal winner thank year wave sausage worth useful legal winner thank yellow';
const password='disposable-browser-test-password';
const modulePath='/src/security/webWalletVault.ts';
async function load(page:Page){
 await page.goto(fixture);
 await page.evaluate(async path=>{await import(path)},modulePath);
}

test('real Web Locks holds a second tab until the first writer releases',async({context,page})=>{
 await load(page);
 await page.evaluate(async({path,words,password})=>{const vault=await import(path);await vault.enrollWebWallet(words,password)}, {path:modulePath,words,password});
 const original=await page.evaluate(()=>localStorage.getItem('gys:wallet-vault:v1'));
 const second=await context.newPage();await load(second);
 await page.evaluate(()=>{
  const state=window as unknown as {releaseVaultLock?:()=>void};
  void navigator.locks.request('getyoursats-vault-mutation-v1',{mode:'exclusive'},()=>new Promise<void>(resolve=>{state.releaseVaultLock=resolve}));
 });
 await expect.poll(()=>page.evaluate(()=>navigator.locks.query().then(r=>r.held?.some(l=>l.name==='getyoursats-vault-mutation-v1')))).toBe(true);
 const pending=second.evaluate(async({path,other,password})=>{
  try{const vault=await import(path);await vault.enrollWebWallet(other,password);return 'unexpected replacement';}
  catch(error){return error instanceof Error?error.message:String(error)}
 },{path:modulePath,other,password});
 await expect.poll(()=>page.evaluate(()=>navigator.locks.query().then(r=>r.pending?.length??0))).toBe(1);
 expect(await page.evaluate(()=>localStorage.getItem('gys:wallet-vault:v1'))).toBe(original);
 await page.evaluate(()=>{(window as unknown as {releaseVaultLock:()=>void}).releaseVaultLock()});
 expect(await pending).toMatch(/different protected wallet/);
 expect(await second.evaluate(()=>localStorage.getItem('gys:wallet-vault:v1'))).toBe(original);
});

test('simultaneous first-time enrollment in two tabs commits only one wallet',async({context,page})=>{
 await load(page);
 const second=await context.newPage();await load(second);
 const enroll=(tab:Page,phrase:string)=>tab.evaluate(async({path,phrase,password})=>{
  try{const vault=await import(path);await vault.enrollWebWallet(phrase,password);return true;}
  catch{return false;}
 },{path:modulePath,phrase,password});
 const results=await Promise.all([enroll(page,words),enroll(second,other)]);
 expect(results.filter(Boolean)).toHaveLength(1);
 const winner=results[0]?words:other;
 const verification=await context.newPage();await load(verification);
 expect(await verification.evaluate(async({path,winner,password})=>{
  const vault=await import(path);return await vault.unlockWebWallet(password)===winner;
 },{path:modulePath,winner,password})).toBe(true);
 expect(await verification.evaluate(()=>localStorage.getItem('walletMnemonic'))).toBeNull();
});
