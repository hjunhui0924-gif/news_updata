import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const systemChrome =
  process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:3002',
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
    command: 'pnpm exec tsx scripts/e2e-web.ts',
    url: 'http://127.0.0.1:3002/api/health/live',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_MODE: 'demo',
      APP_URL: 'http://127.0.0.1:3002',
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ||
        'postgresql://news:news_local_only@127.0.0.1:54329/news_e2e_test',
      LLM_ENABLED: 'false',
      LLM_API_KEY: '',
      LLM_API_BASE_URL: '',
      LLM_MODEL: '',
      GITHUB_READ_TOKEN: '',
      GITHUB_CLIENT_ID: '',
      GITHUB_CLIENT_SECRET: '',
      ALLOWED_GITHUB_USER_IDS: '',
      BETTER_AUTH_SECRET: 'isolated-demo-test-secret-not-for-production',
      STARRED_E2E: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
