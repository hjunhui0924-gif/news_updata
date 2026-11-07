// systemd injects /etc/newsroom/runtime.env. Never load a developer .env.local.
import { setTimeout } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (
  (process.env.APP_RUNTIME ?? 'native') !== 'native' ||
  process.env.DATABASE_RUNTIME !== 'native' ||
  process.env.APP_MODE !== 'live'
) {
  console.error(
    'Native systemd services require APP_RUNTIME=native, DATABASE_RUNTIME=native and APP_MODE=live.',
  );
  process.exit(1);
}
process.env.NODE_ENV = 'production';
const action = process.argv[2];
if (action === 'web') {
  process.env.HOSTNAME = process.env.APP_HOSTNAME || '127.0.0.1';
  await import('../.next/standalone/server.js');
} else if (action === 'worker') {
  await import('../dist/worker/main.js');
} else if (action === 'migrate') {
  await import('../dist/migrate/migrate-production.js');
} else if (action === 'check-web' || action === 'check-worker') {
  const mode = action.slice(6);
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    ready = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./healthcheck.mjs', import.meta.url)), mode],
        {
          stdio: 'ignore',
          windowsHide: true,
        },
      );
      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
    if (ready) break;
    await setTimeout(1000);
  }
  if (!ready) {
    console.error(`${mode} did not become healthy; inspect journalctl for the service.`);
    process.exitCode = 1;
  }
} else {
  console.error('Unknown native service action.');
  process.exitCode = 1;
}
