import {test, expect, type BrowserContext, type Page} from '@playwright/test';

// Public BIP39 fixture only. These tests never connect an SDK wallet or move value.
// A fresh browser context proves software/profile separation, not physical-device
// recovery, synchronized passkeys, hardware isolation or balance/history recovery.
const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const oldPassword = 'public-fixture-original-password';
const newPassword = 'public-fixture-restored-password';
const fixture = '/e2e/fixtures/browser-vault-security.html';
const vaultPath = '/src/security/webWalletVault.ts';
const approvalPath = '/src/security/spendApproval.ts';
const guardPath = '/src/security/guardedExternalSigners.ts';
const sdkPath = '/node_modules/@breeztech/breez-sdk-spark/web/breez_sdk_spark_wasm.js';
const journalPath = '/src/security/operationJournal.ts';
const expectedIdentity = '02698b27ac308b275671b3ca25436346469d04a5bba578ae39feba1d65897a6abc';

test.use({trace: 'off', video: 'off', screenshot: 'off'});
async function localOnly(context: BrowserContext): Promise<void> {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname)
      ? route.continue() : route.abort('blockedbyclient');
  });
}
async function enrollAndReadIdentity(page: Page, password: string) {
  return page.evaluate(async ({words, password, vaultPath, sdkPath}) => {
    const vault = await import(vaultPath);
    const sdk = await import(sdkPath);
    await sdk.default();
    await vault.enrollWebWallet(words, password);
    const restored = await vault.unlockWebWallet(password);
    const handles = sdk.defaultExternalSignersFromSeed({type: 'mnemonic', mnemonic: restored}, 'regtest', undefined);
    const breez = handles.breezSigner, spark = handles.sparkSigner;
    handles.free();
    try {
      const identity = Array.from((await spark.getIdentityPublicKey()).bytes as number[], b => b.toString(16).padStart(2, '0')).join('');
      return {identity, vault: localStorage.getItem(vault.WEB_VAULT_KEY),
        plaintextPresent: JSON.stringify(localStorage).includes(words)};
    } finally { breez.free(); spark.free(); }
  }, {words, password, vaultPath, sdkPath});
}

test('clean isolated profile restores the same compiled signer without replacing the original vault', async ({browser, context, page, baseURL}) => {
  await localOnly(context);
  await page.goto(fixture);
  const original = await enrollAndReadIdentity(page, oldPassword);
  expect(original.identity).toBe(expectedIdentity);
  expect(original.plaintextPresent).toBe(false);
  expect(original.vault).not.toBeNull();
  const clean = await browser.newContext({baseURL, serviceWorkers: 'block'});
  try {
    await localOnly(clean);
    const restoredPage = await clean.newPage();
    await restoredPage.goto(fixture);
    expect(await restoredPage.evaluate(path => import(path).then(v => v.hasWebWalletVault()), vaultPath)).toBe(false);
    const restored = await enrollAndReadIdentity(restoredPage, newPassword);
    expect(restored.identity).toBe(original.identity);
    expect(restored.vault).not.toBe(original.vault);
    expect(restored.plaintextPresent).toBe(false);
    await restoredPage.reload();
    expect(await restoredPage.evaluate(path => import(path).then(v => v.getUnlockedWebMnemonic()), vaultPath)).toBeNull();
    const result = await restoredPage.evaluate(async ({vaultPath, oldPassword, newPassword, words}) => {
      const vault = await import(vaultPath);
      let wrongPasswordRejected = false;
      try { await vault.unlockWebWallet(oldPassword); } catch { wrongPasswordRejected = true; }
      const phraseUnchanged = await vault.unlockWebWallet(newPassword) === words;
      return {wrongPasswordRejected, phraseUnchanged};
    }, {vaultPath, oldPassword, newPassword, words});
    expect(result).toEqual({wrongPasswordRejected: true, phraseUnchanged: true});
    expect(await page.evaluate(path => import(path).then(v => localStorage.getItem(v.WEB_VAULT_KEY)), vaultPath)).toBe(original.vault);
  } finally { await clean.close(); }
});

