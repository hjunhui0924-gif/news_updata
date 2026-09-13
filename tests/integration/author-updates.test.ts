import { beforeAll, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { GitHubConnector, GitHubError } from '../../src/server/connectors/github';
import {
  persistSubscription,
  syncSubscription,
  deleteSubscription,
  updateSubscription,
} from '../../src/server/subscriptions/service';
import { getItems, getItem, getSubscription, patchItemState } from '../../src/server/db/store';
import { bootstrap } from '../../src/server/feed/bootstrap';
import { filterItems } from '../../src/shared/feed';

let userId: string;
const now = new Date().toISOString();
beforeAll(async () => {
  for (const [key, value] of Object.entries({
    APP_MODE: 'demo',
    LLM_ENABLED: 'true',
    LLM_MODEL: 'test',
    LLM_API_KEY: 'test-only',
    LLM_API_BASE_URL: 'https://fixture.invalid/v1',
    LLM_INPUT_USD_PER_MILLION: '1',
    LLM_OUTPUT_USD_PER_MILLION: '1',
  }))
    vi.stubEnv(key, value);
  await migrate();
});
beforeEach(async () => {
  userId = `test-author-${randomUUID()}`;
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [userId, 'author test']);
});
afterEach(async () => {
  for (const table of [
    'jobs',
    'items',
    'subscriptions',
    'star_sync_exclusions',
    'star_sync',
    'preferences',
  ])
    await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`%${userId}%`]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
});
afterAll(async () => {
  await getPool().end();
  vi.unstubAllEnvs();
});

