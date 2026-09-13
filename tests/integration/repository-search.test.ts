import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { GitHubConnector } from '../../src/server/connectors/github';
import { searchRepositories } from '../../src/server/subscriptions/search';
import { persistSubscription } from '../../src/server/subscriptions/service';
const user = `search-${randomUUID()}`;
const other = `search-${randomUUID()}`;
beforeAll(async () => {
  await migrate();
  for (const id of [user, other])
    await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [id]);
});
afterAll(async () => {
  for (const id of [user, other]) {
    for (const table of ['jobs', 'subscriptions', 'app_users'])
      await getPool().query(
        `DELETE FROM ${table} WHERE ${table === 'app_users' ? 'id' : 'user_id'}=$1`,
        [id],
      );
  }
  await getPool().end();
});
it('search is read-only and existing subscription labels are scoped to the current user', async () => {
  const connector = new GitHubConnector(async () => ({
    hasNext: false,
    data: {
      total_count: 1,
      incomplete_results: false,
      items: [
        {
          id: 987,
          name: 'tool',
          full_name: 'owner/tool',
          description: null,
          html_url: 'https://github.com/owner/tool',
          created_at: new Date().toISOString(),
          fork: false,
          private: false,
          owner: { id: 1, login: 'owner' },
          stargazers_count: 30,
          language: null,
          updated_at: new Date().toISOString(),
          archived: false,
        },
      ],
    },
  }));
  const input = { query: 'tool' };
  expect((await searchRepositories(user, input, connector)).repositories[0].subscribed).toBe(false);
  expect((await getPool().query('SELECT id FROM jobs WHERE user_id=$1', [user])).rowCount).toBe(0);
  await persistSubscription(user, 'repo', {
    externalId: '987',
    name: 'owner/tool',
    description: '',
    url: 'https://github.com/owner/tool',
  });
  expect((await searchRepositories(user, input, connector)).repositories[0].subscribed).toBe(true);
  expect((await searchRepositories(other, input, connector)).repositories[0].subscribed).toBe(
    false,
  );
});
