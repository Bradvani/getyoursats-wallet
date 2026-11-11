#!/usr/bin/env python3
"""Deterministic source integration for PR43. Run only on its reviewed branch.
No production interlock or unreviewed raw SDK capability is removed.
"""
from pathlib import Path

def change(path,old,new):
 p=Path(path);s=p.read_text()
 if new in s:return
 if s.count(old)!=1:raise RuntimeError(f'Unexpected source: {path}: {old[:100]} ({s.count(old)})')
 p.write_text(s.replace(old,new))

p=Path('src/features/unilateral-exit/driver.ts');s=p.read_text()
if 'Recovery plan persistence must complete before broadcasting' not in s:
 start=s.index('export function savePlan(');end=s.index('// The plan Glow stored',start)
 s=s[:start]+'''/** Recovery plan persistence must complete before broadcasting or clearing a pending exit.
 * Keep the whole snapshot; never silently drop it on quota failure. */
export function savePlan(wallet: WalletKey, plan: UnilateralExitPlan): void {
  const key = storageKey(wallet);
  const serialized = JSON.stringify(plan);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) {
    throw new Error('Recovery plan could not be saved. No new exit broadcast is permitted. Keep wallet data.');
  }
}

'''+s[end:]
 start=s.index('export function savePendingExit(');end=s.index('export function loadPendingExit(',start)
 s=s[:start]+'''export function savePendingExit(wallet: WalletKey, pending: PendingExit): void {
  const key = pendingKey(wallet);
  const serialized = JSON.stringify(pending);
  localStorage.setItem(key, serialized);
  if (localStorage.getItem(key) !== serialized) {
    throw new Error('Pending exit could not be saved. Do not fund or replace this exit yet.');
  }
}

'''+s[end:]
 if 'saveExitState(' not in s:s=s.replace('loadExitState, restoreExitState, saveExitState','loadExitState, restoreExitState')
 p.write_text(s)
change('src/services/esplora.ts',"    case 'testnet':\n      return 'https://mempool.space/testnet/api';", "    case 'testnet':\n      return 'https://mempool.space/testnet/api';\n    case 'signet':\n      return 'https://mempool.space/signet/api';")
change('src/services/esplora.ts',"    default:\n      return 'https://mempool.space/api';", "    case 'mainnet':\n      return 'https://mempool.space/api';\n    default:\n      throw new Error('Unsupported Bitcoin chain network');")
change('src/security/operationGateway.ts',"import {BROWSER_SPENDING_POLICY} from './browserReleasePolicy';", "import {BROWSER_SPENDING_POLICY} from './browserReleasePolicy';\nimport {SIGNED_RECOVERY,createSignedRecoveryController} from './signedRecoveryController';\nimport {assertNoUnresolvedRecovery} from './signedRecoveryJournal';")
change('src/security/operationGateway.ts','  const reconciliation:OperationReconciliation=Object.freeze({', '''  const recovery=createSignedRecoveryController({network,walletKey:getWalletKey,assertConnection,
    raw:()=>{if(!client)throw new Error('Wallet is not connected');return client;}});
  const reconciliation:OperationReconciliation=Object.freeze({''')
