import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const webServer = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer;
if (!webServer) throw new Error('Server trial tests require a web server configuration.');

export default defineConfig({
  ...base,
  testMatch: [
    '**/skills.spec.ts',
    '**/github-auth.spec.ts',
    '**/reader-polish.spec.ts',
    '**/reader-readability.spec.ts',
    '**/settings-layout.spec.ts',
  ],
  webServer: {
    ...webServer,
    env: { ...webServer.env, E2E_ISOLATED_BUILD: 'server-trial' },
  },
});
