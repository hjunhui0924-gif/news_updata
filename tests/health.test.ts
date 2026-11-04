import { it, expect, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { readiness } from '../src/server/health';
import { migrationNames } from '../src/server/db/migration-manifest';
import { workerIsOnline } from '../src/shared/health';
import { waitForReady } from '../scripts/lib/wait-ready';
it('keeps the readiness migration manifest complete', async () => {
  expect((await readdir('drizzle')).filter((name) => /^\d+.*\.sql$/.test(name)).sort()).toEqual(
    migrationNames,
  );
});
it('distinguishes connection failure, missing migrations, offline worker and full readiness', async () => {
  expect(
    await readiness(async () => {
      throw new Error('secret credential');
    }),
  ).toMatchObject({ ready: false, database: 'unavailable' });
  expect(await readiness(async () => ({ rows: [] }))).toMatchObject({
    ready: false,
    database: 'ready',
    migrations: 'pending',
  });
  const probe = (value: unknown) => async (text: string) => ({
    rows: text.includes('to_regclass')
      ? [{ migrations: 'app_migrations' }]
      : text.includes('SELECT name')
        ? migrationNames.map((name) => ({ name }))
        : [{ value }],
  });
  expect(await readiness(probe(null))).toMatchObject({
    ready: true,
    status: 'degraded',
    worker: 'offline',
  });
  expect(await readiness(probe(new Date().toISOString()))).toMatchObject({
    ready: true,
    status: 'ready',
    worker: 'online',
  });
});
it('ignores malformed, stale and future worker heartbeats', () => {
  for (const value of [
    null,
    'broken',
    new Date(Date.now() - 61000).toISOString(),
    new Date(Date.now() + 60000).toISOString(),
  ])
    expect(workerIsOnline(value)).toBe(false);
});
it('startup does not declare ready until this worker has emitted a fresh heartbeat', async () => {
  let calls = 0;
  const startedAt = Date.now();
  const fetcher = vi.fn(async () =>
    Response.json({
      ready: true,
      worker: 'online',
      workerLastSeen: new Date(++calls < 3 ? startedAt - 10000 : Date.now()).toISOString(),
    }),
  );
  await waitForReady('http://127.0.0.1:3002', {
    startedAt,
    intervalMs: 1,
    timeoutMs: 2000,
    fetcher,
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  await expect(
    waitForReady('http://127.0.0.1:3002', {
      intervalMs: 1,
      timeoutMs: 5,
      fetcher: async () => new Response('{}', { status: 503 }),
    }),
  ).rejects.toThrow('未在等待时间内就绪');
});
