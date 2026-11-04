import { Pool, type PoolConfig } from 'pg';
export function createDatabasePool(options: PoolConfig) {
  const pool = new Pool(options);
  pool.on('error', () =>
    console.warn('Database idle connection lost; the next request will reconnect.'),
  );
  return pool;
}
