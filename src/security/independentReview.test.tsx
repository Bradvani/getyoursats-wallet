import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,renderHook,screen,waitFor} from '@testing-library/react';
import {defaultExternalSigners} from '@breeztech/breez-sdk-spark';
import SpendingApprovalDialog from './SpendingApprovalDialog';
import {useBrowserSessionLock} from './useBrowserSessionLock';
import {WEB_VAULT_KEY,checkWebWalletPassword,clearUnlockedWebMnemonic,enrollWebWallet,getUnlockedWebMnemonic,resetWebWalletPasswordWithWords,unlockWebWallet} from './webWalletVault';
import {cancelSpendingApproval,clearSignerIdentity,createPaymentApprovalObserver,finishSpendingApproval,getSpendingRequest,matchesSignerIdentity,rememberSignerIdentity,requestSpendingApproval} from './spendApproval';

const A='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const B='legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD='disposable-test-password-123';
const payments=()=>[{paymentId:'disposable-id',amount:125n,details:{type:'token' as const,tokenId:'asset-A',payRequest:'spark-disposable-destination'}}];
let visibility='visible';
beforeEach(()=>{
  localStorage.clear();clearUnlockedWebMnemonic();clearSignerIdentity();visibility='visible';
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
});
afterEach(()=>{cancelSpendingApproval();clearSignerIdentity();clearUnlockedWebMnemonic();cleanup();vi.useRealTimers();});

