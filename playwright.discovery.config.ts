import { defineConfig } from '@playwright/test';
import base from './playwright.starred.config';
export default defineConfig({
  ...base,
  testMatch: ['**/discovery.spec.ts', '**/ai-state.spec.ts', '**/starred.spec.ts'],
});
