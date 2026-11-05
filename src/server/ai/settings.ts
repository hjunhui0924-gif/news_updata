import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';
import { getConfig } from '../config';
import { getPool, transaction } from '../db/client';
import { AccessError } from '../auth/errors';
import type { AiMode, PersonalAiSettings } from '@/shared/ai-settings';

export type AiConfig = ReturnType<typeof getConfig> & {
  LLM_CACHE_SCOPE?: string;
  billingScope?: 'site' | 'personal';
};
const fields = z.object({
  baseUrl: z.string().trim().max(500).default(''),
  model: z
    .string()
    .trim()
    .max(150)
    .regex(/^[^\r\n]*$/)
    .default(''),
  inputPrice: z.number().positive().max(10000).default(1),
  outputPrice: z.number().positive().max(10000).default(1),
  dailyBudget: z.number().positive().max(1000).default(0.5),
  monthlyBudget: z.number().positive().max(10000).default(5),
});
export const personalAiSchema = fields
  .extend({
    mode: z.enum(['site', 'personal', 'disabled']),
    revision: z.number().int().nonnegative(),
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .regex(/^[^\s\x00-\x1f\x7f]+$/, '密钥不能包含空格或换行。')
      .optional(),
  })
  .strict();
export const revisionSchema = z.object({ revision: z.number().int().nonnegative() }).strict();
type Row = {
  mode: AiMode;
  revision: number;
  encrypted_key: string | null;
  data: z.infer<typeof fields>;
};
const query = 'SELECT mode,revision,encrypted_key,data FROM personal_ai_settings WHERE user_id=$1';

// Only an operator can approve outbound destinations. Users cannot turn the server into a proxy.
export function personalBaseUrls(config = getConfig()) {
  return [
    ...new Set(
      config.LLM_PERSONAL_ALLOWED_BASE_URLS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .flatMap((value) => {
          try {
            const url = new URL(value);
            if (
              url.protocol !== 'https:' ||
              url.username ||
              url.password ||
              url.search ||
              url.hash ||
              url.port ||
              !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) ||
              /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)
            )
              return [];
            return [url.toString().replace(/\/$/, '')];
          } catch {
            return [];
          }
        }),
    ),
  ];
}

function publicSettings(row: Row | undefined, config = getConfig()): PersonalAiSettings {
  const data = fields.parse(row?.data ?? {});
  const allowedBaseUrls = personalBaseUrls(config);
  const personalAvailable =
    config.APP_MODE !== 'demo' &&
    config.BETTER_AUTH_SECRET.length >= 32 &&
    allowedBaseUrls.length > 0;
  const mode = row?.mode ?? 'site';
  const enabled =
    mode === 'personal'
      ? personalAvailable && !!row?.encrypted_key && allowedBaseUrls.includes(data.baseUrl)
      : mode === 'site' && config.LLM_ENABLED === 'true';
  return {
    ...data,
    mode,
    revision: row?.revision ?? 0,
    hasKey: !!row?.encrypted_key,
    allowedBaseUrls,
    siteAvailable: config.LLM_ENABLED === 'true',
    personalAvailable,
    effectiveMode: enabled ? mode : 'disabled',
  };
}

export async function getPersonalAiSettings(userId: string) {
  return publicSettings((await getPool().query<Row>(query, [userId])).rows[0]);
}