test('real browser WASM signing is revoked on lock and old handles stay revoked after unlock', async ({context, page}) => {
  await localOnly(context);
  await page.goto(fixture);
  await enrollAndReadIdentity(page, oldPassword);
  const result = await page.evaluate(async ({words, approvalPath, guardPath, sdkPath}) => {
    const approval = await import(approvalPath), guardModule = await import(guardPath), sdk = await import(sdkPath);
    await sdk.default();
    const seed = {type: 'mnemonic', mnemonic: words};
    await approval.rememberSignerIdentity(seed);
    const handles = sdk.defaultExternalSignersFromSeed(seed, 'regtest', undefined);
    // The guard owns and releases the container and both child handles.
    const guarded = guardModule.guardExternalSigners(handles);
    const rejected = async (work: () => Promise<unknown>) => {
      try { await work(); return false; } catch (error) { return /locked|replaced|changed/.test(String(error)); }
    };
    try {
      const signatureLength = (await guarded.sparkSigner.signMessage([1, 2, 3])).bytes.length;
      // Attach the rejection handler before revoking this in-flight operation.
      const pendingRejected = rejected(() => guarded.breezSigner.signEcdsa({bytes: Array(32).fill(42)}, 'm'));
      approval.lockSpendingSession();
      const inFlightRejected = await pendingRejected;
      const lockedRejected = await rejected(() => guarded.sparkSigner.signMessage([1, 2, 3]));
      await approval.unlockSpendingSession(seed);
      const revokedAfterUnlock = await rejected(() => guarded.sparkSigner.signMessage([1, 2, 3]));
      return {signatureLength, inFlightRejected, lockedRejected, revokedAfterUnlock};
    } finally { await guarded.dispose(); await guarded.dispose(); }
  }, {words, approvalPath, guardPath, sdkPath});
  expect(result).toEqual({signatureLength: 64, inFlightRejected: true, lockedRejected: true, revokedAfterUnlock: true});
});

test('uncertain journal survives profile reload and rejects a duplicate submitting record', async ({context, page}) => {
  await localOnly(context);
  await page.goto(fixture);
  const before = await page.evaluate(async ({journalPath, expectedIdentity}) => {
    const journal = await import(journalPath);
    const walletKey = await journal.operationWalletKey('regtest', expectedIdentity);
    const now = Date.now();
    const record = journal.writeOperation({version: 1, walletKey, operationId: crypto.randomUUID(),
      paymentId: 'public-fixture-payment', intentHash: await journal.journalDigest({fixture: 'uncertain'}),
      network: 'regtest', route: 'spark', amountSats: '100', feeLimitSats: '0', state: 'submitting', createdAt: now, updatedAt: now});
    const unknown = journal.updateOperation(record, {state: 'unknown'});
    return {walletKey, operationId: unknown.operationId};
  }, {journalPath, expectedIdentity});
  await page.reload();
  const after = await page.evaluate(async ({journalPath, expectedIdentity, before}) => {
    const journal = await import(journalPath);
    const rows = journal.readOperations(before.walletKey);
    const row = rows[0];
    let duplicateRejected = false;
    try { journal.writeOperation({...row, state: 'submitting'}); } catch { duplicateRejected = true; }
    const otherNetwork = await journal.operationWalletKey('mainnet', expectedIdentity);
    return {count: rows.length, operationId: row.operationId, state: row.state,
      unresolved: journal.isUnresolved(row), duplicateRejected, otherNetworkCount: journal.readOperations(otherNetwork).length};
  }, {journalPath, expectedIdentity, before});
  expect(after).toEqual({count: 1, operationId: before.operationId, state: 'unknown', unresolved: true,
    duplicateRejected: true, otherNetworkCount: 0});
});
