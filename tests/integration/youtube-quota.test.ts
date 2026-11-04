import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migrate } from '../../scripts/migrate';
import { getPool } from '../../src/server/db/client';
import { createYouTubeTransport } from '../../src/server/platforms/youtube';
import { persistentYouTubeQuota } from '../../src/server/platforms/youtube-quota';

const project = randomUUID();
beforeAll(() => migrate());
afterAll(async () => {
  for (const credential of [project, `${project}-other`])
    await getPool().query('DELETE FROM system_state WHERE key=$1', [
      persistentYouTubeQuota('oauth', credential).key,
    ]);
  await getPool().end();
});
it('shares project quota across recreated transports without cooling another project or storing credentials', async () => {
  const quota = persistentYouTubeQuota('oauth', project);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }),
    );
  const credential = { token: async () => 'test-access', reject: async () => {} };
  await expect(
    createYouTubeTransport(undefined, fetcher, '', credential, quota)('channels', {}),
  ).rejects.toMatchObject({ status: 429 });
  await expect(
    createYouTubeTransport(
      undefined,
      fetcher,
      '',
      credential,
      persistentYouTubeQuota('oauth', project),
    )('channels', {}),
  ).rejects.toMatchObject({ status: 429 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await persistentYouTubeQuota('oauth', `${project}-other`).remaining()).toBe(0);
  expect(quota.key).not.toContain(project);
  const prior = await quota.remaining();
  await quota.hold(60);
  expect(await quota.remaining()).toBeGreaterThanOrEqual(prior - 1);
  await getPool().query('UPDATE system_state SET value=to_jsonb(0) WHERE key=$1', [quota.key]);
  expect(await persistentYouTubeQuota('oauth', project).remaining()).toBe(0);
});
