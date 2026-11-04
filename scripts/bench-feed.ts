import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { benchmark } from './benchmarks/statistics';
import { getPool } from '../src/server/db/client';
import { migrate } from './migrate';
import { getFeedPage, getFeedStatus } from '../src/server/db/store';
import { createDemoData } from '../src/server/demo/fixtures';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://news:news_local_only@127.0.0.1:54329/news_test';
process.env.APP_MODE = 'demo';
process.env.LLM_ENABLED = 'false';
if (!/^[a-z0-9_]+_test$/.test(new URL(process.env.DATABASE_URL).pathname.slice(1)))
  throw new Error('Benchmark requires a _test database');
const userId = `bench-${randomUUID()}`;
const rowCount = 10000;
const filters = { view: 'feed', type: 'all', search: '', unread: false, source: '' };
const pool = getPool();
const measure = benchmark;
try {
  await migrate();
  await pool.query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'isolated benchmark']);
  await pool.query(
    `INSERT INTO items(id,user_id,source_id,external_key,published_at,data,read,saved)
    SELECT $1||'-'||lpad(g::text,6,'0'), $1, 'bench-source', 'release:'||g,
      '2026-11-04T00:00:00Z'::timestamptz - (g/10)*interval '1 second',
      $2::jsonb || jsonb_build_object('id',$1||'-'||lpad(g::text,6,'0'),'sourceId','bench-source',
      'sourceIds',jsonb_build_array('bench-source'),'externalId',g::text,
      'title',CASE WHEN g%10=0 THEN 'needle mixed update ' ELSE 'mixed update ' END||g,
      'platform',CASE WHEN g%3=0 THEN 'youtube' ELSE 'github' END,
      'type',CASE WHEN g%3=0 THEN 'video' WHEN g%3=1 THEN 'release' ELSE 'new_repo' END,
      'description',CASE WHEN g%7=0 THEN repeat('Mixed long description ',50) ELSE 'Public fixture update' END,
      'publishedAt',to_char('2026-11-04T00:00:00Z'::timestamptz - (g/10)*interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'body',notes,'translation',reverse(notes)), g%3=0,g%5=0
    FROM generate_series(1,$3::int) g CROSS JOIN LATERAL
      (SELECT string_agg(md5(g::text||':'||n::text),'') AS notes FROM generate_series(1,128) n) bodies`,
    [userId, JSON.stringify(createDemoData().items[0]), rowCount],
  );
  await pool.query('ANALYZE items');
  const page = await getFeedPage(userId, filters);
  const full = await pool.query(
    'SELECT data FROM items WHERE user_id=$1 ORDER BY published_at DESC,id DESC LIMIT 30',
    [userId],
  );
  const explain = await pool.query(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,published_at FROM items
    WHERE user_id=$1 AND NOT muted ORDER BY published_at DESC,id DESC LIMIT 31`,
    [userId],
  );
  const searchExplain = await pool.query(
    `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*) FROM items WHERE user_id=$1 AND NOT muted AND search_text ILIKE '%needle%'`,
    [userId],
  );
  const report = {
    schemaVersion: 2,
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      memoryGiB: Number((totalmem() / 1024 ** 3).toFixed(1)),
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
      }).trim(),
    },
    method: {
      samplesPerRound: 30,
      rounds: 3,
      warmupPerRound: 2,
      cache: 'warm; PostgreSQL buffers not reset',
      scope: 'store functions, not HTTP/browser latency',
      failures: 'abort and fail report',
    },
    rowCount,
    pageSize: page.items.length,
    previewBytes: Buffer.byteLength(JSON.stringify(page)),
    fullPageBytes: Buffer.byteLength(JSON.stringify(full.rows.map((row) => row.data))),
    firstPage: await measure(() => getFeedPage(userId, filters)),
    nextPage: await measure(() => getFeedPage(userId, { ...filters, cursor: page.nextCursor })),
    savedUnread: await measure(() =>
      getFeedPage(userId, { ...filters, view: 'saved', unread: true }),
    ),
    search: await measure(() => getFeedPage(userId, { ...filters, search: 'needle' })),
    status: await measure(() => getFeedStatus(userId, filters)),
    plan: explain.rows[0]['QUERY PLAN'],
    searchPlan: searchExplain.rows[0]['QUERY PLAN'],
    appliedMigrations: (await pool.query('SELECT name FROM app_migrations ORDER BY name')).rows.map(
      (row) => row.name,
    ),
  };
  await mkdir('work', { recursive: true });
  const name = process.argv.includes('--baseline')
    ? 'work/feed-benchmark-baseline.json'
    : 'work/feed-benchmark.json';
  await writeFile(name, JSON.stringify(report, null, 2));
  const timings = Object.fromEntries(
    ['firstPage', 'nextPage', 'savedUnread', 'search', 'status'].map((key) => {
      const value = report[key as keyof typeof report] as Awaited<ReturnType<typeof measure>>;
      return [
        key,
        { sampleCount: value.sampleCount, medianMs: value.medianMs, p95Ms: value.p95Ms },
      ];
    }),
  );
  console.log(
    JSON.stringify({ rowCount, previewBytes: report.previewBytes, ...timings, report: name }),
  );
} finally {
  await pool.query('DELETE FROM items WHERE user_id=$1', [userId]);
  await pool.query('DELETE FROM app_users WHERE id=$1', [userId]);
  await pool.end();
}
