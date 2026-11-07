import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This heap cap is per process. The server launcher additionally caps the entire
// process group with a systemd cgroup; it is not a total-memory guarantee alone.
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const env = {
  ...process.env,
  NEWSROOM_LOW_MEMORY_BUILD: '1',
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: '--max-old-space-size=768',
  RAYON_NUM_THREADS: '1',
  UV_THREADPOOL_SIZE: '1',
};
const steps = [
  ['node_modules/next/dist/bin/next', 'build', '--webpack'],
  ['scripts/clean-standalone-env.mjs'],
  [
    'node_modules/tsup/dist/cli-default.js',
    'src/worker/main.ts',
    '--format',
    'esm',
    '--platform',
    'node',
    '--out-dir',
    'dist/worker',
    '--external',
    'pg-native',
  ],
  [
    'node_modules/tsup/dist/cli-default.js',
    'scripts/migrate-production.ts',
    '--format',
    'esm',
    '--platform',
    'node',
    '--out-dir',
    'dist/migrate',
    '--external',
    'pg-native',
  ],
  ['scripts/check-worker-bundle.mjs'],
];
for (const args of steps) {
  console.log(`Low-memory build: ${args.join(' ')}`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
    child.once('error', () => resolve(1));
    child.once('exit', (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    console.error(
      'Low-memory build failed. Do not install or start services from partial build artifacts.',
    );
    process.exit(code);
  }
}
