import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_MODE: z.enum(['demo', 'live']).default('live'),
  APP_URL: z.url().default('http://127.0.0.1:3000'),
  DATABASE_URL: z.string().min(1).default('postgresql://news:news_local_only@127.0.0.1:54329/news'),
  BETTER_AUTH_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  ALLOWED_GITHUB_USER_IDS: z.string().default(''),
  GITHUB_READ_TOKEN: z.string().default(''),
  LLM_ENABLED: z.enum(['true', 'false']).default('false'),
  LLM_API_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.5),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),
  LLM_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  LOG_LEVEL: z.string().default('info'),
  SYNC_REPO_INTERVAL_MINUTES: z.coerce.number().positive().default(15),
  SYNC_AUTHOR_INTERVAL_MINUTES: z.coerce.number().positive().default(30),
  SYNC_STAR_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
});

export function getConfig(input: Record<string, string | undefined> = process.env) {
  const env = schema.parse(input);
  if (env.APP_MODE === 'demo') {
    if (
      env.NODE_ENV === 'production' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(env.APP_URL).hostname)
    ) {
      throw new Error('演示模式仅允许在本地开发环境运行');
    }
  } else if (
    env.NODE_ENV === 'production' &&
    (env.BETTER_AUTH_SECRET.length < 32 ||
      env.BETTER_AUTH_SECRET.startsWith('replace-with-') ||
      !env.ALLOWED_GITHUB_USER_IDS.trim())
  ) {
    throw new Error('生产环境必须配置登录密钥与用户允许名单');
  }
  if (
    env.LLM_ENABLED === 'true' &&
    (!env.LLM_API_KEY ||
      !env.LLM_MODEL ||
      !env.LLM_API_BASE_URL ||
      env.LLM_INPUT_USD_PER_MILLION <= 0 ||
      env.LLM_OUTPUT_USD_PER_MILLION <= 0)
  ) {
    throw new Error('启用模型前必须配置服务地址、模型、密钥和实际 token 单价');
  }
  return env;
}

export function isLocalHost(host: string) {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
