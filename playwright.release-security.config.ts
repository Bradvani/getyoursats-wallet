import {defineConfig,devices} from '@playwright/test';
import security from './playwright.security.config';
export default defineConfig({
 ...security,
 retries:0,
 use:{...security.use,launchOptions:undefined,trace:'off',video:'off',screenshot:'off'},
 projects:[
  {name:'chromium',use:{...devices['Desktop Chrome']}},
  {name:'firefox',use:{...devices['Desktop Firefox']}},
  {name:'webkit',use:{...devices['Desktop Safari']}},
 ],
});
