import { defineConfig } from '@playwright/test';
import base from './playwright.discovery.config';
export default defineConfig({
  ...base,
  testMatch: [
    '**/following.spec.ts',
    '**/starred.spec.ts',
    '**/ai-state.spec.ts',
    '**/discovery.spec.ts',
    '**/sync-status.spec.ts',
  ],
});
