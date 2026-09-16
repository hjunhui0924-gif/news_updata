import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: '**/skills.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:3003' },
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3003',
    url: 'http://127.0.0.1:3003/login',
    timeout: 120000,
    reuseExistingServer: false,
    env: {
      APP_MODE: 'demo',
      APP_URL: 'http://127.0.0.1:3003',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
