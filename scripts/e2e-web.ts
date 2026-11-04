import { Client } from 'pg';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { migrate } from './migrate';
import { seed } from './seed';
import { getPool } from '../src/server/db/client';
import { localDatabaseTarget, assertE2eDatabase } from './lib/database-safety';

const { url, database } = localDatabaseTarget(process.env.DATABASE_URL);
assertE2eDatabase(database);
if (process.env.APP_MODE !== 'demo') throw new Error('E2E requires demo mode');
url.pathname = '/postgres';
const admin = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
admin.on('error', () => console.error('E2E database connection unavailable'));
try {
  await admin.connect();
  const lock = await admin.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [
    `e2e:${database}`,
  ]);
  if (!lock.rows[0]?.locked) throw new Error('Another E2E process owns this database');
  // A fresh fixture database for every suite, never the daily or unit-test database.
  // Do not FORCE: existing foreign connections must prevent a destructive reset.
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.query(`CREATE DATABASE "${database}"`);
  await migrate();
  await seed();
  await getPool().end();
} catch {
  await admin.end();
  await getPool()
    .end()
    .catch(() => {});
  throw new Error('E2E database preparation failed; check dedicated database and Docker.');
}
const children = new Set<ChildProcess>();
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled(
    [...children].map((child) => {
      if (!child.pid) return Promise.resolve();
      if (process.platform === 'win32')
        return new Promise<void>((resolve) => {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
            resolve(),
          );
        });
      return new Promise<void>((resolve) => {
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        const timer = setTimeout(() => {
          try {
            process.kill(-child.pid!, 'SIGKILL');
          } catch {}
          resolve();
        }, 3000);
        try {
          process.kill(-child.pid!, 'SIGTERM');
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }),
  );
  await admin.end().catch(() => {});
  process.exit(code);
}
function launch(label: string, args: string[]) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('error', () => void stop(1));
  child.once('exit', (code) => {
    children.delete(child);
    if (!stopping) console.error(`E2E ${label} exited unexpectedly (${code})`);
    if (!stopping) void stop(code ?? 1);
  });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop(0));
launch('Worker', ['--import', 'tsx', 'src/worker/main.ts']);
launch('Web', [
  'node_modules/next/dist/bin/next',
  'dev',
  '--hostname',
  '127.0.0.1',
  '--port',
  '3002',
]);
