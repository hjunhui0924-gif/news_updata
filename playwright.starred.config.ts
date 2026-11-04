import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: ['**/starred.spec.ts', '**/reader-long-content.spec.ts'],
});
