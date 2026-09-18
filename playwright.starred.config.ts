import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: ['**/starred.spec.ts', '**/reader-long-content.spec.ts'],
  use: { ...base.use, baseURL: 'http://127.0.0.1:3002' },
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3002',
    url: 'http://127.0.0.1:3002/login',
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_MODE: 'demo',
      APP_URL: 'http://127.0.0.1:3002',
      STARRED_E2E: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
