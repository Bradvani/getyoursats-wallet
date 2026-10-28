import {defineConfig} from '@playwright/test';

// Disposable fixtures only. Never record recovery screens or payment credentials.
export default defineConfig({
  testDir:'./e2e/tests',
  testMatch:['browser-vault-security.spec.ts','browser-vault-concurrency.spec.ts','browser-vault-clean-restore.spec.ts','browser-security-preview.spec.ts','recovery-history.spec.ts','storage-migration.spec.ts'],
  workers:1,
  timeout:60000,
  reporter:'line',
  use:{
    baseURL:'http://localhost:5173',
    headless:true,
    trace:'off',video:'off',screenshot:'off',
    launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH},
  },
  webServer:{
    command:'VITE_STAGING_PASSWORD= npm run dev -- --host 127.0.0.1',
    url:'http://localhost:5173',reuseExistingServer:!process.env.CI,timeout:60000,
  },
});
