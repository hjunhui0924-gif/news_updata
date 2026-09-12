import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { getConfig } from '../config';
import * as schema from './schema';

const state = globalThis as unknown as { newsPool?: Pool };
export function getPool() {
  return (state.newsPool ??= new Pool({
    connectionString: getConfig().DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5000,
  }));
}
export function getDb() {
  return drizzle(getPool(), { schema });
}
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
