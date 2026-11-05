import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { migrate } from './migrate';
import { getPool } from '../src/server/db/client';

try {
  await migrate(pathToFileURL(resolve(process.cwd(), 'drizzle') + sep));
  console.log('Database migration complete.');
} catch {
  console.error('Database migration failed; application startup is blocked.');
  process.exitCode = 1;
} finally {
  await getPool().end();
}