async function setup() {
  const author = (await persistSubscription(userId, 'author', {
    externalId: '10',
    name: 'alice',
    url: 'https://github.com/alice',
    description: '',
  }))!.subscription;
  const project = (await persistSubscription(userId, 'repo', {
    externalId: '20',
    name: 'org/tool',
    url: 'https://github.com/org/tool',
    description: '',
  }))!.subscription;
  const state = {
    body: 'Initial release notes.',
    updatedAt: now,
    publishedAt: now,
    eventsFail: false,
    includeNew: false,
    pages: 1,
    actor: 10,
  };
  const paths: string[] = [];
  const repo = {
    id: 20,
    name: 'tool',
    full_name: 'org/tool',
    description: null,
    html_url: 'https://github.com/org/tool',
    created_at: now,
    fork: false,
    private: false,
    owner: { id: 30, login: 'org' },
  };
  const connector = new GitHubConnector(async (path) => {
    paths.push(path);
    if (path.startsWith('/users/alice/repos?'))
      return {
        hasNext: false,
        data: state.includeNew
          ? [
              {
                ...repo,
                id: 21,
                name: 'new',
                full_name: 'alice/new',
                owner: { id: 10, login: 'alice' },
              },
            ]
          : [],
      };
    if (path === '/repos/alice/new/readme')
      return {
        hasNext: false,
        data: {
          encoding: 'base64',
          content: Buffer.from('A newly published repository.').toString('base64'),
        },
      };
    if (path.startsWith('/users/alice/events/public?')) {
      const page = Number(new URL(`https://api.github.com${path}`).searchParams.get('page'));
      if (state.eventsFail && page === 2) throw new GitHubError('event network interrupted');
      return {
        hasNext: page < state.pages,
        data:
          page < state.pages
            ? [{ type: 'PushEvent' }]
            : [
                {
                  type: 'ReleaseEvent',
                  public: true,
                  actor: { id: state.actor, login: 'alice' },
                  repo: { name: 'org/tool' },
                  payload: { action: 'published', release: { id: 100 } },
                },
              ],
      };
    }
    if (path === '/repos/org/tool') return { hasNext: false, data: repo };
    const release = {
      id: 100,
      name: 'v1',
      tag_name: 'v1',
      body: state.body,
      html_url: 'https://github.com/org/tool/releases/tag/v1',
      draft: false,
      prerelease: false,
      published_at: state.publishedAt,
      created_at: state.publishedAt,
      updated_at: state.updatedAt,
      author: { id: 99, login: 'draft-creator' },
    };
    if (path === '/repos/org/tool/releases/100') return { hasNext: false, data: release };
    if (path.startsWith('/repos/org/tool/releases?')) return { hasNext: false, data: [release] };
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  return { author, project, state, connector, paths };
}

it('merges author and project hits concurrently into one item and one AI task', async () => {
  const { author, project, connector } = await setup();
  await Promise.all([
    syncSubscription(userId, author.id, connector),
    syncSubscription(userId, project.id, connector),
  ]);
  const items = await getItems(userId);
  expect(items).toHaveLength(1);
  expect(new Set(items[0].sourceIds)).toEqual(new Set([author.id, project.id]));
  expect(
    (await getPool().query("SELECT id FROM jobs WHERE user_id=$1 AND kind='summary'", [userId]))
      .rows,
  ).toHaveLength(1);
  const filters = { view: 'feed', type: 'all', search: '', unread: false };
  expect(filterItems(items, { ...filters, source: author.id })).toHaveLength(1);
  expect(filterItems(items, { ...filters, source: project.id })).toHaveLength(1);
});

it('adding a second source preserves AI, translation, read and saved state; edits clear only stale artifacts', async () => {
  const { author, project, state, connector } = await setup();
  await syncSubscription(userId, project.id, connector);
  const [first] = await getItems(userId);
  await patchItemState(userId, first.id, { read: true, saved: true });
  await getPool().query('UPDATE items SET data=data || $2::jsonb WHERE id=$1', [
    first.id,
    JSON.stringify({
      translation: '已有译文',
      translationBlocks: [{ original: state.body, translation: '已有译文' }],
    }),
  ]);
  await syncSubscription(userId, author.id, connector);
  expect(await getItem(userId, first.id)).toMatchObject({
    read: true,
    saved: true,
    translation: '已有译文',
  });
  state.body = 'Edited release notes.';
  state.updatedAt = new Date(Date.parse(now) + 1000).toISOString();
  // Existing releases must keep receiving edits even outside the initial 30-day import range.
  state.publishedAt = new Date(Date.parse(now) - 60 * 86400000).toISOString();
  await syncSubscription(userId, project.id, connector);
  const edited = await getItem(userId, first.id);
  expect(edited).toMatchObject({
    read: true,
    saved: true,
    translation: null,
    body: state.body,
    firstSeenAt: first.firstSeenAt,
  });
  expect(edited?.translationBlocks).toBeUndefined();
  expect(new Set(edited?.sourceIds)).toEqual(new Set([author.id, project.id]));
});

it('a delayed source response cannot overwrite newer notes', async () => {
  const { author, project, state, connector } = await setup();
  state.updatedAt = new Date(Date.parse(now) + 2000).toISOString();
  state.body = 'Newer notes.';
  await syncSubscription(userId, project.id, connector);
  state.updatedAt = now;
  state.body = 'Stale snapshot notes.';
  await syncSubscription(userId, author.id, connector);
  const [item] = await getItems(userId);
  expect(item.body).toBe('Newer notes.');
  expect(item.sourceIds).toHaveLength(2);
});

it('keeps the author stream partial after an event page failure and resumes at that page', async () => {
  const { author, state, connector, paths } = await setup();
  state.pages = 2;
  state.eventsFail = true;
  state.includeNew = true;
  await expect(syncSubscription(userId, author.id, connector)).rejects.toThrow('interrupted');
  expect((await getItems(userId)).map((item) => item.type)).toEqual(['new_repo']);
  expect(await getSubscription(userId, author.id)).toMatchObject({
    coverage: 'partial',
    lastSyncAt: null,
  });
  paths.length = 0;
  state.eventsFail = false;
  await syncSubscription(userId, author.id, connector);
  expect(paths.filter((path) => path.includes('/events/public'))).toEqual([
    '/users/alice/events/public?per_page=100&page=2',
  ]);
  expect(await getItems(userId)).toHaveLength(2);
  expect(await getSubscription(userId, author.id)).toMatchObject({
    coverage: 'complete',
    error: null,
  });
});

it('tracks actor identity rather than draft creator or repo owner, and keeps project subscriptions independent', async () => {
  const { author, project, state, connector, paths } = await setup();
  state.actor = 11;
  await syncSubscription(userId, author.id, connector);
  expect(await getItems(userId)).toHaveLength(0);
  paths.length = 0;
  await syncSubscription(userId, project.id, connector);
  expect(await getItems(userId)).toHaveLength(1);
  expect(paths.some((path) => path.includes('/users/'))).toBe(false);
});

it('uses either source for priority and preserves the remaining source when one is removed', async () => {
  const { author, project, connector } = await setup();
  await syncSubscription(userId, project.id, connector);
  await syncSubscription(userId, author.id, connector);
  await updateSubscription(userId, author.id, { priority: true });
  let data = await bootstrap({ id: userId, name: 'test' });
  expect(data.items[0].priority).toBe(true);
  expect(data.items[0].matchedSources).toHaveLength(2);
  await deleteSubscription(userId, project.id);
  data = await bootstrap({ id: userId, name: 'test' });
  expect(data.items).toHaveLength(1);
  expect(data.items[0].matchedSources).toEqual([{ id: author.id, kind: 'author', name: 'alice' }]);
  expect(data.items[0].priority).toBe(true);
});

it('does not save results from an in-flight request after the author is paused', async () => {
  const { author, connector } = await setup();
  const original = connector.authorReleases.bind(connector);
  connector.authorReleases = async (...args) => {
    const result = await original(...args);
    await updateSubscription(userId, author.id, { enabled: false });
    return result;
  };
  await syncSubscription(userId, author.id, connector);
  expect(await getItems(userId)).toHaveLength(0);
});

it('repeated scans keep the historical import cap while still refreshing captured notes', async () => {
  const { project } = await setup();
  let edited = false;
  const connector = new GitHubConnector(async () => ({
    hasNext: false,
    data: Array.from({ length: 40 }, (_, index) => ({
      id: 100 + index,
      name: `v${40 - index}`,
      tag_name: `v${40 - index}`,
      body: edited ? 'Edited notes.' : 'Initial notes.',
      html_url: `https://github.com/org/tool/releases/tag/v${40 - index}`,
      draft: false,
      prerelease: false,
      published_at: new Date(Date.parse(now) - (index + 1) * 3600000).toISOString(),
      created_at: now,
      updated_at: new Date(Date.parse(now) + (edited ? 1000 : 0)).toISOString(),
    })),
  }));
  await syncSubscription(userId, project.id, connector);
  expect(await getItems(userId)).toHaveLength(20);
  edited = true;
  await syncSubscription(userId, project.id, connector);
  const items = await getItems(userId);
  expect(items).toHaveLength(20);
  expect(items.every((item) => item.body === 'Edited notes.')).toBe(true);
});

it('rolls back items and checkpoint when cancelled during a blocked checkpoint write', async () => {
  const { project, connector } = await setup();
  const key = `sync:${userId}:${project.id}`;
  const initial = { page: 1, historyCount: 0, completed: false };
  await getPool().query('INSERT INTO system_state(key,value) VALUES($1,$2)', [key, initial]);
  const blocker = await getPool().connect();
  const controller = new AbortController();
  let running: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT key FROM system_state WHERE key=$1 FOR UPDATE', [key]);
    running = syncSubscription(userId, project.id, connector, controller.signal).catch(
      (error: unknown) => error,
    );
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await getPool().query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'INSERT INTO system_state(key,value)%'",
      );
      if (result.rowCount) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
    controller.abort(new Error('checkpoint cancelled'));
    await blocker.query('ROLLBACK');
    expect(await running).toMatchObject({ message: 'checkpoint cancelled' });
    expect(await getItems(userId)).toHaveLength(0);
    expect(
      (await getPool().query('SELECT value FROM system_state WHERE key=$1', [key])).rows[0].value,
    ).toEqual(initial);
    expect(await getSubscription(userId, project.id)).toMatchObject({ lastSyncAt: null });
  } finally {
    controller.abort();
    await blocker.query('ROLLBACK');
    blocker.release();
    await running;
  }
});
