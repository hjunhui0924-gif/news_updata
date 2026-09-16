import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChrome =
  process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  testMatch: '**/skills.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:3003',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        process.env.CHROME_PATH ||
        (systemChrome && existsSync(systemChrome) ? systemChrome : undefined),
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
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
