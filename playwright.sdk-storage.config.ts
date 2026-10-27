import {defineConfig, devices} from '@playwright/test';

// No wallet, provider, key material or production origin is used by these tests.
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: 'sdk-storage-cas.spec.ts',
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30000,
  reporter: [['line'], ['json', {outputFile: process.env.GYS_SDK_STORAGE_REPORT || 'test-artifacts/sdk-storage-cas.json'}]],
  use: {baseURL: 'http://127.0.0.1:4186', headless: true, trace: 'off', video: 'off', screenshot: 'off'},
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome'], launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    }}},
    {name: 'firefox', use: {...devices['Desktop Firefox']}},
    {name: 'webkit', use: {...devices['Desktop Safari']}},
  ],
  webServer: {
    command: 'node scripts/security/sdk-storage-test-server.mjs',
    url: 'http://127.0.0.1:4186', reuseExistingServer: false, timeout: 20000,
  },
});
