import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { getConfig } from '../src/server/config';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const children = new Set<ChildProcess>();
let stopping = false;

function launch(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}
function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = launch(command, args);
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited (${code})`)),
    );
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    [...children].map(async (child) => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === 'win32') {
        // Only terminate process trees created by this launcher; never search by port/name.
        await new Promise<void>((resolve) => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('error', () => resolve());
          killer.once('exit', () => resolve());
        });
      } else {
        child.kill('SIGTERM');
      }
    }),
  );
  process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

try {
  if (process.argv.includes('--help')) {
    console.log(
      'pnpm demo [--no-docker]\nStarts local demo Web + Worker. Docker is used only for PostgreSQL.',
    );
    process.exit(0);
  }
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--no-docker' && arg !== '--');
  if (unknown.length) throw new Error(`Unknown option: ${unknown.join(', ')}`);
  if (!existsSync('.env.local')) {
    writeFileSync(
      '.env.local',
      readFileSync('.env.example', 'utf8').replace(
        'replace-with-a-random-secret-at-least-32-characters',
        randomBytes(32).toString('hex'),
      ),
    );
  }
  loadEnvFile('.env.local');
  const config = getConfig();
  if (config.APP_MODE !== 'demo')
    throw new Error(
      'pnpm demo requires APP_MODE=demo. For live mode use pnpm dev and pnpm worker:dev.',
    );
  const appUrl = new URL(config.APP_URL);
  if (appUrl.protocol !== 'http:' || appUrl.hostname !== '127.0.0.1') {
    throw new Error('Demo launcher requires APP_URL=http://127.0.0.1:<port>.');
  }
  const port = Number(appUrl.port || 80);
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is occupied. Stop the existing app or change APP_URL.`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
  if (!process.argv.includes('--no-docker')) {
    console.log('Starting PostgreSQL with Docker (use --no-docker for an existing database)...');
    await run('docker', ['compose', 'up', '-d', '--wait', 'db']);
  }
  for (const script of ['scripts/migrate.ts', 'scripts/seed.ts']) {
    await run(process.execPath, ['--import', 'tsx', '--env-file=.env.local', script]);
  }
  for (const args of [
    ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    ['--import', 'tsx', '--env-file=.env.local', 'src/worker/main.ts'],
  ]) {
    const child = launch(process.execPath, args);
    child.once('error', (error) => {
      console.error(error.message);
      void stop(1);
    });
    child.once('exit', (code) => {
      if (!stopping) void stop(code || 1);
    });
  }
  console.log(
    `\nDemo starting: ${config.APP_URL}\nPress Ctrl+C to stop Web + Worker. PostgreSQL data is retained.\n`,
  );
} catch (error) {
  console.error(
    `Startup failed: ${(error as Error).message}\nCheck .env.local and PostgreSQL. If Docker is unavailable, use pnpm demo --no-docker.`,
  );
  await stop(1);
}
