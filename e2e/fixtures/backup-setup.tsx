import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Capacitor} from '@capacitor/core';
import '../../src/index.css';
import '../../src/getyoursats/premium.css';
import '../../src/getyoursats/appearance.css';
import AppShell from '../../src/components/layout/AppShell';
import BackupPage from '../../src/pages/BackupPage';
import {
  APP_LANGUAGES, initPresentation, setAppLanguage, setAppearancePreference,
} from '../../src/services/presentationPreferences';

// A visual fixture cannot share a browser profile with an actual wallet.
// It never initializes the SDK, stores a seed or creates a credential.
const marker = 'gys:backup-preview:v1';
const label = 'Synthetic backup preview';
const permittedKeys = new Set([marker, 'passkeyLabel', 'gys:language:v1', 'gys:appearance:v1']);
const existingKeys = Array.from({length: localStorage.length}, (_, index) => localStorage.key(index));
if (Capacitor.isNativePlatform() || existingKeys.some(key => key === null || !permittedKeys.has(key)) ||
  (localStorage.getItem('passkeyLabel') !== null &&
    (localStorage.getItem('passkeyLabel') !== label || localStorage.getItem(marker) !== '1'))) {
  throw new Error('Backup preview requires an isolated browser context');
}

const evidence = {credentialRequests: 0, completionRequests: 0, closeRequests: 0};
const blockCredentialRequest = async () => {
  evidence.credentialRequests += 1;
  throw new Error('Credential access is disabled in the backup preview');
};
Object.defineProperty(navigator, 'credentials', {
  configurable: true,
  value: {get: blockCredentialRequest, create: blockCredentialRequest},
});
(window as Window & {__gysBackupFixture?: typeof evidence}).__gysBackupFixture = evidence;

localStorage.setItem(marker, '1');
localStorage.setItem('passkeyLabel', label);
const parameters = new URLSearchParams(location.search);
setAppearancePreference(parameters.get('theme') === 'orange' ? 'orange' : 'dark');
setAppLanguage(APP_LANGUAGES.find(item => item.code === parameters.get('language'))?.code ?? 'en');
initPresentation();

function Fixture() {
  const [closed, setClosed] = useState(false);
  return closed
    ? <p data-testid="backup-fixture-closed">Backup preview closed.</p>
    : <BackupPage closeStyle="back" recoveryStatus="pending"
      onBack={() => {evidence.closeRequests += 1; setClosed(true);}}
      onRecoveryConfirmed={() => {evidence.completionRequests += 1;}}/>;
}

createRoot(document.getElementById('root')!).render(<AppShell><Fixture/></AppShell>);
