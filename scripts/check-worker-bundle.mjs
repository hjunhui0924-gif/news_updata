import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entry = new URL('../dist/worker/main.js', import.meta.url);
if (!existsSync(fileURLToPath(entry))) {
  console.error('Worker bundle missing; run pnpm build first.');
  process.exit(1);
}
// Load the actual production bundle with plain Node, then stop at config validation
// before any database, scheduler, external API or paid model operation can start.
const probe = `
try {
  await import(${JSON.stringify(entry.href)});
  console.error('Worker preflight did not stop at configuration validation.');
  process.exitCode = 1;
} catch (error) {
  const expected = error?.name === 'ZodError' && error.issues?.some(issue => issue.path?.[0] === 'APP_MODE');
  if (!expected) {
    console.error('Worker bundle cannot load in Node:', error?.code ?? error?.name ?? 'UnknownError');
    process.exitCode = 1;
  }
}
`;
const env = { ...process.env, APP_MODE: 'worker-preflight', NODE_ENV: 'production' };
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env,
  encoding: 'utf8',
  timeout: 15000,
  windowsHide: true,
});
if (result.error || result.status !== 0) {
  console.error(result.error?.code ?? result.stderr.trim() ?? 'Worker import check failed.');
  process.exit(1);
}
console.log('Worker bundle import check passed; no services or external requests started.');
