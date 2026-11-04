import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, testMatch: 'performance.spec.ts', timeout: 180000 });
