import { defineConfig } from '@playwright/test';
import base from './playwright.following.config';
export default defineConfig({
  ...base,
  testMatch: ['**/github-auth.spec.ts', ...(Array.isArray(base.testMatch) ? base.testMatch : [])],
});