describe('Independent PR35 characterization and negative controls',()=>{
  it('control: actual installed WASM derives the same identity before migration, after unlock and after password reset',async()=>{
    const identity=async(phrase:string)=>{
      const signers=defaultExternalSigners(phrase,undefined,'mainnet',0);
      return (await signers.sparkSigner.getIdentityPublicKey()).bytes;
    };
    const before=await identity(A);
    expect(before).toHaveLength(33);
    await enrollWebWallet(A,PASSWORD);clearUnlockedWebMnemonic();
    expect(await identity(await unlockWebWallet(PASSWORD))).toEqual(before);
    await resetWebWalletPasswordWithWords(A,'new-disposable-password-456');
    expect(await identity(await unlockWebWallet('new-disposable-password-456'))).toEqual(before);
    expect(await identity(B)).not.toEqual(before);
  });
  it('control: actual installed WASM changes identity with a BIP39 passphrase but shares the identity across these networks',async()=>{
    const key=async(passphrase:string|undefined,network:'mainnet'|'regtest')=>
      (await defaultExternalSigners(A,passphrase,network,0).sparkSigner.getIdentityPublicKey()).bytes;
    expect(await key('extra-secret','mainnet')).not.toEqual(await key(undefined,'mainnet'));
    expect(await key(undefined,'regtest')).toEqual(await key(undefined,'mainnet'));
  });
  it('control: an identified observer waits and cancellation prevents a simulated irreversible call',async()=>{
    await rememberSignerIdentity({type:'mnemonic',mnemonic:A});
    const irreversible=vi.fn();
    const p=createPaymentApprovalObserver().beforeSend(payments()).then(irreversible);
    const rejected=expect(p).rejects.toThrow(/cancelled/);
    expect(getSpendingRequest()).not.toBeNull();
    cancelSpendingApproval();await rejected;expect(irreversible).not.toHaveBeenCalled();
  });
  it('control: timeout rejects pending approval and a late completion cannot execute it',async()=>{
    vi.useFakeTimers();const irreversible=vi.fn();
    const p=requestSpendingApproval(payments()).then(irreversible);
    const rejected=expect(p).rejects.toThrow(/timed out/);const id=getSpendingRequest()!.id;
    await vi.advanceTimersByTimeAsync(90000);await rejected;
    finishSpendingApproval(id,true);expect(irreversible).not.toHaveBeenCalled();
  });
  it('control: ciphertext tampering rejects the password without removing the stored record',async()=>{
    await enrollWebWallet(A,PASSWORD);const record=JSON.parse(localStorage.getItem(WEB_VAULT_KEY)!);
    const bytes=atob(record.ciphertext);record.ciphertext=btoa(String.fromCharCode(bytes.charCodeAt(0)^1)+bytes.slice(1));
    const corrupted=JSON.stringify(record);localStorage.setItem(WEB_VAULT_KEY,corrupted);
    await expect(unlockWebWallet(PASSWORD)).rejects.toThrow();
    expect(localStorage.getItem(WEB_VAULT_KEY)).toBe(corrupted);
  });
  it('finding: approval details are mutable and contain no fee or quote binding',async()=>{
    const source=payments();const p=requestSpendingApproval(source);
    source[0].amount=900n;source[0].details.payRequest='changed-destination';
    expect(getSpendingRequest()!.payments[0].amount).toBe(900n);
    expect(getSpendingRequest()!.payments[0]).not.toHaveProperty('fee');
    finishSpendingApproval(getSpendingRequest()!.id,true);await p;
  });
  it('finding: elapsed deadline is not checked when a delayed timer has not run',async()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);const p=requestSpendingApproval(payments());
    vi.setSystemTime(100000);finishSpendingApproval(getSpendingRequest()!.id,true);
    await expect(p).resolves.toBeUndefined();
  });
  it('finding: the same payment identifier can be submitted again after approval',async()=>{
    const first=requestSpendingApproval(payments());finishSpendingApproval(getSpendingRequest()!.id,true);await first;
    const second=requestSpendingApproval(payments());expect(getSpendingRequest()).not.toBeNull();
    finishSpendingApproval(getSpendingRequest()!.id,true);await second;
  });
  it('finding: background lock retains the plaintext mnemonic and permits new observer requests on return',async()=>{
    await enrollWebWallet(A,PASSWORD);await rememberSignerIdentity({type:'mnemonic',mnemonic:A});
    const {result}=renderHook(()=>useBrowserSessionLock(true));
    act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
    expect(result.current.locked).toBe(true);expect(getUnlockedWebMnemonic()).toBe(A);
    act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'))});
    const p=createPaymentApprovalObserver().beforeSend(payments());
    expect(getSpendingRequest()).not.toBeNull();expect(result.current.locked).toBe(true);
    finishSpendingApproval(getSpendingRequest()!.id,true);await p;
  });
  it('finding: returning null preserves a password across externally cancelled approval requests',async()=>{
    await enrollWebWallet(A,PASSWORD);render(<SpendingApprovalDialog/>);
    let first!:Promise<void>;act(()=>{first=requestSpendingApproval(payments())});
    const rejected=expect(first).rejects.toThrow();
    fireEvent.change(screen.getByLabelText('Wallet password'),{target:{value:PASSWORD}});
    act(()=>cancelSpendingApproval('background'));await rejected;
    let second!:Promise<void>;act(()=>{second=requestSpendingApproval(payments())});
    expect(screen.getByLabelText('Wallet password')).toHaveValue(PASSWORD);
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Authorize'}));await second;});
  });
  it('finding: token approval hides token identity and all fee and network context',async()=>{
    render(<SpendingApprovalDialog/>);let p!:Promise<void>;
    act(()=>{p=requestSpendingApproval(payments())});
    expect(screen.getByRole('dialog')).toHaveTextContent('125 token base units');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('asset-A');
    act(()=>finishSpendingApproval(getSpendingRequest()!.id,true));await p;
  });
  it('finding: password check can validate a different vault than the connected signer',async()=>{
    await rememberSignerIdentity({type:'mnemonic',mnemonic:A});
    await enrollWebWallet(B,PASSWORD);
    expect(await matchesSignerIdentity({type:'mnemonic',mnemonic:B})).toBe(false);
    expect(await checkWebWalletPassword(PASSWORD)).toBe(true);
  });
  it('finding: a failed identity-checking unlock leaves the mismatching mnemonic active',async()=>{
    await rememberSignerIdentity({type:'mnemonic',mnemonic:A});await enrollWebWallet(B,PASSWORD);clearUnlockedWebMnemonic();
    const {result}=renderHook(()=>useBrowserSessionLock(true));
    act(()=>{visibility='hidden';document.dispatchEvent(new Event('visibilitychange'))});
    await expect(result.current.unlock(PASSWORD)).rejects.toThrow(/does not match/);
    expect(result.current.locked).toBe(true);expect(getUnlockedWebMnemonic()).toBe(B);
    expect(await checkWebWalletPassword(PASSWORD)).toBe(true);
  });
  it('finding: concurrent enrollments can both write despite the no-overwrite promise',async()=>{
    const writes=vi.mocked(localStorage.setItem);writes.mockClear();
    await Promise.allSettled([enrollWebWallet(A,PASSWORD),enrollWebWallet(B,PASSWORD)]);
    expect(writes.mock.calls.filter(([key])=>key===WEB_VAULT_KEY)).toHaveLength(2);
    expect([A,B]).toContain(await unlockWebWallet(PASSWORD));
  });
  it('finding: original words cannot use the reset path when vault JSON is damaged',async()=>{
    localStorage.setItem(WEB_VAULT_KEY,'damaged-json');
    await expect(resetWebWalletPasswordWithWords(A,PASSWORD)).rejects.toThrow();
    expect(localStorage.getItem(WEB_VAULT_KEY)).toBe('damaged-json');
  });
  it('control: correctly shaped entropy seeds have distinct signer fingerprints',async()=>{
    const a=Object.assign(Array(32).fill(1),{type:'entropy' as const});
    const b=Object.assign(Array(32).fill(2),{type:'entropy' as const});
    await rememberSignerIdentity(a);
    expect(await matchesSignerIdentity(b)).toBe(false);
  });
  it('control: wrong password leaves the observer unapproved',async()=>{
    await enrollWebWallet(A,PASSWORD);render(<SpendingApprovalDialog/>);
    let p!:Promise<void>;act(()=>{p=requestSpendingApproval(payments())});const rejected=expect(p).rejects.toThrow();
    fireEvent.change(screen.getByLabelText('Wallet password'),{target:{value:'incorrect'}});
    fireEvent.click(screen.getByRole('button',{name:'Authorize'}));
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Incorrect wallet password'));
    expect(getSpendingRequest()).not.toBeNull();act(()=>cancelSpendingApproval());await rejected;
  });
});
