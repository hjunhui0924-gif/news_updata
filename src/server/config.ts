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
  LOCAL_SKILLS_ENABLED: z.enum(['auto', 'true', 'false']).default('auto'),
  YOUTUBE_API_KEY: z.string().default(''),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  LLM_ENABLED: z.enum(['true', 'false']).default('false'),
  LLM_API_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default(''),
  LLM_ENABLE_THINKING: z.enum(['auto', 'true', 'false']).default('auto'),
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.5),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),
  LLM_GLOBAL_DAILY_BUDGET_USD: z.coerce.number().positive().default(5),
  LLM_GLOBAL_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(50),
  API_READ_LIMIT_PER_MINUTE: z.coerce.number().int().positive().max(10000).default(600),
  API_WRITE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().max(1000).default(60),
  API_EXTERNAL_LIMIT_PER_MINUTE: z.coerce.number().int().positive().max(1000).default(30),
  API_AI_LIMIT_PER_MINUTE: z.coerce.number().int().positive().max(100).default(10),
  LLM_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  LOG_LEVEL: z.string().default('info'),
  SYNC_REPO_INTERVAL_MINUTES: z.coerce.number().positive().default(15),
  SYNC_AUTHOR_INTERVAL_MINUTES: z.coerce.number().positive().default(30),
  SYNC_STAR_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
  SYNC_YOUTUBE_INTERVAL_MINUTES: z.coerce.number().min(15).default(180),
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
  } else if (env.NODE_ENV === 'production') {
    const appUrl = new URL(env.APP_URL);
    if (!isLocalHost(appUrl.hostname) && appUrl.protocol !== 'https:')
      throw new Error('生产环境对外 APP_URL 必须使用 HTTPS');
    if (
      env.BETTER_AUTH_SECRET.length < 32 ||
      env.BETTER_AUTH_SECRET.startsWith('replace-with-') ||
      !env.ALLOWED_GITHUB_USER_IDS.trim()
    )
      throw new Error('生产环境必须配置登录密钥与用户允许名单');
    if (!isLocalHost(appUrl.hostname)) {
      if (
        appUrl.username ||
        appUrl.password ||
        appUrl.search ||
        appUrl.hash ||
        appUrl.pathname !== '/'
      )
        throw new Error('公开部署 APP_URL 必须是无路径、查询参数的 HTTPS 站点源');
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)
        throw new Error('公开部署必须配置 GitHub OAuth 登录');
      if (!env.ALLOWED_GITHUB_USER_IDS.split(',').every((id) => /^\d+$/.test(id.trim())))
        throw new Error('允许名单必须使用逗号分隔的 GitHub 数字 ID');
      let database: URL;
      try {
        database = new URL(env.DATABASE_URL);
      } catch {
        throw new Error('生产数据库连接配置无效');
      }
      if (
        !['postgres:', 'postgresql:'].includes(database.protocol) ||
        !database.username ||
        decodeURIComponent(database.password).length < 24 ||
        decodeURIComponent(database.password) === 'news_local_only'
      )
        throw new Error('公开部署需要独立配置至少 24 字符的生产数据库密码');
    }
  }
  if (!isLocalHost(new URL(env.APP_URL).hostname)) {
    if (env.LOCAL_SKILLS_ENABLED === 'true')
      throw new Error('公开部署不允许读取服务器本机 Skill 目录');
    if (env.GITHUB_READ_TOKEN)
      throw new Error('公开部署请留空共享 GITHUB_READ_TOKEN，使用各用户自己的授权');
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

export function localSkillsEnabled(config = getConfig()) {
  return isLocalHost(new URL(config.APP_URL).hostname) && config.LOCAL_SKILLS_ENABLED !== 'false';
}

export function isLocalHost(host: string) {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}
