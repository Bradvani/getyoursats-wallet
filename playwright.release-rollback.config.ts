import {defineConfig,devices} from '@playwright/test';
import rollback from './playwright.rollback.config';
export default defineConfig({
 ...rollback,retries:0,
 projects:[
  {name:'chromium',use:{...devices['Desktop Chrome']}},
  {name:'firefox',use:{...devices['Desktop Firefox']}},
  {name:'webkit',use:{...devices['Desktop Safari']}},
 ],
});
