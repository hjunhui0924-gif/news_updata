import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Run as root. Administrative SQL uses local peer authentication; no password
// appears in argv, shell history, process output or the systemd unit files.
function admin(sql) {
  const result = spawnSync(
    'runuser',
    [
      '-u',
      'postgres',
      '--',
      'psql',
      '-X',
      '-h',
      '/var/run/postgresql',
      '-p',
      '5432',
      '-d',
      'postgres',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('PostgreSQL administrative check failed.');
  return result.stdout.trim();
}

try {
  if (process.getuid?.() !== 0) throw new Error('Run with sudo after installing PostgreSQL 17.');
  const env = parseEnv(await readFile('/etc/newsroom/runtime.env', 'utf8'));
  const url = new URL(env.DATABASE_URL);
  if (
    env.DATABASE_RUNTIME !== 'native' ||
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '5432' ||
    url.username !== 'news' ||
    url.pathname !== '/news' ||
    url.search ||
    url.hash ||
    decodeURIComponent(url.password).length < 24
  )
    throw new Error(
      'Setup requires a dedicated news role/database at 127.0.0.1:5432 and a strong password.',
    );
  if (Number(admin('SHOW server_version_num;')) < 170000)
    throw new Error('PostgreSQL 17 or newer is required.');

  if (admin("SELECT count(*) FROM pg_roles WHERE rolname='news';") === '0') {
    const password = decodeURIComponent(url.password).replaceAll("'", "''");
    admin(
      `SET standard_conforming_strings=on; SET password_encryption='scram-sha-256'; CREATE ROLE news LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;`,
    );
  }
  if (
    admin(
      "SELECT count(*) FROM pg_roles WHERE rolname='news' AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls;",
    ) !== '1'
  )
    throw new Error('Existing news role has unexpected privileges; no role was altered.');
  if (admin("SELECT count(*) FROM pg_database WHERE datname='news';") === '0')
    admin('CREATE DATABASE news OWNER news;');
  if (admin("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='news';") !== 'news')
    throw new Error('Existing news database has a different owner; no ownership was changed.');
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
  console.log(
    'Native database connection verified; existing passwords and data were not replaced.',
  );
} catch {
  console.error(
    'Native database setup failed. Check PostgreSQL 17, the dedicated news role/database, local TCP authentication and /etc/newsroom/runtime.env. Existing credentials were not rotated.',
  );
  process.exitCode = 1;
}
