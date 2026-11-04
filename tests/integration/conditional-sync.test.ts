import { beforeAll, beforeEach, afterEach, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { getItems, patchItemState, getSubscription } from '../../src/server/db/store';
import { GitHubConnector } from '../../src/server/connectors/github';
import { persistSubscription, syncSubscription } from '../../src/server/subscriptions/service';
let userId: string;
const future = new Date(Date.now() + 86400000).toISOString();
const release = (id: number, body = 'Initial notes', published = future) => ({
  id,
  name: `v${id}`,
  tag_name: `v${id}`,
  body,
  html_url: `https://github.com/test/repo/releases/${id}`,
  draft: false,
  prerelease: false,
  published_at: published,
  created_at: published,
});
beforeAll(async () => {
  process.env.APP_MODE = 'demo';
  process.env.LLM_ENABLED = 'false';
  await migrate();
});
beforeEach(async () => {
  userId = `conditional-${randomUUID()}`;
  await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$2)', [
    userId,
    'conditional test',
  ]);
});
afterEach(async () => {
  for (const table of ['jobs', 'items', 'subscriptions'])
    await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [userId]);
  await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`%${userId}%`]);
  await getPool().query('DELETE FROM app_users WHERE id=$1', [userId]);
});
afterAll(async () => {
  await getPool().end();
});
async function subscription(kind: 'repo' | 'author' = 'repo') {
  return (await persistSubscription(userId, kind, {
    externalId: '10',
    name: kind === 'repo' ? 'test/repo' : 'test',
    description: '',
    url: 'https://github.com/test',
  }))!.subscription;
}
it('continues after a first-page 304 and captures second-page edits without changing read state', async () => {
  const sub = await subscription();
  let edited = false;
  const pages: number[] = [];
  const connector = new GitHubConnector(async (path, etag) => {
    const page = Number(new URL(`https://fixture.invalid${path}`).searchParams.get('page'));
    pages.push(page);
    if (page === 1 && etag) return { data: null, hasNext: false, notModified: true, etag };
    return {
      data: [release(page, edited && page === 2 ? 'Edited second page' : 'Initial notes')],
      hasNext: page === 1,
      etag: page === 1 ? 'first' : edited ? 'second-new' : 'second-old',
    };
  });
  await syncSubscription(userId, sub.id, connector);
  const second = (await getItems(userId)).find((item) => item.externalId === '2')!;
  await patchItemState(userId, second.id, { read: true, saved: true, muted: true });
  edited = true;
  pages.length = 0;
  await syncSubscription(userId, sub.id, connector);
  expect(pages).toEqual([1, 2]);
  expect((await getItems(userId)).find((item) => item.id === second.id)).toMatchObject({
    body: 'Edited second page',
    read: true,
    saved: true,
    muted: true,
  });
});
it('probes beyond an unchanged full terminal page when older releases extend pagination', async () => {
  const sub = await subscription();
  let expanded = false;
  const pages: number[] = [];
  const connector = new GitHubConnector(async (path, etag) => {
    const page = Number(new URL(`https://fixture.invalid${path}`).searchParams.get('page'));
    pages.push(page);
    if (page === 1 && etag) return { data: null, hasNext: false, notModified: true, etag };
    return {
      data:
        page === 1
          ? Array.from({ length: 100 }, (_, index) => release(index + 1))
          : expanded
            ? [release(101)]
            : [],
      hasNext: false,
      etag: `page-${page}`,
    };
  });
  await syncSubscription(userId, sub.id, connector);
  expanded = true;
  pages.length = 0;
  await syncSubscription(userId, sub.id, connector);
  expect(pages).toEqual([1, 2]);
  expect(await getItems(userId)).toHaveLength(101);
  expect(await getSubscription(userId, sub.id)).toMatchObject({
    coverage: 'complete',
    error: null,
  });
});
it('retains history cap contributions from unchanged pages', async () => {
  const sub = await subscription();
  let expanded = false;
  const historical = new Date(Date.now() - 3600000).toISOString();
  const connector = new GitHubConnector(async (path, etag) => {
    const page = Number(new URL(`https://fixture.invalid${path}`).searchParams.get('page'));
    if (page === 1 && etag) return { data: null, hasNext: false, notModified: true, etag };
    return {
      data:
        page === 1
          ? Array.from({ length: 20 }, (_, index) => release(index + 1, 'history', historical))
          : expanded
            ? [release(21, 'more history', historical)]
            : [],
      hasNext: page === 1,
      etag: expanded && page === 2 ? 'changed' : `page-${page}`,
    };
  });
  await syncSubscription(userId, sub.id, connector);
  expanded = true;
  await syncSubscription(userId, sub.id, connector);
  expect(await getItems(userId)).toHaveLength(20);
});
it('does not let a repository-list ETag hide author README changes', async () => {
  const sub = await subscription('author');
  let body = 'First README';
  const headers: (string | undefined)[] = [];
  const connector = new GitHubConnector(async (path, etag) => {
    if (path.includes('/repos?')) {
      headers.push(etag);
      return {
        data: [
          {
            id: 20,
            name: 'repo',
            full_name: 'test/repo',
            description: '',
            html_url: 'https://github.com/test/repo',
            created_at: future,
            fork: false,
            private: false,
            owner: { id: 10, login: 'test' },
          },
        ],
        hasNext: false,
        etag: 'repository-list',
      };
    }
    if (path.endsWith('/readme'))
      return {
        data: { encoding: 'base64', content: Buffer.from(body).toString('base64') },
        hasNext: false,
      };
    if (path.includes('/events/public?')) return { data: [], hasNext: false };
    throw new Error('Unexpected request');
  });
  await syncSubscription(userId, sub.id, connector);
  await patchItemState(userId, (await getItems(userId))[0].id, { read: true, saved: true });
  body = 'Edited README';
  await syncSubscription(userId, sub.id, connector);
  expect(headers).toEqual([undefined, undefined]);
  expect((await getItems(userId))[0]).toMatchObject({ body, read: true, saved: true });
});
it('clears an old validator when a fresh 200 response has no ETag', async () => {
  const sub = await subscription();
  const headers: (string | undefined)[] = [];
  const connector = new GitHubConnector(async (_path, etag) => {
    headers.push(etag);
    return { data: [release(1)], hasNext: false, ...(headers.length === 1 ? { etag: 'old' } : {}) };
  });
  await syncSubscription(userId, sub.id, connector);
  await syncSubscription(userId, sub.id, connector);
  await syncSubscription(userId, sub.id, connector);
  expect(headers).toEqual([undefined, 'old', undefined]);
});
it('persists visible page progress and resumes after the five-page work budget', async () => {
  const sub = await subscription();
  const pages: number[] = [];
  const connector = new GitHubConnector(async (path) => {
    const page = Number(new URL(`https://fixture.invalid${path}`).searchParams.get('page'));
    pages.push(page);
    return { data: [release(page)], hasNext: page < 6, etag: `page-${page}` };
  });
  await syncSubscription(userId, sub.id, connector);
  expect(await getSubscription(userId, sub.id)).toMatchObject({
    coverage: 'partial',
    lastSyncAt: null,
    syncProgress: { stream: 'repositories', page: 5, nextPage: 6 },
  });
  pages.length = 0;
  await syncSubscription(userId, sub.id, connector);
  expect(pages).toEqual([6]);
  expect(await getSubscription(userId, sub.id)).toMatchObject({
    coverage: 'complete',
    syncProgress: { page: 6, nextPage: null },
  });
  expect(await getItems(userId)).toHaveLength(6);
});
it('keeps unfinished author repository progress visible after the events stream completes', async () => {
  const sub = await subscription('author');
  const connector = new GitHubConnector(async (path) => {
    if (path.includes('/events/public?')) return { data: [], hasNext: false };
    if (path.endsWith('/readme'))
      return {
        data: { encoding: 'base64', content: Buffer.from('README').toString('base64') },
        hasNext: false,
      };
    const page = Number(new URL(`https://fixture.invalid${path}`).searchParams.get('page'));
    return {
      data: [
        {
          id: 20 + page,
          name: `repo-${page}`,
          full_name: `test/repo-${page}`,
          description: '',
          html_url: `https://github.com/test/repo-${page}`,
          created_at: future,
          fork: false,
          private: false,
          owner: { id: 10, login: 'test' },
        },
      ],
      hasNext: page < 6,
    };
  });
  await syncSubscription(userId, sub.id, connector);
  expect(await getSubscription(userId, sub.id)).toMatchObject({
    coverage: 'partial',
    syncProgress: { stream: 'repositories', page: 5, nextPage: 6 },
  });
  await syncSubscription(userId, sub.id, connector);
  expect(await getSubscription(userId, sub.id)).toMatchObject({
    coverage: 'complete',
    syncProgress: { nextPage: null },
  });
});
