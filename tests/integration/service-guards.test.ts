import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { createDemoData } from '../../src/server/demo/fixtures';
import { getViewer } from '../../src/server/auth';
import { userIsAllowed } from '../../src/server/auth/allowed-users';
import { checkRequestLimit, RequestLimitError } from '../../src/server/request-limits';
import { reserveBudget } from '../../src/server/ai/service';
import { bootstrap } from '../../src/server/feed/bootstrap';
import {
  getItem,
  getSubscription,
  getPreferences,
  saveItem,
  saveSubscription,
  savePreferences,
} from '../../src/server/db/store';
import {
  listLocalSkillCatalog,
  getUserSkillDetails,
  enqueueUserSkillAi,
} from '../../src/server/skills/service';
import { enqueue } from '../../src/server/jobs/queue';
import { scheduleSubscriptions } from '../../src/server/jobs/scheduler';
import { buildDigest } from '../../src/server/notifications/digest';
import { PATCH as patchState } from '../../src/app/api/items/[id]/state/route';
import { POST as translate } from '../../src/app/api/items/[id]/translation/route';
import { POST as sync } from '../../src/app/api/subscriptions/[id]/sync/route';
import { DELETE as removeSubscription } from '../../src/app/api/subscriptions/[id]/route';
import { PATCH as patchSettings } from '../../src/app/api/settings/route';
import { api } from '../../src/server/http';
import { POST as addSource } from '../../src/app/api/subscriptions/route';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const secret = 'isolated-real-session-test-secret-long-enough';
const users = Array.from({ length: 3 }, (_, i) => ({
  id: `guard-${randomUUID()}`,
  accountId: `${810001 + i}`,
  token: randomUUID(),
}));
const [a, b, denied] = users;
const origin = 'http://127.0.0.1:3000';
function request(user: typeof a | null, path = '/api/feed', method = 'GET', data?: unknown) {
  const signature = user ? createHmac('sha256', secret).update(user.token).digest('base64') : '';
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(user
        ? {
            Cookie: `better-auth.session_token=${encodeURIComponent(`${user.token}.${signature}`)}`,
          }
        : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
beforeAll(async () => {
  for (const [key, value] of Object.entries({
    APP_MODE: 'live',
    APP_URL: origin,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: secret,
    GITHUB_CLIENT_ID: 'isolated-client',
    GITHUB_CLIENT_SECRET: 'isolated-secret',
    GITHUB_READ_TOKEN: '',
    ALLOWED_GITHUB_USER_IDS: `${a.accountId},${b.accountId}`,
    YOUTUBE_CLIENT_ID: '',
    YOUTUBE_CLIENT_SECRET: '',
    YOUTUBE_API_KEY: '',
    LLM_ENABLED: 'false',
    LOCAL_SKILLS_ENABLED: 'auto',
    API_EXTERNAL_LIMIT_PER_MINUTE: '3',
  }))
    vi.stubEnv(key, value);
  await migrate();
  for (const u of users) {
    await getPool().query('INSERT INTO app_users(id,name) VALUES($1,$1)', [u.id]);
    await getPool().query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',
      [u.id, `${u.id}@example.test`],
    );
    await getPool().query(
      'INSERT INTO account(id,"userId","accountId","providerId","createdAt","updatedAt") VALUES($1,$1,$2,\'github\',now(),now())',
      [u.id, u.accountId],
    );
    await getPool().query(
      'INSERT INTO session(id,"userId",token,"expiresAt","createdAt","updatedAt") VALUES($1,$1,$2,now()+interval \'1 hour\',now(),now())',
      [u.id, u.token],
    );
    const template = createDemoData();
    await saveSubscription(u.id, {
      ...template.subscriptions[0],
      id: `${u.id}-source`,
      externalId: u.id,
      enabled: true,
      demo: false,
    });
    await saveItem(u.id, {
      ...template.items[0],
      id: `${u.id}-item`,
      sourceId: `${u.id}-source`,
      sourceIds: [`${u.id}-source`],
      externalId: u.id,
      title: u.id,
      body: `Private fixture for ${u.id}`,
      demo: false,
      summary: null,
      translation: null,
      read: false,
      saved: false,
      publishedAt: new Date().toISOString(),
      backfill: false,
    });
    await savePreferences(u.id, { compact: u.id === b.id, timezone: 'UTC' });
  }
});
afterAll(async () => {
  for (const u of users) {
    for (const table of [
      'notification_items',
      'notifications',
      'jobs',
      'ai_usage',
      'items',
      'subscriptions',
      'preferences',
      'star_sync',
    ])
      await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [u.id]);
    await getPool().query('DELETE FROM system_state WHERE key LIKE $1', [`%${u.id}%`]);
    await getPool().query('DELETE FROM "user" WHERE id=$1', [u.id]);
    await getPool().query('DELETE FROM app_users WHERE id=$1', [u.id]);
  }
  vi.unstubAllEnvs();
  await getPool().end();
});

