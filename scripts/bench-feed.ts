import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
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
async function measure(run: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let index = 0; index < 12; index++) {
    const start = performance.now();
    await run();
    if (index > 1) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: Number(samples[4].toFixed(2)), p95Ms: Number(samples[9].toFixed(2)) };
}
try {
  await migrate();
  await pool.query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'isolated benchmark']);
  await pool.query(
    `INSERT INTO items(id,user_id,source_id,external_key,published_at,data,read,saved)
    SELECT $1||'-'||lpad(g::text,6,'0'), $1, 'bench-source', 'release:'||g,
      '2026-11-04T00:00:00Z'::timestamptz - (g/10)*interval '1 second',
      $2::jsonb || jsonb_build_object('id',$1||'-'||lpad(g::text,6,'0'),'sourceId','bench-source',
      'sourceIds',jsonb_build_array('bench-source'),'externalId',g::text,
      'title',CASE WHEN g%10=0 THEN 'needle release ' ELSE 'release ' END||g,
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
    recordedAt: new Date().toISOString(),
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
  console.log(JSON.stringify({ ...report, plan: undefined, searchPlan: undefined, report: name }));
} finally {
  await pool.query('DELETE FROM items WHERE user_id=$1', [userId]);
  await pool.query('DELETE FROM app_users WHERE id=$1', [userId]);
  await pool.end();
}
