import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {fixtureAuthenticator,type AuthFault} from '../test/linkedPasskeyAuthenticator';
import {installVaultTestLock} from './vaultTestLock';
import {rememberSignerIdentity,clearSignerIdentity,lockSpendingSession,isSpendingSessionLocked} from './spendApproval';
import {WEB_VAULT_KEY,WEB_PASSKEY_LINK_KEY,enrollWebWallet,unlockWebWallet,beginWebPasskeyEnrollment,clearUnlockedWebMnemonic,
 getUnlockedWebMnemonic,unlockWebWalletWithPasskey,approveWebWalletWithPasskey,exportWebPasskeyBackup,restoreWebPasskeyBackup,restoreWebPasswordBackup,removeWebPasskeyProtection,resetWebWalletPasswordWithWords,removeMatchingLegacyMnemonic} from './webWalletVault';
const words='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const other='legal winner thank year wave sausage worth useful legal winner thank yellow';
const password='a-disposable-original-password';
const originalSetItem=vi.mocked(localStorage.setItem).getMockImplementation()!;
let authenticator:Awaited<ReturnType<typeof fixtureAuthenticator>>;
const storage=()=>Object.fromEntries(Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)!).map(k=>[k,localStorage.getItem(k)]));
async function link(){const pending=await beginWebPasskeyEnrollment(password);await pending.verify();}
beforeEach(async()=>{
 vi.mocked(localStorage.setItem).mockImplementation(originalSetItem);localStorage.clear();clearSignerIdentity();clearUnlockedWebMnemonic();installVaultTestLock();
 vi.stubGlobal('indexedDB',{databases:vi.fn(async()=>[])});
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 authenticator=await fixtureAuthenticator();authenticator.install();
 await enrollWebWallet(words,password);await rememberSignerIdentity({type:'mnemonic',mnemonic:words});
});
afterEach(()=>{vi.mocked(localStorage.setItem).mockImplementation(originalSetItem);clearSignerIdentity();clearUnlockedWebMnemonic();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
describe('same-wallet passkey protection',{timeout:20_000},()=>{
 it('verifies twice before committing and leaves original ciphertext/password/journals untouched',async()=>{
  localStorage.setItem('gys:operation-journal:v1:fixture','public-uncertain-operation');
  localStorage.setItem('wallet-history-fixture','public-history');
  const before=storage(),pending=await beginWebPasskeyEnrollment(password);
  expect(authenticator.state.createCalls).toBe(1);expect(authenticator.state.getCalls).toBe(0);expect(storage()).toEqual(before);
  await pending.verify();const after=storage();delete after[WEB_PASSKEY_LINK_KEY];expect(after).toEqual(before);
  expect(JSON.stringify(storage())).not.toContain(words);expect(await unlockWebWallet(password)).toBe(words);
  clearUnlockedWebMnemonic();expect(await unlockWebWalletWithPasskey()).toBe(words);
  expect(localStorage.getItem('passkeyRegistered')).toBeNull();expect(localStorage.getItem('passkeyLabel')).toBeNull();
 });
 it('cancelled enrollment cannot be resumed and changes no original bytes',async()=>{
  const before=storage(),pending=await beginWebPasskeyEnrollment(password);pending.cancel();
  await expect(pending.verify()).rejects.toThrow(/expired/);expect(storage()).toEqual(before);
 });
 it('rejects a wrong password before showing any passkey prompt',async()=>{
  const before=storage();await expect(beginWebPasskeyEnrollment('wrong-password')).rejects.toThrow();
  expect(authenticator.state.createCalls).toBe(0);expect(storage()).toEqual(before);
 });
 it('never activates a provider without PRF encryption support',async()=>{
  authenticator.state.fault='unsupported-prf';const before=storage();await expect(beginWebPasskeyEnrollment(password)).rejects.toThrow(/cannot encrypt/);expect(storage()).toEqual(before);
 });
 it.each<AuthFault>(['wrong-id','wrong-user','wrong-origin','wrong-challenge','cross-origin','no-uv','bad-signature','wrong-prf','missing-prf'])('denies %s on unlock without changing original data',async fault=>{
  await link();clearUnlockedWebMnemonic();lockSpendingSession();const before=storage();authenticator.state.fault=fault;
  await expect(unlockWebWalletWithPasskey()).rejects.toThrow();expect(storage()).toEqual(before);expect(getUnlockedWebMnemonic()).toBeNull();expect(isSpendingSessionLocked()).toBe(true);
 });
 it('stays locked after a cancelled authentication',async()=>{
  await link();clearUnlockedWebMnemonic();lockSpendingSession();const before=storage();
  authenticator.state.beforeGet=async()=>{throw new DOMException('Cancelled','NotAllowedError');};
  await expect(unlockWebWalletWithPasskey()).rejects.toThrow();expect(storage()).toEqual(before);expect(getUnlockedWebMnemonic()).toBeNull();
 });
 it('does not accept a stale authentication after the session changes',async()=>{
  await link();clearUnlockedWebMnemonic();authenticator.state.beforeGet=async()=>{lockSpendingSession('background');};
  await expect(unlockWebWalletWithPasskey()).rejects.toThrow();expect(getUnlockedWebMnemonic()).toBeNull();
 });
 it('does not commit enrollment if its vault changed while the prompt was open',async()=>{
  const original=localStorage.getItem(WEB_VAULT_KEY)!;const pending=await beginWebPasskeyEnrollment(password);
  authenticator.state.beforeGet=async()=>localStorage.setItem(WEB_VAULT_KEY,original+' ');
  await expect(pending.verify()).rejects.toThrow(/changed/);expect(localStorage.getItem(WEB_PASSKEY_LINK_KEY)).toBeNull();expect(await unlockWebWallet(password)).toBe(words);
 });
 it('preserves password access when saving the link exhausts quota',async()=>{
  const before=storage(),pending=await beginWebPasskeyEnrollment(password),real=originalSetItem;
  vi.mocked(localStorage.setItem).mockImplementation((key,value)=>{if(key===WEB_PASSKEY_LINK_KEY)throw new DOMException('quota','QuotaExceededError');real(key,value);});
  await expect(pending.verify()).rejects.toThrow(/quota/);expect(storage()).toEqual(before);expect(await unlockWebWallet(password)).toBe(words);
 });
 it('does not overwrite another enrollment that completed first',async()=>{
  const first=await beginWebPasskeyEnrollment(password);const alternate=await fixtureAuthenticator();alternate.install();const second=await beginWebPasskeyEnrollment(password);
  authenticator.install();await first.verify();alternate.install();const before=storage();await expect(second.verify()).rejects.toThrow(/changed/);expect(storage()).toEqual(before);
 });
 it('requires an unlocked current identity for payment authorization',async()=>{
  await link();await expect(approveWebWalletWithPasskey()).resolves.toBeUndefined();
  lockSpendingSession();clearUnlockedWebMnemonic();await expect(approveWebWalletWithPasskey()).rejects.toThrow(/no longer current/);expect(isSpendingSessionLocked()).toBe(true);expect(getUnlockedWebMnemonic()).toBeNull();
 });
 it('password recovery preserves identity and invalidates the old local passkey link',async()=>{
  await link();await resetWebWalletPasswordWithWords(words,'new-disposable-wallet-password');
  await expect(unlockWebWalletWithPasskey()).rejects.toThrow(/out of date/);expect(await unlockWebWallet('new-disposable-wallet-password')).toBe(words);
  await removeWebPasskeyProtection('new-disposable-wallet-password');expect(localStorage.getItem(WEB_PASSKEY_LINK_KEY)).toBeNull();expect(isSpendingSessionLocked()).toBe(true);
 });
 it('wrong recovery words cannot replace the wallet or link',async()=>{
  await link();const before=storage();await expect(resetWebWalletPasswordWithWords(other,'replacement-long-password')).rejects.toThrow(/do not match/);expect(storage()).toEqual(before);
 });
 it('damaged link does not delete the original vault or block password fallback',async()=>{
  await link();const original=localStorage.getItem(WEB_VAULT_KEY);localStorage.setItem(WEB_PASSKEY_LINK_KEY,'{damaged');
  await expect(unlockWebWalletWithPasskey()).rejects.toThrow();expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(original);expect(await unlockWebWallet(password)).toBe(words);
 });
 it('exports ciphertext only and restores the same encrypted vault in a clean profile',async()=>{
  await link();const backup=await exportWebPasskeyBackup(),original=localStorage.getItem(WEB_VAULT_KEY);
  expect(backup).not.toContain(words);expect(backup).not.toContain(password);
  clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();
  expect(await restoreWebPasskeyBackup(backup)).toBe(words);expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(original);
  clearUnlockedWebMnemonic();expect(await unlockWebWalletWithPasskey()).toBe(words);expect(await unlockWebWallet(password)).toBe(words);
 });
 it('restores the original encrypted file with its password when the passkey is unavailable',async()=>{
  await link();const backup=await exportWebPasskeyBackup();clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();
  const calls=authenticator.state.getCalls;
  await expect(restoreWebPasswordBackup(backup,'wrong')).rejects.toThrow();expect(localStorage.length).toBe(0);
  expect(await restoreWebPasswordBackup(backup,password)).toBe(words);expect(authenticator.state.getCalls).toBe(calls);
  expect(await unlockWebWallet(password)).toBe(words);
 });
 it('refuses to replace orphaned existing SDK database records in an otherwise empty profile',async()=>{
  await link();const backup=await exportWebPasskeyBackup();clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();
  vi.mocked(indexedDB.databases).mockResolvedValue([{name:'existing-wallet-records',version:1}]);
  await expect(restoreWebPasskeyBackup(backup)).rejects.toThrow(/database records/);expect(localStorage.length).toBe(0);
 });
 it('does not attach protection to a different mnemonic passphrase identity',async()=>{
  await rememberSignerIdentity({type:'mnemonic',mnemonic:words,passphrase:'not-the-original-wallet'});const before=storage();
  await expect(beginWebPasskeyEnrollment(password)).rejects.toThrow(/connected wallet/);expect(storage()).toEqual(before);expect(authenticator.state.createCalls).toBe(0);
 });
 it('refuses recovery over an existing wallet before requesting authentication',async()=>{
  await link();const backup=await exportWebPasskeyBackup(),before=storage(),calls=authenticator.state.getCalls;
  await expect(restoreWebPasskeyBackup(backup)).rejects.toThrow(/already contains/);expect(storage()).toEqual(before);expect(authenticator.state.getCalls).toBe(calls);
 });
 it('refuses a cross-origin recovery file without credential access',async()=>{
  await link();const file=JSON.parse(await exportWebPasskeyBackup());file.origin='https://different.example';
  clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();const calls=authenticator.state.getCalls;
  await expect(restoreWebPasskeyBackup(JSON.stringify(file))).rejects.toThrow(/different website/);expect(localStorage.length).toBe(0);expect(authenticator.state.getCalls).toBe(calls);
 });
 it('refuses a newly occupied profile after the restore prompt opens',async()=>{
  await link();const backup=await exportWebPasskeyBackup();clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();
  authenticator.state.beforeGet=async()=>localStorage.setItem('walletMnemonic',other);
  await expect(restoreWebPasskeyBackup(backup)).rejects.toThrow(/already contains/);expect(localStorage.getItem('walletMnemonic')).toBe(other);expect(localStorage.getItem(WEB_VAULT_KEY)).toBeNull();
 });
 it('leaves a recoverable password vault if quota interrupts the final restore-link write',async()=>{
  await link();const backup=await exportWebPasskeyBackup(),original=localStorage.getItem(WEB_VAULT_KEY);
  clearSignerIdentity();clearUnlockedWebMnemonic();localStorage.clear();const real=originalSetItem;
  vi.mocked(localStorage.setItem).mockImplementation((key,value)=>{if(key===WEB_PASSKEY_LINK_KEY)throw new DOMException('quota','QuotaExceededError');real(key,value);});
  await expect(restoreWebPasskeyBackup(backup)).rejects.toThrow(/quota/);expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(original);expect(getUnlockedWebMnemonic()).toBeNull();expect(await unlockWebWallet(password)).toBe(words);
 });
 it('requires the wallet password to remove local access and preserves all other records',async()=>{
  await link();const before=storage();await expect(removeWebPasskeyProtection('wrong')).rejects.toThrow();expect(storage()).toEqual(before);
  await removeWebPasskeyProtection(password);delete before[WEB_PASSKEY_LINK_KEY];expect(storage()).toEqual(before);expect(isSpendingSessionLocked()).toBe(true);expect(getUnlockedWebMnemonic()).toBeNull();
 });
 it('migrates only a matching legacy plaintext after verifying the original encrypted vault',async()=>{
  localStorage.setItem('walletMnemonic',words);await link();const before=storage();await removeMatchingLegacyMnemonic(password);
  delete before.walletMnemonic;expect(storage()).toEqual(before);
 });
});
