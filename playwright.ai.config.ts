import { defineConfig } from '@playwright/test';
import isolated from './playwright.starred.config';
export default defineConfig({ ...isolated, testMatch: '**/ai-state.spec.ts' });
