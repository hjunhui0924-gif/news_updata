import { Client } from 'pg';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readiness } from '../src/server/health';
import { diagnosticErrorCode } from './lib/database-safety';
import { parseAppRuntime, parseDatabaseRuntime } from '../src/server/config';

const report: Record<string, unknown> = {
  checkedAt: new Date().toISOString(),
  mode: process.env.APP_MODE === 'live' ? 'live' : 'demo',
  appRuntime: parseAppRuntime(process.env.APP_RUNTIME),
  databaseRuntime: parseDatabaseRuntime(process.env.DATABASE_RUNTIME),
  configured: Object.fromEntries(
    [
      'DATABASE_URL',
      'GITHUB_CLIENT_ID',
      'GITHUB_CLIENT_SECRET',
      'GITHUB_READ_TOKEN',
      'YOUTUBE_API_KEY',
      'YOUTUBE_CLIENT_ID',
      'YOUTUBE_CLIENT_SECRET',
      'LLM_API_KEY',
    ].map((key) => [key, !!process.env[key]]),
  ),
};
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 3000,
  statement_timeout: 3000,
});
client.on('error', () => {});
try {
  await client.connect();
  report.readiness = await readiness((text) => client.query(text));
  if ((report.readiness as { ready: boolean }).ready) {
    report.jobs = (
      await client.query(
        'SELECT status,count(*)::int AS count FROM jobs GROUP BY status ORDER BY status',
      )
    ).rows;
  }
} catch (error) {
  report.databaseError = diagnosticErrorCode(error);
} finally {
  await client.end().catch(() => {});
}
// Probe only the local configured Web. Never follow a redirect or send credentials.
try {
  const base = new URL(process.env.APP_URL || 'http://127.0.0.1:3000');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('NotLocal');
  const response = await fetch(new URL('/api/health/ready', base.origin), {
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  });
  report.web = { reachable: true, status: response.status };
} catch {
  report.web = { reachable: false };
}
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'work'), { recursive: true });
await writeFile(resolve(root, 'work', 'diagnostics.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!(report.readiness as { ready?: boolean } | undefined)?.ready) process.exitCode = 1;
