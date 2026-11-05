import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { getConfig } from '../../src/server/config';
import { bootstrap } from '../../src/server/feed/bootstrap';
import { saveItem, getItem } from '../../src/server/db/store';
import { createDemoData } from '../../src/server/demo/fixtures';
import {
  getPersonalAiSettings,
  savePersonalAiSettings,
  resolveAiConfig,
  deletePersonalAiSettings,
  personalBaseUrls,
} from '../../src/server/ai/settings';
import { runAi, reserveBudget } from '../../src/server/ai/service';
import { testPersonalAiConnection } from '../../src/server/ai/connection-test';
import { GET, PUT, DELETE } from '../../src/app/api/settings/ai/route';
import { POST as testConnection } from '../../src/app/api/settings/ai/test/route';
import { skillAiCacheKey } from '../../src/server/skills/ai';
import { descriptionCacheKey } from '../../src/server/discovery/translation';

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
const secret = 'personal-ai-isolated-test-secret-over-32-chars';
const origin = 'http://127.0.0.1:3000';
const baseUrl = 'https://models.example.com/v1';
const users = Array.from({ length: 3 }, (_, i) => ({
  id: `personal-ai-${randomUUID()}`,
  accountId: String(930001 + i),
  token: randomUUID(),
}));
const [a, b, denied] = users;
const configuration = (key: string, revision = 0) => ({
  mode: 'personal',
  revision,
  baseUrl,
  model: 'fixture-model',
  apiKey: key,
  inputPrice: 1,
  outputPrice: 2,
  dailyBudget: 0.5,
  monthlyBudget: 5,
});
function request(
  user: typeof a | null,
  method = 'GET',
  body?: unknown,
  path = '/api/settings/ai',
  source = origin,
) {
  const signature = user ? createHmac('sha256', secret).update(user.token).digest('base64') : '';
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      Origin: source,
      'Content-Type': 'application/json',
      ...(user
        ? {
            Cookie: `better-auth.session_token=${encodeURIComponent(`${user.token}.${signature}`)}`,
          }
        : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const valid = {
  headline: '界面更新',
  overview: '改善阅读器布局。',
  changes: [{ text: '调整阅读器布局。', evidenceIds: ['s1'] }],
  impact: { text: '影响未知。', kind: 'unknown', evidenceIds: [] },
  breakingChange: 'unknown',
  breakingEvidenceIds: [],
  migrationNote: null,
  migrationEvidenceIds: [],
};
const item = (user: string) => ({
  ...createDemoData().items[0],
  id: `${user}-item`,
  externalId: user,
  contentHash: 'shared-fixture-content-v1',
  demo: false,
  summary: null,
  translation: null,
  body: 'Improve the reader layout.',
  description: '',
  aiVersions: undefined,
});
beforeAll(async () => {
  for (const [key, value] of Object.entries({
    APP_MODE: 'live',
    APP_URL: origin,
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: secret,
    GITHUB_CLIENT_ID: 'fixture-client',
    GITHUB_CLIENT_SECRET: 'fixture-secret',
    ALLOWED_GITHUB_USER_IDS: `${a.accountId},${b.accountId}`,
    GITHUB_READ_TOKEN: '',
    LLM_ENABLED: 'false',
    LLM_PERSONAL_ALLOWED_BASE_URLS: `${baseUrl},https://second.example.com/v1`,
    LLM_GLOBAL_DAILY_BUDGET_USD: '0.000001',
    LLM_GLOBAL_MONTHLY_BUDGET_USD: '0.000001',
    LLM_API_KEY: 'site-fixture-key',
    LLM_MODEL: 'site-fixture',
    LLM_API_BASE_URL: baseUrl,
    LLM_INPUT_USD_PER_MILLION: '1',
    LLM_OUTPUT_USD_PER_MILLION: '1',
    YOUTUBE_CLIENT_ID: '',
    YOUTUBE_CLIENT_SECRET: '',
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
    await saveItem(u.id, item(u.id));
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const u of users) {
    for (const table of ['jobs', 'ai_usage', 'items'])
      await getPool().query(`DELETE FROM ${table} WHERE user_id=$1`, [u.id]);
    await getPool().query('DELETE FROM "user" WHERE id=$1', [u.id]);
    await getPool().query('DELETE FROM app_users WHERE id=$1', [u.id]);
  }
  await getPool().query("DELETE FROM ai_cache WHERE result->>'overview'='改善阅读器布局。'");
  await getPool().end();
  vi.unstubAllEnvs();
});

it('requires an admitted session and trusted origin; rejects client-supplied user identity', async () => {
  expect((await GET(request(null))).status).toBe(401);
  expect((await GET(request(denied))).status).toBe(403);
  expect(
    (
      await PUT(
        request(a, 'PUT', configuration('fixture-a'), undefined, 'https://other.example.com'),
      )
    ).status,
  ).toBe(403);
  expect(
    (await PUT(request(a, 'PUT', { ...configuration('fixture-a'), userId: b.id }))).status,
  ).toBe(400);
  expect((await getPersonalAiSettings(b.id)).hasKey).toBe(false);
});
it('stores encrypted per-user credentials and never returns keys in settings or bootstrap', async () => {
  for (const [u, key] of [
    [a, 'fixture-personal-a'],
    [b, 'fixture-personal-b'],
  ] as const) {
    const response = await PUT(request(u, 'PUT', configuration(key)));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain(key);
    expect(text).not.toContain('encrypted_key');
    const db = (
      await getPool().query('SELECT * FROM personal_ai_settings WHERE user_id=$1', [u.id])
    ).rows[0];
    expect(JSON.stringify(db)).not.toContain(key);
    expect(db.encrypted_key).toBeTruthy();
    expect((await resolveAiConfig(u.id)).LLM_API_KEY).toBe(key);
    expect(JSON.stringify(await bootstrap({ id: u.id, name: 'fixture' }, true))).not.toContain(key);
  }
  expect((await getPersonalAiSettings(a.id)).effectiveMode).toBe('personal');
});
it('uses each user key for real model transport, partitions caches and keeps personal charges outside the site budget', async () => {
  const headers: string[] = [];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    headers.push((init!.headers as Record<string, string>).Authorization);
    expect(init?.redirect).toBe('error');
    return Response.json({
      choices: [{ message: { content: JSON.stringify(valid) } }],
      usage: { prompt_tokens: 30, completion_tokens: 50 },
    });
  });
  try {
    await runAi(a.id, `${a.id}-item`, 'summary');
    await runAi(a.id, `${a.id}-item`, 'summary');
    await runAi(b.id, `${b.id}-item`, 'summary');
    expect(headers).toEqual(['Bearer fixture-personal-a', 'Bearer fixture-personal-b']);
    expect((await getItem(a.id, `${a.id}-item`))?.summary?.overview).toBe(valid.overview);
    expect(
      (
        await getPool().query('SELECT DISTINCT billing_scope FROM ai_usage WHERE user_id=ANY($1)', [
          [a.id, b.id],
        ])
      ).rows,
    ).toEqual([{ billing_scope: 'personal' }]);
    const ac = await resolveAiConfig(a.id),
      bc = await resolveAiConfig(b.id);
    expect(skillAiCacheKey({ id: 'same', contentHash: 'same' }, 'summary', ac)).not.toBe(
      skillAiCacheKey({ id: 'same', contentHash: 'same' }, 'summary', bc),
    );
    const repo = {
      name: 'example/project',
      description: 'Same description.',
      url: 'https://github.com/example/project',
      rank: 1,
      stars: 1,
      starsToday: 1,
      language: null,
    };
    expect(descriptionCacheKey(repo, ac)).not.toBe(descriptionCacheKey(repo, bc));
  } finally {
    fetcher.mockRestore();
  }
});
it('retains a blank key only for the same destination and detects stale writes without overwriting', async () => {
  const current = await getPersonalAiSettings(a.id);
  const next = await savePersonalAiSettings(a.id, {
    ...configuration('unused', current.revision),
    apiKey: undefined,
    model: 'fixture-next',
  });
  expect(next.revision).toBe(current.revision + 1);
  expect((await resolveAiConfig(a.id)).LLM_API_KEY).toBe('fixture-personal-a');
  expect((await getItem(a.id, `${a.id}-item`))?.summary).toBeNull();
  await expect(
    savePersonalAiSettings(a.id, configuration('stale', current.revision)),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    deletePersonalAiSettings(a.id, { revision: current.revision }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    savePersonalAiSettings(a.id, {
      ...configuration('unused', next.revision),
      apiKey: undefined,
      baseUrl: 'https://second.example.com/v1',
    }),
  ).rejects.toThrow('重新填写');
});
it('cannot rebind a retained key through hidden fields when switching AI off', async () => {
  const initial = await getPersonalAiSettings(a.id);
  const off = await savePersonalAiSettings(a.id, {
    ...configuration('unused', initial.revision),
    mode: 'disabled',
    baseUrl: 'https://second.example.com/v1',
    apiKey: undefined,
  });
  expect(off.baseUrl).toBe(baseUrl);
  await expect(
    savePersonalAiSettings(a.id, {
      ...configuration('unused', off.revision),
      apiKey: undefined,
      baseUrl: 'https://second.example.com/v1',
    }),
  ).rejects.toThrow('重新填写');
  await savePersonalAiSettings(a.id, {
    ...configuration('unused', off.revision),
    apiKey: undefined,
  });
  expect((await resolveAiConfig(a.id)).LLM_API_BASE_URL).toBe(baseUrl);
});
it('keeps cached results when only budget changes or personal AI is disabled and re-enabled', async () => {
  const fresh = {
    ...item(a.id),
    id: `${a.id}-budget`,
    externalId: `${a.id}-budget`,
    contentHash: `${a.id}-budget-v1`,
  };
  await saveItem(a.id, fresh);
  const call = vi.fn(async () => ({ value: valid }));
  await runAi(a.id, fresh.id, 'summary', call);
  const current = await getPersonalAiSettings(a.id);
  const changed = await savePersonalAiSettings(a.id, {
    ...configuration('unused', current.revision),
    apiKey: undefined,
    dailyBudget: 0.6,
  });
  expect((await getItem(a.id, fresh.id))?.summary?.overview).toBe(valid.overview);
  await runAi(a.id, fresh.id, 'summary', call);
  const off = await savePersonalAiSettings(a.id, {
    ...configuration('unused', changed.revision),
    apiKey: undefined,
    mode: 'disabled',
  });
  await savePersonalAiSettings(a.id, {
    ...configuration('unused', off.revision),
    apiKey: undefined,
  });
  await runAi(a.id, fresh.id, 'summary', call);
  expect(call).toHaveBeenCalledTimes(1);
});
it('rejects unapproved destinations, whitespace keys and invalid budgets before any external request', async () => {
  const current = await getPersonalAiSettings(a.id);
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Must not fetch'));
  try {
    for (const url of [
      'http://127.0.0.1:8000/v1',
      'https://169.254.169.254/v1',
      'https://models.example.com/v1@evil.example.com',
      `${baseUrl}/extra`,
    ])
      await expect(
        savePersonalAiSettings(a.id, {
          ...configuration('fixture', current.revision),
          baseUrl: url,
        }),
      ).rejects.toThrow();
    await expect(
      savePersonalAiSettings(a.id, configuration('line\nbreak', current.revision)),
    ).rejects.toThrow();
    await expect(
      savePersonalAiSettings(a.id, {
        ...configuration('fixture', current.revision),
        dailyBudget: 8,
        monthlyBudget: 2,
      }),
    ).rejects.toThrow('每月预算');
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
  const config = getConfig();
  expect(
    personalBaseUrls({
      ...config,
      LLM_PERSONAL_ALLOWED_BASE_URLS: `${baseUrl}/,http://localhost/v1,https://user:pass@models.example.com/v1,https://models.example.com/v1?token=bad`,
    }),
  ).toEqual([baseUrl]);
});
it('tests only the saved revision, sanitizes provider errors and retains uncertain charges', async () => {
  const current = await getPersonalAiSettings(a.id);
  await expect(testPersonalAiConnection(a.id, current.revision - 1)).rejects.toMatchObject({
    status: 409,
  });
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json({ error: { message: 'do-not-echo-fixture-personal-a' } }, { status: 401 }),
    );
  try {
    const response = await testConnection(
      request(a, 'POST', { revision: current.revision }, '/api/settings/ai/test'),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('do-not-echo');
    fetcher.mockResolvedValue(
      Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }),
    );
    expect(
      (
        await testConnection(
          request(a, 'POST', { revision: current.revision }, '/api/settings/ai/test'),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await getPool().query("SELECT 1 FROM ai_usage WHERE user_id=$1 AND status='uncertain'", [
          a.id,
        ])
      ).rowCount,
    ).toBeGreaterThan(0);
  } finally {
    fetcher.mockRestore();
  }
});
it('enforces personal budgets atomically and never changes another user preference', async () => {
  const config = {
    ...(await resolveAiConfig(a.id)),
    LLM_DAILY_BUDGET_USD: 0.3,
    LLM_MONTHLY_BUDGET_USD: 0.3,
  };
  const results = await Promise.allSettled([
    reserveBudget(a.id, 0.2, new Date('2098-01-01'), config),
    reserveBudget(a.id, 0.2, new Date('2098-01-01'), config),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect((await getPersonalAiSettings(b.id)).model).toBe('fixture-model');
});
it('blocks ciphertext transplanted between users without breaking original reading', async () => {
  const original = (
    await getPool().query('SELECT encrypted_key FROM personal_ai_settings WHERE user_id=$1', [b.id])
  ).rows[0].encrypted_key;
  const other = (
    await getPool().query('SELECT encrypted_key FROM personal_ai_settings WHERE user_id=$1', [a.id])
  ).rows[0].encrypted_key;
  await getPool().query('UPDATE personal_ai_settings SET encrypted_key=$2 WHERE user_id=$1', [
    b.id,
    other,
  ]);
  expect((await resolveAiConfig(b.id)).LLM_ENABLED).toBe('false');
  expect((await getItem(b.id, `${b.id}-item`))?.body).toBe('Improve the reader layout.');
  await getPool().query('UPDATE personal_ai_settings SET encrypted_key=$2 WHERE user_id=$1', [
    b.id,
    original,
  ]);
});
it('disables removed destinations and deleted keys without silently falling back to site billing', async () => {
  vi.stubEnv('LLM_ENABLED', 'true');
  vi.stubEnv('LLM_PERSONAL_ALLOWED_BASE_URLS', '');
  expect((await resolveAiConfig(a.id)).LLM_ENABLED).toBe('false');
  vi.stubEnv('LLM_PERSONAL_ALLOWED_BASE_URLS', baseUrl);
  const before = await getPersonalAiSettings(a.id);
  const response = await DELETE(request(a, 'DELETE', { revision: before.revision }));
  expect(response.status).toBe(200);
  expect((await resolveAiConfig(a.id)).LLM_ENABLED).toBe('false');
  expect((await getPersonalAiSettings(a.id)).hasKey).toBe(false);
  expect((await getPersonalAiSettings(b.id)).effectiveMode).toBe('personal');
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Must not fetch'));
  try {
    await expect(runAi(a.id, `${a.id}-item`, 'summary')).rejects.toThrow('尚未配置');
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});
