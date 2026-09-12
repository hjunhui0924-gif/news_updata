import { Pool } from 'pg';
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL || 'postgresql://news:news_local_only@127.0.0.1:54329/news_test';
export default async function setup() {
  const url = new URL(testDatabaseUrl);
  const database = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(database))
    throw new Error('Integration database name must end with _test');
  url.pathname = '/postgres';
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const found = await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
    if (!found.rowCount) await pool.query(`CREATE DATABASE "${database}"`);
  } finally {
    await pool.end();
  }
}
