import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  assertDrillTarget,
  localDatabaseTarget,
  diagnosticErrorCode,
  cleanupMaintenanceResources,
} from './lib/database-safety';

const root = fileURLToPath(new URL('../', import.meta.url));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
  });

function docker(args: string[], label: string) {
  return new Promise<string>((resolve, reject) => {
    const cleanup = label.startsWith('清理');
    if (stopping && !cleanup) {
      reject(new Error('维护已取消。'));
      return;
    }
    const child = spawn('docker', args, {
      cwd: root,
      windowsHide: true,
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    // Raw CLI errors may include connection details. Only the fixed operation label leaves this script.
    child.stderr.resume();
    child.once('error', () => reject(new Error(`${label}失败。`)));
    child.once('close', (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(`${label}失败。`)),
    );
  });
}

async function snapshot(client: Client) {
  const tables = (
    await client.query<{ schemaname: string; tablename: string }>(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','pgboss') ORDER BY schemaname,tablename",
    )
  ).rows;
  const counts: Record<string, number> = {};
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  for (const table of tables) {
    const key = `${table.schemaname}.${table.tablename}`;
    counts[key] = Number(
      (
        await client.query(
          `SELECT count(*) AS n FROM ${quote(table.schemaname)}.${quote(table.tablename)}`,
        )
      ).rows[0].n,
    );
  }
  const migrations: string[] = (
    await client.query('SELECT name FROM app_migrations ORDER BY name')
  ).rows.map((row) => row.name);
  const states = (
    await client.query(`SELECT count(*) FILTER (WHERE read)::int AS read,
    count(*) FILTER (WHERE saved)::int AS saved, count(*) FILTER (WHERE muted)::int AS muted,
    md5(coalesce(string_agg(concat_ws(':',id,user_id,read::text,saved::text,muted::text),'|' ORDER BY id),'')) AS fingerprint
    FROM items`)
  ).rows[0];
  const orphans = Number(
    (
      await client.query(
        'SELECT count(*) AS n FROM items i LEFT JOIN app_users u ON u.id=i.user_id WHERE u.id IS NULL',
      )
    ).rows[0].n,
  );
  return { counts, migrations, states, orphans };
}

async function maintenance(mode: string) {
  if (!['backup', 'drill'].includes(mode)) throw new Error('用法：pnpm db:backup 或 pnpm db:drill');
  const source = localDatabaseTarget(process.env.DATABASE_URL);
  const container = await docker(['compose', 'ps', '-q', 'db'], '查找数据库容器');
  if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error('未找到唯一运行中的数据库容器。');
  const binding = await docker(['compose', 'port', 'db', '5432'], '检查数据库端口');
  if (!binding.split(/\r?\n/).some((line) => line.endsWith(`:${source.port}`)))
    throw new Error('DATABASE_URL 端口与 Compose 不符，拒绝备份其他实例。');
  const client = new Client({
    connectionString: source.url.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 120000,
  });
  client.on('error', () => {});
  const suffix =
    new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '_' + randomUUID().slice(0, 8);
  const target = `news_restore_drill_${suffix}`;
  assertDrillTarget(source.database, target);
  const containerFile = `/tmp/${target}.dump`;
  const backup = resolve(root, 'work', 'backups', `${source.database}-${suffix}.dump`);
  let created = false;
  let transaction = false;
  let failure: unknown;
  let report: Record<string, unknown> | undefined;
  try {
    await client.connect();
    const identity = String(
      (await client.query('SELECT system_identifier FROM pg_control_system()')).rows[0]
        .system_identifier,
    );
    const dockerIdentity = await docker(
      [
        'exec',
        container,
        'psql',
        '-U',
        source.username,
        '-d',
        source.database,
        '-Atc',
        'SELECT system_identifier FROM pg_control_system()',
      ],
      '验证数据库实例',
    );
    if (identity !== dockerIdentity) throw new Error('数据库实例不一致，维护已停止。');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transaction = true;
    const snapshotId = String((await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id);
    const expected = await snapshot(client);
    await mkdir(resolve(root, 'work', 'backups'), { recursive: true });
    await docker(
      [
        'exec',
        container,
        'pg_dump',
        '-U',
        source.username,
        '-d',
        source.database,
        '-Fc',
        '--snapshot',
        snapshotId,
        '-f',
        containerFile,
      ],
      '导出一致性快照',
    );
    await client.query('COMMIT');
    transaction = false;
    await docker(['cp', `${container}:${containerFile}`, backup], '复制备份');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(backup)) hash.update(chunk);
    report = {
      createdAt: new Date().toISOString(),
      sourceDatabase: source.database,
      bytes: (await stat(backup)).size,
      sha256: hash.digest('hex'),
      expected,
      restored: false,
      cleanup: 'pending',
    };
    // Save the manifest before restore so even a failed drill retains a verifiable backup.
    await writeFile(`${backup}.json`, JSON.stringify(report, null, 2));
    if (mode === 'drill') {
      if ((await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [target])).rowCount)
        throw new Error('生成的演练库名称已存在，拒绝操作。');
      // Register cleanup before dispatch: a failed CLI may still have created the database.
      created = true;
      await docker(
        ['exec', container, 'createdb', '-U', source.username, '-T', 'template0', target],
        '创建隔离恢复库',
      );
      await docker(
        [
          'exec',
          container,
          'pg_restore',
          '-U',
          source.username,
          '-d',
          target,
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          containerFile,
        ],
        '恢复隔离库',
      );
      const restoredUrl = new URL(source.url);
      restoredUrl.pathname = `/${target}`;
      const restored = new Client({
        connectionString: restoredUrl.toString(),
        connectionTimeoutMillis: 5000,
        statement_timeout: 120000,
      });
      restored.on('error', () => {});
      try {
        await restored.connect();
        const actual = await snapshot(restored);
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error('恢复校验不一致，演练未通过。');
        report.restored = true;
      } finally {
        await restored.end();
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    if (transaction) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
    const cleaned = await cleanupMaintenanceResources(
      created
        ? async () => {
            assertDrillTarget(source.database, target);
            await docker(
              [
                'exec',
                container,
                'dropdb',
                '-U',
                source.username,
                '--if-exists',
                '--force',
                target,
              ],
              '清理隔离恢复库',
            );
          }
        : undefined,
      () => docker(['exec', container, 'rm', '-f', '--', containerFile], '清理容器临时备份'),
    );
    if (report) report.cleanup = cleaned ? 'complete' : 'failed';
    if (!cleaned) failure ??= new Error('临时资源清理未完成。');
    if (report) await writeFile(`${backup}.json`, JSON.stringify(report, null, 2));
  }
  if (failure) throw failure;
  if (stopping) throw new Error('维护已取消。');
  return { backup, manifest: `${backup}.json`, ...report };
}

maintenance(process.argv[2] || '')
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => {
    // Do not print driver messages/stack, URLs, account rows or external process stderr.
    console.error(
      `数据库维护未完成（${diagnosticErrorCode(error)}）。请检查 Docker、数据库权限与隔离库；未覆盖源库。`,
    );
    process.exitCode = 1;
  });
