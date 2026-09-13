import { defineConfig } from '@playwright/test';
import base from './playwright.auth.config';
export default defineConfig({
  ...base,
  testMatch: [
    '**/repository-search.spec.ts',
    ...(Array.isArray(base.testMatch) ? base.testMatch : []),
  ],
});