export async function savePersonalAiSettings(userId: string, value: unknown) {
  const input = personalAiSchema.parse(value);
  const config = getConfig();
  if (config.APP_MODE === 'demo')
    throw new AccessError('本地演示不保存真实模型密钥，请在真实账号模式配置。', 400);
  if (input.mode !== 'personal' && input.apiKey)
    throw new AccessError('只有选择个人模型服务时才能提交密钥。', 400);
  if (input.mode === 'personal' && input.monthlyBudget < input.dailyBudget)
    throw new AccessError('每月预算不能小于每日预算。', 400);
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ai-settings:${userId}`]);
    const row = (await client.query<Row>(query, [userId])).rows[0];
    if ((row?.revision ?? 0) !== input.revision)
      throw new AccessError('配置已在其他页面更新，请重新加载后再保存。', 409);
    const current = publicSettings(row, config);
    if (input.mode === 'personal') {
      if (!current.personalAvailable)
        throw new AccessError('站点尚未开放个人模型服务，请联系管理员配置允许的服务地址。', 400);
      if (!current.allowedBaseUrls.includes(input.baseUrl) || !input.model)
        throw new AccessError('请选择站点允许的服务地址并填写模型名称。', 400);
      if (!input.apiKey && !row?.encrypted_key)
        throw new AccessError('首次配置需要填写 API Key。', 400);
      if (!input.apiKey && row?.data.baseUrl !== input.baseUrl)
        throw new AccessError('更换服务地址时需要重新填写 API Key。', 400);
    }
    const encrypted = input.apiKey
      ? await symmetricEncrypt({
          key: config.BETTER_AUTH_SECRET,
          data: JSON.stringify({ userId, key: input.apiKey }),
        })
      : (row?.encrypted_key ?? null);
    // Switching off or to the site service cannot rebind a retained key to another URL.
    const data = fields.parse(input.mode === 'personal' ? input : (row?.data ?? {}));
    await client.query(
      `INSERT INTO personal_ai_settings(user_id,mode,revision,encrypted_key,data)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,revision=excluded.revision,
      encrypted_key=excluded.encrypted_key,data=excluded.data,updated_at=now()`,
      [userId, input.mode, input.revision + 1, encrypted, JSON.stringify(data)],
    );
  });
  return getPersonalAiSettings(userId);
}

export async function deletePersonalAiSettings(userId: string, value: unknown) {
  const { revision } = revisionSchema.parse(value);
  if (getConfig().APP_MODE === 'demo') throw new AccessError('演示模式不保存个人密钥。', 400);
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ai-settings:${userId}`]);
    const row = (await client.query<Row>(query, [userId])).rows[0];
    if ((row?.revision ?? 0) !== revision)
      throw new AccessError('配置已更新，请重新加载后再删除。', 409);
    // Keep an explicit disabled preference: deletion must never silently bill the site's key.
    await client.query(
      `INSERT INTO personal_ai_settings(user_id,mode,revision) VALUES($1,'disabled',$2)
      ON CONFLICT(user_id) DO UPDATE SET mode='disabled',revision=excluded.revision,encrypted_key=NULL,data='{}'::jsonb,updated_at=now()`,
      [userId, revision + 1],
    );
  });
  return getPersonalAiSettings(userId);
}

export async function resolveAiConfig(
  userId: string,
  expectedRevision?: number,
): Promise<AiConfig> {
  const config = getConfig();
  const row = (await getPool().query<Row>(query, [userId])).rows[0];
  if (expectedRevision !== undefined && (row?.revision ?? 0) !== expectedRevision)
    throw new AccessError('配置已更新，请重新加载后再测试。', 409);
  const settings = publicSettings(row, config);
  if (settings.mode !== 'personal')
    return {
      ...config,
      LLM_ENABLED: settings.effectiveMode === 'site' ? 'true' : 'false',
      billingScope: 'site',
    };
  if (settings.effectiveMode !== 'personal')
    return {
      ...config,
      LLM_ENABLED: 'false',
      LLM_CACHE_SCOPE: `personal:${userId}:disabled`,
      billingScope: 'personal',
    };
  let key: string;
  try {
    const secret = JSON.parse(
      await symmetricDecrypt({ key: config.BETTER_AUTH_SECRET, data: row!.encrypted_key! }),
    );
    if (secret.userId !== userId || typeof secret.key !== 'string') throw new Error();
    key = secret.key;
  } catch {
    return {
      ...config,
      LLM_ENABLED: 'false',
      LLM_CACHE_SCOPE: `personal:${userId}:unreadable`,
      billingScope: 'personal',
    };
  }
  return {
    ...config,
    LLM_ENABLED: 'true',
    LLM_API_KEY: key,
    LLM_API_BASE_URL: settings.baseUrl,
    LLM_MODEL: settings.model,
    LLM_ENABLE_THINKING: 'auto',
    LLM_INPUT_USD_PER_MILLION: settings.inputPrice,
    LLM_OUTPUT_USD_PER_MILLION: settings.outputPrice,
    LLM_DAILY_BUDGET_USD: settings.dailyBudget,
    LLM_MONTHLY_BUDGET_USD: settings.monthlyBudget,
    LLM_CACHE_SCOPE: `personal:${userId}`,
    billingScope: 'personal',
  };
}