change('src/security/operationGateway.ts','        const unresolved=readAllOperations().find(isUnresolved);','        assertNoUnresolvedRecovery();\n        const unresolved=readAllOperations().find(isUnresolved);')
change('src/security/operationGateway.ts','      const unresolved=readOperations(walletKey).find(isUnresolved);','      assertNoUnresolvedRecovery(walletKey);\n      const unresolved=readOperations(walletKey).find(isUnresolved);')
change('src/security/operationGateway.ts','          const unresolved=readOperations(await getWalletKey()).find(isUnresolved);','          const currentWallet=await getWalletKey();\n          assertNoUnresolvedRecovery(currentWallet);\n          const unresolved=readOperations(currentWallet).find(isUnresolved);')
change('src/security/operationGateway.ts','        if(key===RECONCILIATION)return reconciliation;','        if(key===RECONCILIATION)return reconciliation;\n        if(key===SIGNED_RECOVERY)return recovery;\n        if(key===\'refundDeposit\')return recovery.refund;')
change('src/security/operationGateway.test.ts',"it.each(['refundDeposit','recoverFunds'", "it.each(['signRefundDeposit','verifyRefundTransaction','inspectRecoveryTransaction','recoverFunds'")
change('src/pages/WalletPage.tsx',"import PaymentReconciliationBanner from '../security/PaymentReconciliationBanner';", "import PaymentReconciliationBanner from '../security/PaymentReconciliationBanner';\nimport WalletRecoveryPanel from '../security/WalletRecoveryPanel';")
change('src/pages/WalletPage.tsx','<PaymentReconciliationBanner/>','<PaymentReconciliationBanner/><WalletRecoveryPanel/>')
change('src/App.tsx',"import WebWalletVaultPage from './security/WebWalletVaultPage';", "import WebWalletVaultPage from './security/WebWalletVaultPage';\nimport {getSignedRecovery} from './security/signedRecoveryController';")
change('src/App.tsx','if(sdk.sdk&&isRestrictedBrowserWallet(sdk.sdk))return <UnavailableWalletAction title="Deposit refund"', 'if(sdk.sdk&&isRestrictedBrowserWallet(sdk.sdk)&&!getSignedRecovery(sdk.sdk))return <UnavailableWalletAction title="Deposit refund"')
change('src/pages/GetRefundPage.tsx',"import { useWallet } from '../contexts/WalletContext';", "import { useWallet } from '../contexts/WalletContext';\nimport {getSignedRecovery} from '../security/signedRecoveryController';\nimport WalletRecoveryPanel from '../security/WalletRecoveryPanel';")
change('src/pages/GetRefundPage.tsx','      removeRejectedDeposit(selectedDeposit.txid, selectedDeposit.vout);','      // Browser acknowledgement is not confirmation; retain recovery visibility.\n      if(!getSignedRecovery(wallet))removeRejectedDeposit(selectedDeposit.txid, selectedDeposit.vout);')
change('src/pages/GetRefundPage.tsx',"      setRefundStep('confirm');\n    } finally", "      if(getSignedRecovery(wallet)){setIsRefundFlowOpen(false);setError('Check the saved recovery before trying again. No new refund should be created after an uncertain result.');}\n      else setRefundStep('confirm');\n    } finally")
change('src/pages/GetRefundPage.tsx','      <div className="p-4">','      <WalletRecoveryPanel/>\n      <div className="p-4">')
change('src/pages/GetRefundPage.tsx','<ResultStep result="success" error={null} onClose={closeRefundFlow} operationType="refund">','<ResultStep result="success" error={null} onClose={closeRefundFlow} operationType="refund">\n                {getSignedRecovery(wallet)&&<p role="status" className="text-sm">Refund submitted. Bitcoin confirmation is still pending. Keep this wallet on the device.</p>}')
change('src/security/signedRecoveryController.ts',"    r=updateRecovery(r,{state:'uncertain',transactions:r.transactions.map(t=>t.txId===tx.txId?{...t,state:'uncertain'}:t)});", "    updateRecovery(r,{state:'uncertain',transactions:r.transactions.map(t=>t.txId===tx.txId?{...t,state:'uncertain'}:t)});")
change('src/security/signedRecoveryController.ts',"   }else{live(epoch);ready.add(tx.txId);}", "   }else{\n    live(epoch);\n    if(r.state==='confirmed')r=updateRecovery(r,{state:'uncertain',transactions:[{...tx,state:'uncertain'}]});\n    ready.add(tx.txId);\n   }")
change('src/security/signedRecoveryController.ts',"state:complete?'confirmed':checked.verdict.type==='redo'?'uncertain':r.state", "state:complete?'confirmed':checked.verdict.type==='redo'||r.state==='confirmed'?'uncertain':r.state")
change('src/security/signedRecoveryController.ts',"   if(record.state==='confirmed')return record;\n   const checked=await checkRecord", "   // Even a previously confirmed record is freshly checked for reorgs.\n   const checked=await checkRecord")
# Replace obsolete assertions; retain stronger denial and preservation requirements.
change('src/security/sdkConnect.security.test.ts',"  expect(()=>wallet.refundDeposit({} as never)).toThrow(/unavailable pending/);", "  // The public refund method now enters the mandatory recovery controller.\n  // Raw signing/publication capabilities remain unavailable.\n  expect(()=>Reflect.get(wallet,'signRefundDeposit')({})).toThrow(/unavailable pending/);")
change('src/features/unilateral-exit/durablePersistence.test.ts',"  expect(()=>savePlan(wallet,{...previous,exitStateSnapshot:'new-snapshot'})).toThrow();", "  write.mockClear();\n  expect(()=>savePlan(wallet,{...previous,exitStateSnapshot:'new-snapshot'})).toThrow();")
p=Path('src/features/unilateral-exit/driver.test.ts');s=p.read_text()
old="describe('savePlan when the snapshot outgrows storage', () => {"
if "it('rejects the write without dropping the original snapshot'" not in s:
 start=s.index(old);end=s.index("describe('destinationAddressOf'",start)
 s=s[:start]+'''describe('savePlan when the snapshot outgrows storage', () => {
  it('rejects the write without dropping the original snapshot', () => {
    const owner = { identityPubkey: 'snapshot-owner', network: 'regtest' };
    const original = plan([tx({ txid: 'original' })], { exitStateSnapshot: 'original-snapshot' });
    savePlan(owner, original);
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => savePlan(owner, plan([tx({ txid: 'new' })], { exitStateSnapshot: 'huge-snapshot' }))).toThrow();
    expect(loadPlan(owner)).toEqual(original);
  });
});

'''+s[end:];p.write_text(s)
print('Recovery gateway, persistence and interface integration applied. Run all acceptance tests before preserving.')
