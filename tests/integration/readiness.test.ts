import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createDatabasePool } from '../../src/server/db/pool';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { readiness } from '../../src/server/health';
import { migrationNames } from '../../src/server/db/migration-manifest';
beforeAll(async () => {
  process.env.APP_MODE = 'demo';
  await migrate();
});
it('reconnects after its own idle PostgreSQL connection is terminated', async () => {
  const pool = createDatabasePool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const previous = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const disconnected = new Promise<void>((resolve) => pool.once('error', () => resolve()));
    await getPool().query('SELECT pg_terminate_backend($1)', [previous]);
    await disconnected;
    const next = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    expect(next).not.toBe(previous);
    expect(warning).toHaveBeenCalledWith(
      'Database idle connection lost; the next request will reconnect.',
    );
  } finally {
    warning.mockRestore();
    await pool.end();
  }
});
afterAll(async () => {
  await getPool().end();
});
it('reports missing migrations, recovery and worker degradation against PostgreSQL', async () => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const query = (text: string) => client.query(text);
    await client.query('DELETE FROM app_migrations WHERE name=$1', [migrationNames.at(-1)]);
    expect(await readiness(query)).toMatchObject({
      ready: false,
      database: 'ready',
      migrations: 'pending',
    });
    await client.query('INSERT INTO app_migrations(name) VALUES($1)', [migrationNames.at(-1)]);
    await client.query("DELETE FROM system_state WHERE key='worker-heartbeat'");
    expect(await readiness(query)).toMatchObject({
      ready: true,
      status: 'degraded',
      worker: 'offline',
    });
    await client.query("INSERT INTO system_state(key,value) VALUES('worker-heartbeat',$1)", [
      JSON.stringify(new Date().toISOString()),
    ]);
    expect(await readiness(query)).toMatchObject({
      ready: true,
      status: 'ready',
      worker: 'online',
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
