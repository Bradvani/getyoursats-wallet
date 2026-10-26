import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/production',
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', use: {
      ...devices['Desktop Chrome'],
      launchOptions: process.env.GYS_CHROMIUM_PATH ? {
        executablePath: process.env.GYS_CHROMIUM_PATH,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      } : undefined,
    } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
