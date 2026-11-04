import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../src/server/db/client';

afterAll(() => getPool().end());
it('upgrades the original subscription constraint without changing old identities or reading state', async () => {
  const client = await getPool().connect();
  const schema = `migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(
      'CREATE TABLE subscriptions(id text PRIMARY KEY,user_id text,kind text,external_id text,data jsonb,UNIQUE(user_id,kind,external_id))',
    );
    await client.query(
      'CREATE TABLE items(id text PRIMARY KEY,external_key text,data jsonb,read boolean,saved boolean)',
    );
    await client.query(
      "INSERT INTO subscriptions VALUES('source-one','user-one','repo','123',$1)",
      [{ id: 'source-one', name: 'old/repo' }],
    );
    await client.query("INSERT INTO items VALUES('stable-item','release:456',$1,true,true)", [
      { id: 'stable-item', sourceId: 'source-one', summary: { overview: 'cached summary' } },
    ]);
    await client.query(
      await readFile(new URL('../../drizzle/0005_platform_sources.sql', import.meta.url), 'utf8'),
    );
    expect((await client.query('SELECT * FROM items')).rows[0]).toMatchObject({
      id: 'stable-item',
      external_key: 'release:456',
      read: true,
      saved: true,
      data: { platform: 'github', summary: { overview: 'cached summary' } },
    });
    expect((await client.query('SELECT * FROM subscriptions')).rows[0]).toMatchObject({
      platform: 'github',
      data: { id: 'source-one', platform: 'github' },
    });
    // Database uniqueness must not confuse the same provider-local identity on two platforms.
    await client.query(
      "INSERT INTO subscriptions(id,user_id,kind,external_id,data,platform) VALUES('source-two','user-one','repo','123','{}','youtube')",
    );
    expect((await client.query('SELECT count(*) FROM subscriptions')).rows[0].count).toBe('2');
    await expect(
      client.query(
        "INSERT INTO subscriptions(id,user_id,kind,external_id,data,platform) VALUES('duplicate','user-one','repo','123','{}','github')",
      ),
    ).rejects.toMatchObject({ code: '23505' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
