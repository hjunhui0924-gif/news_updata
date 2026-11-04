import { Pool } from 'pg';
import { getConfig } from './config';
import { migrationNames } from './db/migration-manifest';
import { workerIsOnline } from '../shared/health';
import { createDatabasePool } from './db/pool';
type Query = (text: string) => Promise<{ rows: Record<string, unknown>[] }>;
const state = globalThis as unknown as { newsHealthPool?: Pool };
function probe(text: string) {
  const pool = (state.newsHealthPool ??= createDatabasePool({
    connectionString: getConfig().DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 1500,
    statement_timeout: 2000,
    query_timeout: 2500,
    idleTimeoutMillis: 1000,
    allowExitOnIdle: true,
  }));
  return pool.query(text);
}
export async function readiness(query: Query = probe) {
  const result = {
    ready: false,
    status: 'unavailable',
    database: 'unavailable',
    migrations: 'pending',
    worker: 'unknown',
    workerLastSeen: null as string | null,
  };
  try {
    const tables = await query("SELECT to_regclass('public.app_migrations') AS migrations");
    result.database = 'ready';
    if (!tables.rows[0]?.migrations) return result;
    const applied = await query('SELECT name FROM app_migrations');
    if (!migrationNames.every((name) => applied.rows.some((row) => row.name === name)))
      return result;
    result.migrations = 'ready';
    const heartbeat = await query("SELECT value FROM system_state WHERE key='worker-heartbeat'");
    const lastSeen = heartbeat.rows[0]?.value;
    result.workerLastSeen =
      typeof lastSeen === 'string' && Number.isFinite(Date.parse(lastSeen)) ? lastSeen : null;
    result.worker = workerIsOnline(lastSeen) ? 'online' : 'offline';
    result.ready = true;
    result.status = result.worker === 'online' ? 'ready' : 'degraded';
    return result;
  } catch {
    // No credentials, SQL or raw driver errors leave the server.
    return { ...result, ready: false, status: 'unavailable' };
  }
}
