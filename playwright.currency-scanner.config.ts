import {defineConfig} from '@playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testMatch: ['currency-journey.spec.ts','scanner-product.spec.ts'],
  retries: 0,
  use: {...baseConfig.use,baseURL:'http://127.0.0.1:4175/',trace:'retain-on-failure'},
  webServer: {
    command:'npx vite preview --host 127.0.0.1 --port 4175 --outDir ui-test-dist',
    url:'http://127.0.0.1:4175/e2e/fixtures/premium-ui.html',
    reuseExistingServer:false,
  },
});
