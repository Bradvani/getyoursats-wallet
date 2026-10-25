import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e/tests',testMatch:'rollback-compatibility.spec.ts',workers:1,retries:0,timeout:60_000,reporter:'line',
 use:{baseURL:'http://127.0.0.1:5184',headless:true,trace:'off',video:'off',screenshot:'off'},
 webServer:{command:'node scripts/security/rollback-test-server.mjs',url:'http://127.0.0.1:5184/recovery-rollback/',reuseExistingServer:false,timeout:60_000},
});