it('authenticates two independent signed sessions and rejects anonymous or non-admitted accounts', async () => {
  expect((await getViewer(request(a).headers)).id).toBe(a.id);
  expect((await getViewer(request(b).headers)).id).toBe(b.id);
  await expect(getViewer(request(null).headers)).rejects.toMatchObject({ status: 401 });
  await expect(getViewer(request(denied).headers)).rejects.toMatchObject({ status: 403 });
  const unsigned = request(null).headers;
  unsigned.set('Cookie', `better-auth.session_token=${a.token}.bad-signature`);
  await expect(getViewer(unsigned)).rejects.toMatchObject({ status: 401 });
});

it('denies foreign item reads, mutations, AI work, subscription sync and deletion through real handlers', async () => {
  expect(await getItem(b.id, `${a.id}-item`)).toBeNull();
  expect(await getSubscription(b.id, `${a.id}-source`)).toBeNull();
  const changed = await patchState(
    request(b, `/api/items/${a.id}-item/state`, 'PATCH', { read: true, saved: true }),
    context(`${a.id}-item`),
  );
  expect(changed.status).toBe(404);
  expect(changed.headers.get('Cache-Control')).toBe('no-store');
  expect(
    (
      await translate(
        request(b, `/api/items/${a.id}-item/translation`, 'POST'),
        context(`${a.id}-item`),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await sync(
        request(b, `/api/subscriptions/${a.id}-source/sync`, 'POST'),
        context(`${a.id}-source`),
      )
    ).status,
  ).toBe(404);
  await removeSubscription(
    request(b, `/api/subscriptions/${a.id}-source`, 'DELETE'),
    context(`${a.id}-source`),
  );
  expect(await getSubscription(a.id, `${a.id}-source`)).not.toBeNull();
  expect(await getItem(a.id, `${a.id}-item`)).toMatchObject({ read: false, saved: false });
  expect((await getPool().query('SELECT 1 FROM jobs WHERE user_id=$1', [b.id])).rowCount).toBe(0);
});

it('isolates bootstrap, notifications, jobs, preferences and own mutations', async () => {
  const ownPatch = await patchState(
    request(b, `/api/items/${b.id}-item/state`, 'PATCH', { saved: true }),
    context(`${b.id}-item`),
  );
  expect(ownPatch.status).toBe(200);
  await enqueue(a.id, 'translation', `${a.id}-item`);
  await buildDigest(a.id);
  await buildDigest(b.id);
  const data = await bootstrap({ id: b.id, name: 'fixture-b' });
  expect(data.items.map((i) => i.id)).toEqual([`${b.id}-item`]);
  expect(data.subscriptions.map((s) => s.id)).toEqual([`${b.id}-source`]);
  expect(data.notifications.every((n) => !JSON.stringify(n).includes(a.id))).toBe(true);
  expect(data.jobs).toHaveLength(0);
  expect(JSON.stringify(data)).not.toContain(a.id);
  expect(
    (
      await patchSettings(
        request(b, '/api/settings', 'PATCH', { compact: false, timezone: 'Asia/Shanghai' }),
      )
    ).status,
  ).toBe(200);
  expect(await getPreferences(a.id)).toEqual({ compact: false, timezone: 'UTC' });
  expect(await getPreferences(b.id)).toEqual({ compact: false, timezone: 'Asia/Shanghai' });
  const evil = request(b, '/api/settings', 'PATCH', { compact: true, timezone: 'UTC' });
  evil.headers.set('Origin', 'https://foreign.invalid');
  expect((await patchSettings(evil)).status).toBe(403);
});

it('atomically limits concurrent external work per user without blocking independent reading or other users', async () => {
  await getPool().query('DELETE FROM request_limits WHERE user_id=ANY($1::text[])', [[a.id, b.id]]);
  const heavy = (u: typeof a) => request(u, '/api/github/following/preview', 'POST');
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => checkRequestLimit(a.id, heavy(a))),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  expect(
    results.filter((r) => r.status === 'rejected' && r.reason instanceof RequestLimitError),
  ).toHaveLength(9);
  await expect(checkRequestLimit(b.id, heavy(b))).resolves.toBeUndefined();
  await expect(checkRequestLimit(a.id, request(a))).resolves.toBeUndefined();
  const blocked = await api(heavy(a), async () => ({ ok: true }));
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(blocked.headers.get('Cache-Control')).toBe('no-store');
  const external = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('External requests must not run after the limit'));
  try {
    const add = await addSource(
      request(a, '/api/subscriptions', 'POST', {
        platform: 'github',
        kind: 'repo',
        input: 'fixture/project',
      }),
    );
    expect(add.status).toBe(429);
    expect(external).not.toHaveBeenCalled();
    expect(
      (
        await patchState(
          request(a, `/api/items/${a.id}-item/state`, 'PATCH', { saved: true }),
          context(`${a.id}-item`),
        )
      ).status,
    ).toBe(200);
  } finally {
    external.mockRestore();
  }
  await getPool().query(
    "UPDATE request_limits SET reset_at=now()-interval '1 second' WHERE user_id=$1",
    [a.id],
  );
  await expect(checkRequestLimit(a.id, heavy(a))).resolves.toBeUndefined();
});

