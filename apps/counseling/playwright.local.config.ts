import {defineConfig} from '@playwright/test'
export default defineConfig({testDir:'./tests',testMatch:'**/local.spec.ts',outputDir:'test-results/local',workers:1,timeout:60000,reporter:'list',use:{baseURL:process.env.COUNSELING_TEST_URL||'http://127.0.0.1:8765',channel:process.env.PW_BROWSER_CHANNEL||'msedge',headless:true,trace:'retain-on-failure'}})
