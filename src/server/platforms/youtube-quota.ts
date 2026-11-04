import { createHash } from 'node:crypto';
import { getPool } from '../db/client';

export type YouTubeQuota = {
  remaining(): Promise<number>;
  hold(seconds: number): Promise<void>;
};

export function persistentYouTubeQuota(kind: 'oauth' | 'key', credentialId: string) {
  const key = `youtube:quota:${createHash('sha256').update(`${kind}:${credentialId}`).digest('hex')}`;
  return {
    key,
    async remaining() {
      const { rows } = await getPool().query('SELECT value FROM system_state WHERE key=$1', [key]);
      return Math.max(0, Math.ceil((Number(rows[0]?.value ?? 0) - Date.now()) / 1000));
    },
    async hold(seconds: number) {
      await getPool().query(
        `INSERT INTO system_state(key,value) VALUES($1,$2)
         ON CONFLICT(key) DO UPDATE SET value=to_jsonb(GREATEST(
           (system_state.value #>> '{}')::bigint,(excluded.value #>> '{}')::bigint))`,
        [key, JSON.stringify(Date.now() + seconds * 1000)],
      );
    },
  } satisfies YouTubeQuota & { key: string };
}