it('stops removed users in admission and future background scheduling', async () => {
  expect(await userIsAllowed(a.id)).toBe(true);
  vi.stubEnv('ALLOWED_GITHUB_USER_IDS', b.accountId);
  try {
    expect(await userIsAllowed(a.id)).toBe(false);
    await expect(getViewer(request(a).headers)).rejects.toMatchObject({ status: 403 });
    await scheduleSubscriptions();
    expect(
      (await getPool().query("SELECT 1 FROM jobs WHERE user_id=$1 AND kind='sync'", [a.id]))
        .rowCount,
    ).toBe(0);
    expect(
      (await getPool().query("SELECT 1 FROM jobs WHERE user_id=$1 AND kind='sync'", [b.id]))
        .rowCount,
    ).toBe(1);
    expect(
      (await getPool().query("SELECT 1 FROM jobs WHERE user_id=$1 AND kind='sync'", [denied.id]))
        .rowCount,
    ).toBe(0);
  } finally {
    vi.stubEnv('ALLOWED_GITHUB_USER_IDS', `${a.accountId},${b.accountId}`);
  }
});

it('blocks server-local listing, detail and AI paths even when the UI is bypassed', async () => {
  vi.stubEnv('APP_URL', 'https://trial.example.test');
  try {
    await expect(listLocalSkillCatalog()).rejects.toMatchObject({ status: 403 });
    await expect(getUserSkillDetails(a.id, 'local:any-fixture')).rejects.toMatchObject({
      status: 403,
    });
    await expect(enqueueUserSkillAi(a.id, 'local:any-fixture', 'summary')).rejects.toMatchObject({
      status: 403,
    });
    expect((await bootstrap({ id: a.id, name: 'fixture-a' }, true)).services.localSkills).toBe(
      false,
    );
  } finally {
    vi.stubEnv('APP_URL', origin);
  }
});

it('serializes site-wide AI reservations across different users, including uncertain charges', async () => {
  vi.stubEnv('LLM_GLOBAL_DAILY_BUDGET_USD', '0.3');
  vi.stubEnv('LLM_GLOBAL_MONTHLY_BUDGET_USD', '0.3');
  const future = new Date('2099-01-02T00:00:00Z');
  const outcomes = await Promise.allSettled([
    reserveBudget(a.id, 0.2, future),
    reserveBudget(b.id, 0.2, future),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  const failed = outcomes.find((o) => o.status === 'rejected');
  expect(failed).toMatchObject({
    status: 'rejected',
    reason: { message: expect.stringContaining('本站 AI') },
  });
  await getPool().query("UPDATE ai_usage SET status='uncertain' WHERE user_id=ANY($1::text[])", [
    [a.id, b.id],
  ]);
  vi.stubEnv('LLM_GLOBAL_DAILY_BUDGET_USD', '5');
  await expect(reserveBudget(b.id, 0.2, new Date('2099-01-03T00:00:00Z'))).rejects.toThrow(
    '本站 AI',
  );
});
