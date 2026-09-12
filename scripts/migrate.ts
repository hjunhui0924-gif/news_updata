import { readFile, readdir } from 'node:fs/promises';
import { getPool, transaction } from '../src/server/db/client';

export async function migrate() {
  const directory = new URL('../drizzle/', import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(739105)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM app_migrations WHERE name=$1', [file]);
      if (applied.rowCount) continue;
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO app_migrations(name) VALUES($1)', [file]);
    }
  });
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/migrate.ts')) {
  migrate()
    .then(() => console.log('Database migration complete.'))
    .finally(() => getPool().end());
}
