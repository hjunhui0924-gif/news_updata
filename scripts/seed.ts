import { getConfig } from '../src/server/config';
import { getPool, transaction } from '../src/server/db/client';
import { createDemoData } from '../src/server/demo/fixtures';

export async function seed() {
  if (getConfig().APP_MODE !== 'demo') throw new Error('Demo seed is disabled in live mode');
  const fixtures = createDemoData();
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO app_users(id,name) VALUES('demo','我的工作空间') ON CONFLICT DO NOTHING",
    );
    const exists = await client.query("SELECT 1 FROM system_state WHERE key='demo-seeded'");
    if (exists.rowCount) return;
    for (const sub of fixtures.subscriptions)
      await client.query(
        'INSERT INTO subscriptions(id,user_id,external_id,kind,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
        [sub.id, 'demo', sub.externalId, sub.kind, sub],
      );
    for (const item of fixtures.items)
      await client.query(
        'INSERT INTO items(id,user_id,source_id,external_key,data,published_at,read,saved) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [
          item.id,
          'demo',
          item.sourceId,
          `${item.type}:${item.externalId}`,
          item,
          item.publishedAt,
          item.read,
          item.saved,
        ],
      );
    await client.query(
      "INSERT INTO system_state(key,value) VALUES('demo-seeded','true') ON CONFLICT DO NOTHING",
    );
  });
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/seed.ts'))
  seed()
    .then(() => console.log('24 clearly marked demo updates seeded.'))
    .finally(() => getPool().end());
