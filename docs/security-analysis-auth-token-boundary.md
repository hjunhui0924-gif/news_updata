# 认证 / 授权 / 令牌 / HTTP 安全边界 只读分析报告

> 分析对象：`D:\develop\vscode\Project\news_updata`（Next.js 16.3.5 + Better Auth 1.7.4 + PostgreSQL 17 + Drizzle ORM）
> 分析性质：**只读**。本报告由静态阅读源码、迁移 SQL、文档与测试得出，未运行应用、未修改任何文件。
> 所有行号对应当前工作区版本；密钥值一律以 `***` 代替，仅保留键名与长度/占位符判定。

---

## 0. 全局结论速览

| 维度 | 现状 | 关键证据 |
| --- | --- | --- |
| 认证框架 | Better Auth 1.7.4，**未使用任何插件**，只启用内置 GitHub social provider | `src/server/auth/index.ts:1-37` |
| 数据库适配器 | 直接把 `pg.Pool` 交给 Better Auth，由其 Kysely 适配器自动识别为 postgres | `src/server/auth/index.ts:18`、`src/server/db/client.ts:7-13` |
| session 存储 | 数据库表 `session`（DB session，非 JWT-only），HttpOnly Cookie 携带 token | `drizzle/0001_initial.sql:38-42` |
| Cookie 策略 | `httpOnly: true`、`sameSite: lax`、`path: /`、`secure` 跟随 baseURL 协议，maxAge = 7 天 | node_modules better-auth `dist/cookies/index.mjs:27-51` |
| CSRF | 全部由 Better Auth 内置 middleware 负责（Origin/Referer + Sec-Fetch-* 双重校验）；业务写接口另有自研 Origin 校验 | `node_modules/better-auth/dist/api/middlewares/origin-check.mjs:43-153`、`src/server/auth/index.ts:69-73` |
| 允许名单 | 数字 ID 白名单，两道闸门（OAuth 回调 + 每次请求） | `src/server/auth/index.ts:16,30-34,59-61`、`src/server/connectors/github-auth.ts:48-53,122-125` |
| Token 加密 | **XChaCha20-Poly1305（AEAD）+ managed nonce**，密钥由 `BETTER_AUTH_SECRET` 经 SHA-256 派生；**不是 AES-GCM** | `node_modules/better-auth/dist/crypto/index.mjs:30-47` |
| 续期 | 到期前 60s 触发 `grant_type=refresh_token`；跨进程用 PG advisory lock + `SELECT ... FOR UPDATE` 串行化 | `src/server/connectors/github-auth.ts:100-217` |
| 配置校验 | zod 4 schema + 手工跨字段断言，**fail fast（抛错拒绝启动）** | `src/server/config.ts:3-59` |
| 日志脱敏 | 只用了 pino 的 `level`，**没有 redact 配置**；但代码本身只记录 `error.name` / `job_id` / `kind` | `src/worker/main.ts:15,58,71,113` |
| 越权 | 所有用户态 SQL 都带 `user_id = $viewer` 谓词，更新/删除以 `RETURNING` 判定是否真的命中 | `src/server/db/store.ts:45-56`、`src/server/subscriptions/service.ts:106-118` |
| 安全响应头 | 3 个（nosniff / Referrer-Policy / X-Frame-Options），**没有 CSP、没有 HSTS** | `next.config.ts:14-25` |

---

## 1. Better Auth 接入方式

### 1.1 入口与实例化

`src/server/auth/index.ts:1-4`

```ts
import { betterAuth } from 'better-auth';
import { headers } from 'next/headers';
import { getConfig, isLocalHost } from '../config';
import { getPool } from '../db/client';
```

`src/server/auth/index.ts:14-42`（完整配置，逐项解读见下）

```ts
function createAuth() {
  const config = getConfig();
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',').map((x) => x.trim());
  return betterAuth({
    database: getPool(),
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    // All token rotation goes through our cross-process lock; these unused routes
    // otherwise rotate independently and can return provider tokens to clients.
    disabledPaths: ['/get-access-token', '/refresh-token', '/account-info'],
    account: { encryptOAuthTokens: true, accountLinking: { enabled: false } },
    socialProviders: {
      github: {
        clientId: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        mapProfileToUser: (profile) => {
          if (!allowed.includes(String(profile.id)))
            throw new AccessError('此账号尚未获得访问权限', 403);
          return { name: profile.name || profile.login };
        },
      },
    },
  });
}
let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (auth ??= createAuth());
}
```

配置项逐条说明：

| 配置项 | 值 | 作用与理由 |
| --- | --- | --- |
| `database` | `getPool()` 返回的 `pg.Pool` | 见 1.3 适配器分析 |
| `baseURL` | `config.APP_URL` | 决定 Cookie 的 `secure` 前缀（`__Secure-`/`__Host-`）、OAuth `redirect_uri`、错误重定向地址。与 `APP_URL` 单点对齐，因此**改域名必须同时改 OAuth App 回调** |
| `secret` | `BETTER_AUTH_SECRET` | 同时用作 session token 落库前的 HMAC 材料、`encryptOAuthTokens` 的加密密钥、OAuth state 签名材料 |
| `trustedOrigins` | `[config.APP_URL]` | 数组只有一项，不允许子域通配，等于把自己锁死在单一来源 |
| `disabledPaths` | `['/get-access-token','/refresh-token','/account-info']` | **本仓库最值得讲的一处防御性配置**，见 1.5 |
| `account.encryptOAuthTokens` | `true` | 落库前加密提供方 token，见第 3 节 |
| `account.accountLinking.enabled` | `false` | 关闭隐式账号合并。避免“同邮箱不同 provider 自动并号”这类经典越权/接管面 |
| `socialProviders.github` | clientId / clientSecret / mapProfileToUser | 唯一的身份来源 |

### 1.2 插件：一个都没用

`src/server/auth/index.ts:17-37` 的入参里**没有 `plugins: [...]` 字段**。也就是说没有启用 Better Auth 的任何插件（没有 `twoFactor`、`organization`、`admin`、`bearer`、`jwt`、`openAPI` 等）。项目只用到：

- 内置 `socialProviders.github`（GitHub OAuth provider）；
- 内置 session 管理；
- 内置 email/password 路由（因为没禁用，理论存在，但数据库没有任何密码、登录页只调 GitHub，属于“存在但未使用”的攻击面）。

GitHub provider 的实际实现（来自更底层的 `@better-auth/core`）：

`node_modules/.pnpm/@better-auth+core@1.7.4_.../node_modules/@better-auth/core/dist/social-providers/github.mjs:8-30`

```js
const github = (options) => {
	const tokenEndpoint = "https://github.com/login/oauth/access_token";
	return {
		id: "github",
		name: "GitHub",
		accountSubject: ({ profile }) => profile.id,
		createAuthorizationURL({ state, scopes, loginHint, codeVerifier, redirectURI, additionalParams }) {
			const _scopes = options.disableDefaultScope ? [] : ["read:user", "user:email"];
			...
```

关键点：`accountSubject: ({ profile }) => profile.id` —— Better Auth 用 GitHub **数字 id** 作为 `account.accountId`。这与 SECURITY.md 与 ops 文档里“允许名单是稳定数字 ID，不是用户名”的说法完全咬合（第 2 节展开）。

默认 scope 恰好是 `read:user` + `user:email`，与 `SECURITY.md:7` 的自述一致，项目没有再追加任何 scope（没有 `repo`、没有 `public_repo`、没有 `read:org`），**不申请仓库内容写权限，也不申请 Star/Follow 私有读取**。

### 1.3 数据库适配器：不是 `drizzleAdapter`，而是“直接扔 Pool”

`src/server/auth/index.ts:18` 传的是 `getPool()`：

`src/server/db/client.ts:7-16`

```ts
const state = globalThis as unknown as { newsPool?: Pool };
export function getPool() {
  return (state.newsPool ??= new Pool({
    connectionString: getConfig().DATABASE_URL,
    max: 8,
    connectionTimeoutMillis: 5000,
  }));
}
export function getDb() {
  return drizzle(getPool(), { schema });
}
```

注意分工：**业务代码用 Drizzle（`getDb()`），Better Auth 拿到的是裸 `pg.Pool`**。Better Auth 内部通过 Kysely 适配器兜住这个 Pool：

`node_modules/.pnpm/@better-auth+kysely-adapter@.../dist/index.mjs`（`getKyselyDatabaseType` / `createKyselyAdapter`）

```js
function getKyselyDatabaseType(db) {
	if (!db) return null;
	if ("dialect" in db) return getKyselyDatabaseType(db.dialect);
	...
	if ("connect" in db) return "postgres";
	...
	if ("connect" in db) {
		dialect = new PostgresDialect({ pool: db });
		transaction = true;
	}
```

即：`pg.Pool` 有 `connect` 方法 → 判定 `postgres` → 包成 `PostgresDialect` → **开启事务能力**（`transaction = true`）。

为什么这个细节重要（面试话术）：登录回调里“创建 user / 创建 account / 创建 session”是三次写操作，`transaction = true` 意味着 Better Auth 会用同一个连接走事务，不会出现“user 建了、account 没建”的半截账号；同时它也解释了为什么 `account` 表能被业务侧用 `SELECT ... FOR UPDATE` 与外层事务协调（第 4 节）。

补充：项目 **没有**依赖 `@better-auth/drizzle-adapter`（虽然 lockfile 里有，是传递依赖）。两条数据通路（业务 Drizzle、Auth Kysely）共用同一个连接池实例，因此连接数上限 `max: 8` 是两个通路共享的。

### 1.4 session 存哪里 + Cookie 策略

**存表**：`drizzle/0001_initial.sql:38-42`

```sql
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
```

`drizzle/0001_initial.sql:34-37,43-50`

```sql
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL,
  image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
...
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_idx ON account("userId");
```

`drizzle/0001_initial.sql:51-54` 还有 `verification` 表，承载 **OAuth state 与 PKCE verifier**（Better Auth 有 database 时默认 `storeStateStrategy: 'database'`，见 `dist/context/create-context.mjs:136-139`）：

```js
oauthConfig: {
	storeStateStrategy: options.account?.storeStateStrategy || (isStateful ? "database" : "cookie"),
	skipStateCookieCheck: !!options.account?.skipStateCookieCheck
},
```

因为配置了 `database`，`isStateful === true` → **state 落库**，`skipStateCookieCheck` 为 false（未配置）。state 里带 `codeVerifier` 与 `expiresAt: Date.now() + 600 * 1000`（`dist/oauth2/state.mjs:23-35`），也就是 **OAuth state/PKCE 10 分钟有效**。

**Cookie 策略**（Better Auth 默认值，项目未覆盖任何 `advanced.cookies` / `defaultCookieAttributes`）：

`node_modules/better-auth/dist/cookies/index.mjs:20-51`

```js
function createCookieGetter(options) {
	const baseURLString = typeof options.baseURL === "string" ? options.baseURL : void 0;
	...
	const secureCookiePrefix = (options.advanced?.useSecureCookies !== void 0 ? options.advanced?.useSecureCookies : dynamicProtocol === "https" ? true : dynamicProtocol === "http" ? false : baseURLString ? baseURLString.startsWith("https://") : isProduction) ? SECURE_COOKIE_PREFIX : "";
	...
	function createCookie(cookieName, overrideAttributes = {}) {
		const prefix = options.advanced?.cookiePrefix || "better-auth";
		const name = options.advanced?.cookies?.[cookieName]?.name || `${prefix}.${cookieName}`;
		...
		return {
			name: `${secureCookiePrefix}${name}`,
			attributes: {
				secure: !!secureCookiePrefix,
				sameSite: "lax",
				path: "/",
				httpOnly: true,
				...
			}
		};
	}
	return createCookie;
}
function getCookies(options) {
	const createCookie = createCookieGetter(options);
	const sessionToken = createCookie("session_token", { maxAge: options.session?.expiresIn || sec("7d") });
	const sessionData = createCookie("session_data", { maxAge: options.session?.cookieCache?.maxAge || 300 });
	...
```

由此得出本项目的实际 Cookie 事实：

| 属性 | 值 | 判定依据 |
| --- | --- | --- |
| Cookie 名 | `better-auth.session_token`，HTTPS 下自动加 `__Secure-` 前缀 | 上引 `:28-32` |
| `httpOnly` | `true`（JS 读不到 token，XSS 无法直接窃取会话） | 上引 `:37` |
| `sameSite` | `lax` | 上引 `:35` |
| `path` | `/` | 上引 `:36` |
| `secure` | `APP_URL` 以 `https://` 开头才为 `true` | 上引 `:23`。本地 `http://127.0.0.1:3000` → `false`；生产 `https://域名` → `true` |
| `maxAge` | 7 天（`sec("7d")`，项目未设 `session.expiresIn`） | 上引 `:49` |
| session 数据 Cookie | `better-auth.session_data`（JWE 精简缓存，`maxAge` 300s） | 上引 `:50`；且有 database 时 `refreshCache` 会被强制关闭并给出 warning（`dist/context/create-context.mjs:150-167`） |
| 滚动续期 | `updateAge = 1440 * 60`（默认 24 小时） | `dist/context/create-context.mjs:147-149` |
| Rate limit | 仅在 `NODE_ENV=production` 默认开启，20/窗口内 `max: 100`、`window: 10s`，存储默认 memory | `dist/context/create-context.mjs:170-176` |

注意 `sameSite: 'lax'` 的语义边界：顶层 GET 导航会带上 Cookie，但**跨站 POST 不会**。这也是为什么 `checkMutationOrigin` 那层 Origin 校验仍然必要 —— `lax` 不是“写请求免疫”，而是“写请求不带 Cookie”，而本项目部分写接口依赖 Cookie 会话，两者叠加才完整。

### 1.5 CSRF 由谁负责

**结论：主要由 Better Auth 内置 middleware 负责；业务 API 有独立的第二套 Origin 校验。**

**(a) Better Auth 侧**：`node_modules/better-auth/dist/api/index.mjs:151-168`

```js
const router = (ctx, options) => {
	...
	return createRouter(api, {
		...
		routerMiddleware: [{
			path: "/**",
			middleware: originCheckMiddleware
		}, ...middlewares],
		...
		async onRequest(req) {
			const disabledPaths = ctx.options.disabledPaths || [];
			const normalizedPath = normalizePathname(req.url, basePath);
			if (disabledPaths.includes(normalizedPath)) return new Response("Not Found", { status: 404 });
			...
```

`originCheckMiddleware` 挂在 `/**` 上，对所有非 GET/HEAD/OPTIONS 请求生效：

`node_modules/better-auth/dist/api/middlewares/origin-check.mjs:43-70`

```js
const originCheckMiddleware = createAuthMiddleware(async (ctx) => {
	if (ctx.request?.method === "GET" || ctx.request?.method === "OPTIONS" || ctx.request?.method === "HEAD" || !ctx.request) return;
	await validateOrigin(ctx);
	if (shouldSkipOriginCheck(ctx)) return;
	const { body, query } = ctx;
	const callbackURL = body?.callbackURL || query?.callbackURL;
	...
	if (label === "origin") throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.INVALID_ORIGIN);
	...
```

`validateOrigin` 的实际判定逻辑（这是 CSRF 的核心）：

`node_modules/better-auth/dist/api/middlewares/origin-check.mjs:96-118`

```js
async function validateOrigin(ctx, forceValidate = false) {
	const headers = ctx.request?.headers;
	...
	const origin = headers.get("origin");
	const originHeader = origin || headers.get("referer") || "";
	const useCookies = headers.has("cookie");
	if (ctx.context.skipCSRFCheck) return;
	if (shouldSkipCSRFForBackwardCompat(ctx)) { ... return; }
	if (shouldSkipOriginCheck(ctx)) return;
	if (!(forceValidate || useCookies)) return;
	const inferredBaseURL = origin === "null" && headers.get("sec-fetch-site") === "same-origin" ? getBaseURL(...) : void 0;
	const originToValidate = (inferredBaseURL ? getOrigin(inferredBaseURL) : void 0) ?? originHeader;
	if (!originToValidate || originToValidate === "null") throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.MISSING_OR_NULL_ORIGIN);
	const trustedOrigins = Array.isArray(ctx.context.options.trustedOrigins) ? ctx.context.trustedOrigins : [...];
	if (!trustedOrigins.some((origin) => matchesOriginPattern(originToValidate, origin))) {
		ctx.context.logger.error(`Invalid origin: ${originToValidate}`);
		...
		throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.INVALID_ORIGIN);
	}
}
```

另有面向“首次登录（无 Cookie）”的 Fetch Metadata 版本：

`node_modules/better-auth/dist/api/middlewares/origin-check.mjs:131-153`

```js
async function validateFormCsrf(ctx) {
	const req = ctx.request;
	...
	if (headers.has("cookie")) return await validateOrigin(ctx);
	const site = headers.get("Sec-Fetch-Site");
	const mode = headers.get("Sec-Fetch-Mode");
	const dest = headers.get("Sec-Fetch-Dest");
	if (Boolean(site && site.trim() || mode && mode.trim() || dest && dest.trim())) {
		if (site === "cross-site" && mode === "navigate") {
			ctx.context.logger.error("Blocked cross-site navigation login attempt (CSRF protection)", {...});
			throw APIError.from("FORBIDDEN", BASE_ERROR_CODES.CROSS_SITE_NAVIGATION_LOGIN_BLOCKED);
		}
		return await validateOrigin(ctx, true);
	}
	if (headers.get("origin") || headers.get("referer")) return await validateOrigin(ctx, true);
}
```

即：带 Cookie 的写请求必须有可验证且可信的 Origin/Referer；不带 Cookie 的“首登”导航请求（典型的登录 CSRF，攻击者用 `<form>` 或顶层跳转把用户推给攻击者的 GitHub 账号，让受害者的会话绑到攻击者身份）用 `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Mode: navigate` 拦下。**这两块都是框架内置的，项目没有关、也没有用 `disableCSRFCheck` / `skipStateCookieCheck` 绕过。**

**OAuth state / PKCE**（第三重防护）：

`node_modules/better-auth/dist/oauth2/state.mjs:17-45,46-65`

```js
async function generateState(c, options) {
	const callbackURL = c.body?.callbackURL || c.context.options.baseURL;
	if (!callbackURL) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.CALLBACK_URL_REQUIRED);
	const codeVerifier = options?.codeVerifier ?? generateRandomString(128);
	...
	const stateData = {
		...
		callbackURL,
		codeVerifier,
		...
		expiresAt: Date.now() + 600 * 1e3,
		...
	};
	await setOAuthState(stateData);
	...
async function parseState(c) {
	const state = c.query.state || c.body?.state;
	...
		if (error instanceof StateError) {
			code = error.code === "state_security_mismatch" ? "state_mismatch" : error.code;
			...
```

state 落 `verification` 表 + PKCE verifier 一起存 + `state_security_mismatch` 校验，攻击者既猜不到 state 也拿不到 code_verifier。

**(b) 业务 API 侧**：`src/server/auth/index.ts:69-73`（自研，见第 5 节）

```ts
export function checkMutationOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(getConfig().APP_URL).origin)
    throw new AccessError('请求来源不受信任', 403);
}
```

**重要差异（面试可讲）**：Better Auth 那层接受 `origin || referer` 二选一；项目自研这层**只认 `origin`，且必须是精确字符串相等**，缺 `Origin` 头（例如某些同源 `<form>` 提交或旧客户端）直接 403。更严格，但也会误伤：用 curl 手动测写接口必须显式加 `-H "Origin: ..."`。

### 1.6 Next.js 侧的胶水

`src/app/api/auth/[...all]/route.ts:1-3`

```ts
import { getAuth } from '@/server/auth';
export const GET = (request: Request) => getAuth().handler(request);
export const POST = (request: Request) => getAuth().handler(request);
```

三点观察：

1. 只导出 `GET` / `POST`，因此 Better Auth 的其它方法（`PUT`/`PATCH`/`DELETE`）在路由层面不存在 → 404。
2. 这是**全项目唯一没有走 `api()` 守卫的 API 入口**——是有意为之，它自己就带 originCheckMiddleware + state 校验，不能再包一层 `getViewer`（否则登录流程本身会因未登录而被 403）。
3. `getAuth()` 用模块级变量 `auth ??= createAuth()` 做懒加载单例（`src/server/auth/index.ts:39-42`）。这是刻意的：`createAuth()` 会 `getConfig()`，如果直接在模块顶层实例化，`next build` 阶段收集页面数据时就会因为没有生产环境变量而失败。

---

## 2. 账号允许名单 `ALLOWED_GITHUB_USER_IDS`

### 2.1 配置定义与解析

`src/server/config.ts:11`

```ts
  ALLOWED_GITHUB_USER_IDS: z.string().default(''),
```

`src/server/auth/index.ts:16`

```ts
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',').map((x) => x.trim());
```

格式是**逗号分隔的字符串**（`.env` 是 key=value，无法原生表达数组）。`.env.example:9` 与 `docs/05-operations-and-quality.md:44` 都写明“稳定数字 ID，逗号分隔，不是用户名”。

注意 `.split(',').map(trim)` 在空串时的行为：`''.split(',')` → `['']`，所以未配置时 `allowed = ['']`。因为 `String(profile.id)` 永远不可能等于 `''`，未配置就等于**所有人都不在白名单里**（fail closed，而非 fail open）。这是安全上正确的默认。

### 2.2 三道校验点

**闸门 A：OAuth 回调时**（`src/server/auth/index.ts:26-35`）

```ts
    socialProviders: {
      github: {
        clientId: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        mapProfileToUser: (profile) => {
          if (!allowed.includes(String(profile.id)))
            throw new AccessError('此账号尚未获得访问权限', 403);
          return { name: profile.name || profile.login };
        },
      },
    },
```

`mapProfileToUser` 在 provider 取到用户信息之后、写库之前被调用：

`node_modules/.pnpm/@better-auth+core@1.7.4_.../dist/social-providers/github.mjs:64-88`

```js
		async getUserInfo(token) {
			if (options.getUserInfo) return options.getUserInfo(token);
			const { data: profile, error } = await betterFetch("https://api.github.com/user", {...});
			if (error) return null;
			const { data: emails } = await betterFetch("https://api.github.com/user/emails", {...});
			if (!profile.email && emails) profile.email = (emails.find((e) => e.primary) ?? emails[0])?.email;
			const emailVerified = emails?.find((e) => e.email === profile.email)?.verified ?? false;
			const userMap = await options.mapProfileToUser?.(profile);
			return {
				user: {
					name: profile.name || profile.login || "",
					email: profile.email,
					image: profile.avatar_url,
					emailVerified,
					...userMap
				},
				data: profile
			};
		},
```

`mapProfileToUser` 抛异常时，`getUserInfo` 的 promise reject，回调在 `const providerResult = await provider.getUserInfo({...})` 处直接抛出：

`node_modules/.pnpm/better-auth@1.7.4_.../dist/api/routes/callback.mjs:122-134`

```js
	const providerResult = await provider.getUserInfo({
		...tokens,
		...idTokenNonce ? { expectedIdTokenNonce: idTokenNonce } : {},
		user: parsedUserData ?? void 0
	});
	if (!providerResult?.user) {
		c.context.logger.error("Unable to get user info");
		return redirectOnError(OAUTH_CALLBACK_ERROR_CODES.UNABLE_TO_GET_USER_INFO);
	}
```

**结果：`user` / `account` / `session` 三张表都不会写入一行**，攻击者虽然完成了 GitHub 授权，但在本应用没有留下任何身份记录。

关于 HTTP 状态的诚实说明：`AccessError` 不是 Better Auth 的 `APIError`，所以会走到最外层兜底：

`node_modules/.pnpm/better-call@1.4.0_zod@4.6.2/node_modules/better-call/dist/router.mjs:83-98`

```js
		} catch (error) {
			if (config?.onError) try { ... } catch (error) {
				if (isAPIError(error)) return toResponse(error);
				throw error;
			}
			if (config?.throwError) throw error;
			if (isAPIError(error)) return toResponse(error);
			console.error(`# SERVER_ERROR: `, error);
			return new Response(null, {
				status: 500,
				statusText: "Internal Server Error"
			});
		}
```

而 `api/index.mjs:195-216` 注册的 `onError` 只做日志、不返回 Response。所以**回调这一步对外表现为 500，而不是 403**，`AccessError` 上写的 403 在这个路径里没有生效。用户看到的是默认错误页 `/api/auth/error`（`dist/api/routes/callback.mjs:37` 的 `defaultErrorURL`），不是中文文案。这是一个真实的小缺口：**拒绝语义正确，但用户可读性不好**。想修的话，把 `AccessError` 换成 `APIError.from('FORBIDDEN', { message: '此账号尚未获得访问权限' })`（或让 `AccessError extends APIError`）即可。

**闸门 B：每次请求时**（`src/server/auth/index.ts:53-61`）

```ts
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) throw new AccessError('请先登录');
  const account = await getPool().query(
    'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
    [session.user.id, 'github'],
  );
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',').map((x) => x.trim());
  if (!account.rows.some((row) => allowed.includes(row.accountId)))
    throw new AccessError('此账号尚未获得访问权限', 403);
```

这一层的价值：**把已签发的 session 与当前允许名单做实时对账**。管理员把某个 ID 从 `ALLOWED_GITHUB_USER_IDS` 里删掉后，那个用户**不需要等 session 过期**，下一个请求立刻 403。这是“允许名单”而不是“一次性注册开关”的关键差别，也是为什么它放在 `getViewer()` 里而不是只放在回调里。

**闸门 C：GitHub 读取凭据前**（`src/server/connectors/github-auth.ts:48-53,122-125`）

```ts
function allowed(account: Account) {
  return getConfig()
    .ALLOWED_GITHUB_USER_IDS.split(',')
    .map((id) => id.trim())
    .includes(account.accountId);
}
```

```ts
      if (!allowed(account))
        return {
          error: new GitHubAuthError('reconnect_required', '此 GitHub 账号已不在访问允许名单中。'),
        };
```

第三层防止的是：**被移出白名单的账号，其加密的 OAuth token 还被后台 Worker 拿去调 GitHub**（Worker 不经过 Web 的 `getViewer`）。对应集成测试 `tests/integration/github-auth.test.ts:110-119`：

```ts
it('expired refresh or removed allowlist never sends credentials upstream', async () => {
  await getPool().query(
    'UPDATE account SET "refreshTokenExpiresAt"=now()-interval \'1 day\' WHERE id=$1',
    [userId],
  );
  await expect(githubReadToken(userId)).rejects.toThrow('重新连接');
  vi.stubEnv('ALLOWED_GITHUB_USER_IDS', '999');
  await expect(githubReadToken(userId)).rejects.toThrow('允许名单');
  expect(refresh).not.toHaveBeenCalled();
});
```

注意断言 `expect(refresh).not.toHaveBeenCalled()`：白名单失败时**不会把 refresh token 送到 GitHub**，即“越权账号连一次外呼都不允许”。

### 2.3 为什么用数字 ID 而不是用户名：代码与文档的双重证据

**(a) 代码层面 —— Better Auth 用的就是数字 ID**

`@better-auth/core/dist/social-providers/github.mjs:13`

```js
		accountSubject: ({ profile }) => profile.id,
```

`account.accountId` 列存的就是 `profile.id`（GitHub 的数字 id）。因此白名单只要和它同构比较（`String(profile.id)`、`row.accountId`），就天然是“ID 对 ID”，不需要额外解析。

**(b) 代码层面 —— 用户名会变，ID 不会**

同一个数据库 schema 里两套标识同时存在：

- `account."accountId"` = GitHub 数字 id（稳定，永不变）；
- `subscriptions.external_id` / `items.external_key` 也可能用数字 id 存（`src/server/connectors/github.ts:25` 的 `id = z.union([z.number().int().safe(), z.string()]).transform(String)`，即 API 返回的 `id` 一律转成字符串存）。

如果允许名单用 `login`（用户名），会出现三类真实问题：

1. **改名即掉线**：用户改 GitHub 用户名后，白名单失配 → 403。
2. **改名即接管**：攻击者把 GitHub 用户名改成某个已停用/被释放的名字，就能顶替白名单条目。GitHub 会释放改名后的旧用户名（有冷却期，但会释放）。
3. **大小写/规范化歧义**：`Torvalds` vs `torvalds`，比较需要额外规范化。

ID 方案不存在这三个问题：改名后 `profile.id` 不变，所以“用户改名不该影响授权”与“攻击者无法通过改名伪造身份”同时成立。

**(c) 文档层面**

`docs/05-operations-and-quality.md:44`

```
| ALLOWED_GITHUB_USER_IDS                | 允许登录的稳定数字 ID，逗号分隔，不是用户名      |
```

`SECURITY.md:7`

```
登录受稳定账号 ID 允许名单限制。
```

**(d) 与“为什么不直接用邮箱”的对比**

`docs/05-operations-and-quality.md:43-48` 说明 OAuth 只拿 `read:user` + `user:email`。邮箱的问题：用户可以改邮箱、可以设隐私邮箱、`user:email` 返回的主邮箱可能为空（provider 代码里 `profile.email` 可能 undefined，只有 `/user/emails` 兜底），且邮箱在 GitHub 侧不是不可变主键。数字 ID 是唯一稳定且必然存在（`/user` 必返回 `id`）的字段。

---

## 3. GitHub OAuth access token 的服务端加密

### 3.1 算法：**XChaCha20-Poly1305，不是 AES-GCM**

这是本报告中最需要纠正的常见误设。项目实际调用的是 Better Auth 暴露的 `symmetricEncrypt` / `symmetricDecrypt`：

`src/server/connectors/github-auth.ts:2`

```ts
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
```

其实现：

`node_modules/better-auth/dist/crypto/index.mjs:7-8,30-58`

```js
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes, managedNonce, utf8ToBytes } from "@noble/ciphers/utils.js";
...
async function rawEncrypt(secret, data) {
	const keyAsBytes = await createHash("SHA-256").digest(secret);
	const dataAsBytes = utf8ToBytes(data);
	return bytesToHex(managedNonce(xchacha20poly1305)(new Uint8Array(keyAsBytes)).encrypt(dataAsBytes));
}
async function rawDecrypt(secret, hex) {
	const keyAsBytes = await createHash("SHA-256").digest(secret);
	const dataAsBytes = hexToBytes(hex);
	const chacha = managedNonce(xchacha20poly1305)(new Uint8Array(keyAsBytes));
	return new TextDecoder().decode(chacha.decrypt(dataAsBytes));
}
const symmetricEncrypt = async ({ key, data }) => {
	if (typeof key === "string") return rawEncrypt(key, data);
	const secret = key.keys.get(key.currentVersion);
	if (!secret) throw new Error(`Secret version ${key.currentVersion} not found in keys`);
	const ciphertext = await rawEncrypt(secret, data);
	return formatEnvelope(key.currentVersion, ciphertext);
};
const symmetricDecrypt = async ({ key, data }) => {
	if (typeof key === "string") return rawDecrypt(key, data);
	const envelope = parseEnvelope(data);
	if (envelope) {
		const secret = key.keys.get(envelope.version);
		if (!secret) throw new Error(`Secret version ${envelope.version} not found in keys (key may have been retired)`);
		return rawDecrypt(secret, envelope.ciphertext);
	}
	if (key.legacySecret) return rawDecrypt(key.legacySecret, data);
	throw new Error("Cannot decrypt legacy bare-hex payload: no legacy secret available. Set BETTER_AUTH_SECRET for backwards compatibility.");
};
```

准确表述：

| 项 | 实际值 |
| --- | --- |
| 算法 | **XChaCha20-Poly1305**（AEAD，IETF 变体，24 字节扩展 nonce），来自 `@noble/ciphers` |
| 密钥派生 | `SHA-256(BETTER_AUTH_SECRET)` → 32 字节原始密钥（**无 salt、无 KDF 迭代**，直接用摘要当密钥） |
| nonce 管理 | `managedNonce(...)`：加密时随机生成 nonce 并前置到密文，解密时切分 —— 调用方不需要管 nonce，重复 nonce 风险由库兜住 |
| 输出格式 | 小写 hex（`bytesToHex`）；当 `key` 是字符串时是“裸 hex”，当 `key` 是 `{keys, currentVersion}` 对象时是 `$ba$<version>$<hex>` 信封 |
| 明文完整性 | Poly1305 tag 提供认证，密文被篡改 → `decrypt` 抛错（而不是返回垃圾明文） |
| 与 AES-GCM 的关系 | **不是 AES-GCM，也不是 AES-CBC**。选 ChaCha20 系的工程理由通常是不依赖 AES-NI 硬件加速，在 Node/服务端性能稳定且无 padding-oracle 类问题 |

**为什么项目不需要自己实现加密**：`account.encryptOAuthTokens: true`（`src/server/auth/index.ts:25`）让 Better Auth 在写 `account` 表前自动加密：

`node_modules/better-auth/dist/oauth2/utils.mjs:1-33`

```js
import { symmetricDecrypt, symmetricEncrypt } from "../crypto/index.mjs";
function isLikelyEncrypted(token) {
	if (token.startsWith("$ba$")) return true;
	return token.length % 2 === 0 && /^[0-9a-f]+$/i.test(token);
}
function decryptOAuthToken(token, ctx) {
	if (!token) return token;
	if (ctx.options.account?.encryptOAuthTokens) {
		if (!isLikelyEncrypted(token)) return token;
		return symmetricDecrypt({ key: ctx.secretConfig, data: token });
	}
	return token;
}
function setTokenUtil(token, ctx) {
	if (ctx.options.account?.encryptOAuthTokens && token) return symmetricEncrypt({
		key: ctx.secretConfig,
		data: token
	});
	return token;
}
```

写入路径（`setTokenUtil`）自动加密，读取路径（`decryptOAuthToken`）自动解密。而项目自己的续期模块**不用**这两层包装，而是**手动**调 `symmetricEncrypt/Decrypt`（`github-auth.ts:138,151,194,199,241`），因为它在 raw SQL 层直接读写 `account` 表，绕过了 Better Auth 的 ORM 路径。**两条路径必须用同一份密钥和同一算法，否则会解不开** —— 这正是它们都指向 `config.BETTER_AUTH_SECRET` 的原因。

### 3.2 密钥来自哪里

`src/server/auth/index.ts:20`

```ts
    secret: config.BETTER_AUTH_SECRET,
```

`src/server/connectors/github-auth.ts:138-141,194-200,241-244`

```ts
        token = await symmetricDecrypt({
          key: config.BETTER_AUTH_SECRET,
          data: account.accessToken,
        });
```

```ts
      const access = await symmetricEncrypt({
        key: config.BETTER_AUTH_SECRET,
        data: tokens.access_token,
      });
      const refresh = tokens.refresh_token
        ? await symmetricEncrypt({ key: config.BETTER_AUTH_SECRET, data: tokens.refresh_token })
        : account.refreshToken;
```

```ts
    const current = await symmetricDecrypt({
      key: getConfig().BETTER_AUTH_SECRET,
      data: account.accessToken,
    });
```

注意这里是 `key: config.BETTER_AUTH_SECRET` —— 一个 **string**，所以 keyring/version 信封机制（`$ba$1$...`）没有被用上，落库的是**裸 hex**。`symmetricDecrypt` 的分支逻辑（`crypto/index.mjs:48-58`）正是为此准备的：`typeof key === "string"` → 直接 `rawDecrypt`。副作用是**密钥无法平滑轮换**（无多版本 keyring），换密钥 = 所有已存 token 解不开。这一点 SECURITY.md 与运维文档都明确警告：

`SECURITY.md:9`

```
访问令牌和刷新令牌在 PostgreSQL 中加密保存，密钥来自 `BETTER_AUTH_SECRET`。不要在保留数据库的情况下随意更换此密钥，否则旧凭据无法解密；数据库与密钥同时泄露时，加密无法继续提供有效保护。
```

最后半句是本项目对威胁模型最诚实的表述：**加密防的是“只有数据库备份泄露”，不防“数据库+环境变量同时泄露”**。这是所有对称加密方案的共同边界，不是缺陷。

另有生产环境强度约束：

`src/server/config.ts:41-47`

```ts
    if (
      env.BETTER_AUTH_SECRET.length < 32 ||
      env.BETTER_AUTH_SECRET.startsWith('replace-with-') ||
      !env.ALLOWED_GITHUB_USER_IDS.trim()
    )
      throw new Error('生产环境必须配置登录密钥与用户允许名单');
```

`tests/config.test.ts:17-26`

```ts
  it('rejects the example login secret in production', () => {
    expect(() =>
      getConfig({
        APP_MODE: 'live',
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'replace-with-a-random-secret-at-least-32-characters',
        ALLOWED_GITHUB_USER_IDS: '1',
      }),
    ).toThrow('登录密钥');
  });
```

注意 `.startsWith('replace-with-')` 是**精确针对 `.env.example` 占位串**的防呆（`startsWith('replace-with-')` 能覆盖任何长度变体），比单纯的长度检查更聪明。演示启动器 `scripts/demo.ts:63-71` 会在首次补齐 `.env.local` 时把该占位串替换成 `randomBytes(32).toString('hex')`：

```ts
  if (!existsSync('.env.local')) {
    writeFileSync(
      '.env.local',
      readFileSync('.env.example', 'utf8').replace(
        'replace-with-a-random-secret-at-least-32-characters',
        randomBytes(32).toString('hex'),
      ),
    );
  }
```

也就是 64 个十六进制字符（32 字节熵）。生产环境部署清单也复述了这一点（`docs/05-operations-and-quality.md:95,99`）。

### 3.3 加密字段存在哪张表

`drizzle/0001_initial.sql:43-49`

```sql
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
```

| 列 | 是否加密 | 说明 |
| --- | --- | --- |
| `accessToken` | ✅ 加密（hex） | GitHub 访问令牌，8 小时量级 |
| `refreshToken` | ✅ 加密（hex） | GitHub 刷新令牌，半年量级 |
| `idToken` | 可能加密 | GitHub OIDC 未使用；由同一个 `setTokenUtil` 路径处理 |
| `accessTokenExpiresAt` / `refreshTokenExpiresAt` | ❌ 明文 | 时间戳不敏感，且续期逻辑需要按它排序/比较 |
| `accountId` | ❌ 明文 | GitHub 数字 id，用于白名单对账（加密它会让 `WHERE accountId=` 无法索引查询） |
| `scope` | ❌ 明文 | `read:user,user:email` |

写入证据来自集成测试（断言密文里**不包含**明文）：

`tests/integration/github-auth.test.ts:62-75`

```ts
it('refreshes once across concurrent callers and stores both tokens encrypted', async () => {
  expect((await getGitHubAuthStatus(userId)).state).toBe('refresh_pending');
  expect(await Promise.all(Array.from({ length: 5 }, () => githubReadToken(userId)))).toEqual(
    Array(5).fill('new-access'),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  ...
  const row = await account();
  expect(row.accessToken).not.toContain('new-access');
  expect(await symmetricDecrypt({ key: secret, data: row.refreshToken })).toBe('new-refresh');
  expect((await getGitHubAuthStatus(userId)).state).toBe('connected');
});
```

`expect(row.accessToken).not.toContain('new-access')` 是**明文不出现在数据库**的直接回归断言。

另外状态查询接口也被断言不泄露机密：

`tests/integration/github-auth.test.ts:139-145`

```ts
it('does not expose secrets in the public status and isolates other users', async () => {
  const status = JSON.stringify(await getGitHubAuthStatus(userId));
  expect(status).not.toMatch(/old-access|old-refresh|test-client-secret|fingerprint/);
  expect((await getGitHubAuthStatus('missing-user')).state).toBe('public');
  expect(await githubReadToken('missing-user')).toBe('');
  expect(refresh).not.toHaveBeenCalled();
});
```

### 3.4 解密在什么时机

解密**只在服务端、只在需要发请求给 GitHub 的那一刻**发生，且**从不经过 HTTP 响应体**：

| 时机 | 位置 | 解密对象 |
| --- | --- | --- |
| 读取用户 OAuth access token 去调 GitHub | `github-auth.ts:137-146` | `account.accessToken` |
| 需要续期时读取 refresh token | `github-auth.ts:149-157` | `account.refreshToken` |
| 判断迟到 401 是否针对当前令牌（防误作废） | `github-auth.ts:241-245` | `account.accessToken` |
| Better Auth 内部需要 token 时 | `dist/oauth2/utils.mjs:10-20` `decryptOAuthToken` | 同表 |

对应的“密钥不对会怎样”也有明确处理：解不开 → **不抛原始 crypto 错误，而是转成需要重新连接的语义**：

`src/server/connectors/github-auth.ts:136-144`

```ts
      let token: string;
      try {
        token = await symmetricDecrypt({
          key: config.BETTER_AUTH_SECRET,
          data: account.accessToken,
        });
      } catch {
        return fail('reconnect_required');
      }
```

这满足 `docs/12-github-auth-renewal.md:48` 的“服务端密钥无法解密凭据时仍需要重新连接”，同时避免把 crypto 细节泄露给前端。

**为什么令牌必须加密存（面试话术压缩版）**：

1. **OAuth access token 就是密码**：拿到它就能以用户身份读该 token 授权范围内的所有数据；本应用虽然只要 `read:user` + `user:email`，但 GitHub token 一旦泄露可用于撞库式枚举、关联身份、部分限流配额盗用。
2. **refresh token 比 access token 更值钱**：access token 8 小时就失效，refresh token 半年有效且可反复换新。数据库里明文存 refresh token = “半年期免密后门”，且攻击者可以静默续期不被发现。
3. **数据库泄露的概率远高于环境变量泄露**：备份文件、`pg_dump` 导出、只读副本、误设的 `SELECT` 权限、日志采集都可能带走表数据；`.env` 只在进程环境里。所以“DB 里放密文 + 密钥在环境”实质上是把单点泄露变成两点同时泄露才致命。SECURITY.md:9 最后一句话正是承认这个边界。
4. **纵深防御**：即便应用层出了 SQL 注入/越权读，攻击者拿到的是密文 hex，还需要 `BETTER_AUTH_SECRET` 才能用。
5. **合规与审计友好**：安全评审通常会直接问“第三方 token 是否加密落库”，用框架自带的 `account.encryptOAuthTokens: true` 比手写加密更容易自证正确（nonce 管理、AEAD 选择都由库负责）。

---

## 4. 令牌自动续期机制

### 4.1 触发条件：到期或距到期不足 60 秒

`src/server/connectors/github-auth.ts:27`

```ts
const expired = (date: Date | null, margin = 0) => !!date && date.getTime() <= Date.now() + margin;
```

三处调用：

`src/server/connectors/github-auth.ts:72-77`（状态判定，同样 60s 余量）

```ts
  else if (expired(account.accessTokenExpiresAt, 60000))
    state =
      account.refreshToken && !expired(account.refreshTokenExpiresAt)
        ? 'refresh_pending'
        : 'reconnect_required';
  else state = 'connected';
```

`src/server/connectors/github-auth.ts:145-148`（续期决策）

```ts
      if (options.rejectedToken !== token && !expired(account.accessTokenExpiresAt, 60000))
        return { token };
      if (!account.refreshToken || expired(account.refreshTokenExpiresAt))
        return fail('reconnect_required');
```

`src/server/connectors/github-auth.ts:73-76`（刷新令牌过期判定）

```ts
  else if (expired(account.accessTokenExpiresAt, 60000))
    state =
      account.refreshToken && !expired(account.refreshTokenExpiresAt)
```

“无到期时间”语义由 `!!date &&` 保证：`accessTokenExpiresAt` 为 `null`（例如 GitHub 不返回 `expires_in`）→ `expired()` 永远 false → **视为永不过期，直接复用，不请求刷新**。有对应测试：

`tests/integration/github-auth.test.ts:76-80`

```ts
it('does not refresh an unexpired or nonexpiring token', async () => {
  await getPool().query('UPDATE account SET "accessTokenExpiresAt"=null WHERE id=$1', [userId]);
  expect(await githubReadToken(userId)).toBe('old-access');
  expect(refresh).not.toHaveBeenCalled();
});
```

这正对 `docs/12-github-auth-renewal.md:13` 的“有效或没有声明有效期的令牌直接复用，不额外请求刷新接口”。**避免无谓刷新的意义**：GitHub 对 refresh 端点也有限流，且每次刷新都会轮换 refresh token，无谓刷新 = 无谓风险。

### 4.2 refresh token 流程

`src/server/connectors/github-auth.ts:159-215`（核心段）

```ts
      if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) return fail('temporary_error');
      let tokens: z.infer<typeof tokensSchema>;
      try {
        // Finish a started rotation even if the caller cancels; persist replacements first.
        const response = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: config.GITHUB_CLIENT_ID,
            client_secret: config.GITHUB_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        });
        const data: unknown = await response.json();
        const error = z.object({ error: z.string() }).safeParse(data);
        if (
          error.success &&
          ['bad_refresh_token', 'invalid_grant', 'expired_token', 'invalid_refresh_token'].includes(
            error.data.error,
          )
        )
          return fail('reconnect_required');
        if (!response.ok || error.success) return fail('temporary_error');
        const parsed = tokensSchema.safeParse(data);
        if (!parsed.success) return fail('temporary_error');
        tokens = parsed.data;
      } catch {
        return fail('temporary_error');
      }
```

响应 schema：

`src/server/connectors/github-auth.ts:85-91`

```ts
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(31536000).optional(),
  refresh_token_expires_in: z.number().int().positive().max(31536000).optional(),
  scope: z.string().optional(),
});
```

工程细节值得逐条讲：

1. **`redirect: 'error'`**：GitHub 的 token 端点在某些错误下会 302，跟随重定向会把 `client_secret`/`refresh_token` 作为 body 发到别处（form body 在 302 后按浏览器语义可能变成 GET）。显式禁止重定向是凭据外泄防护。
2. **`AbortSignal.timeout(20000)`**：与调用方的 `signal` 解耦。注释 `github-auth.ts:162` 解释得非常清楚：`// Finish a started rotation even if the caller cancels; persist replacements first.` —— 调用方（用户关页面 / Worker 取消）不能打断已经发出的轮换，否则 GitHub 可能已经作废旧 refresh token 而新 token 没落库，用户被迫重新登录。有测试锁住这个行为：
   `tests/integration/github-auth.test.ts:120-133`
   ```ts
   it('caller cancellation during rotation still persists new tokens before returning abort', async () => {
     const controller = new AbortController();
     refresh.mockImplementationOnce(async () => {
       controller.abort(new Error('cancelled'));
       return Response.json({ access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 28800 });
     });
     await expect(githubReadToken(userId, { signal: controller.signal })).rejects.toThrow('cancelled');
     expect(await githubReadToken(userId)).toBe('rotated');
     expect(refresh).toHaveBeenCalledTimes(1);
   });
   ```
3. **错误分类精确到 GitHub 的错误码**：`bad_refresh_token` / `invalid_grant` / `expired_token` / `invalid_refresh_token` → **永久性**，要重新连接；其余（网络、5xx、响应形状不对、`access_token: ''`）→ **临时性**，60 秒后重试。测试 `tests/integration/github-auth.test.ts:156-166` 专门验证“畸形成功响应不覆盖原凭据”：
   ```ts
   refresh.mockResolvedValueOnce(Response.json({ access_token: '' }));
   await expect(githubReadToken(userId)).rejects.toThrow('自动重试');
   expect((await account()).accessToken).toBe(before.accessToken);
   ```
4. **`access_token: z.string().min(1)`**：空字符串被 schema 拒绝，防止把空 token 写进库。
5. **`expires_in` 上限 `max(31536000)`**（1 年）：防上游返回离谱值（例如毫秒当秒传）导致“永不过期”的错误判定。
6. **refresh token 不轮换时不覆盖**：`const refresh = tokens.refresh_token ? await symmetricEncrypt(...) : account.refreshToken;`（`:198-200`）。GitHub 有时不返回新 refresh token，此时保留旧密文，而不是写 null。
7. **`scope=coalesce($6,scope)`**（`:202`）：上游没返回 scope 时保留旧值。

落库 + 清除失败状态：

`src/server/connectors/github-auth.ts:201-215`

```ts
      await client.query(
        'UPDATE account SET "accessToken"=$2,"refreshToken"=$3,"accessTokenExpiresAt"=$4,"refreshTokenExpiresAt"=$5,scope=coalesce($6,scope),"updatedAt"=now() WHERE id=$1',
        [
          account.id,
          access,
          refresh,
          tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          tokens.refresh_token_expires_in
            ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
            : account.refreshTokenExpiresAt,
          tokens.scope ?? null,
        ],
      );
      await client.query('DELETE FROM system_state WHERE key=$1', [stateKey(userId)]);
      return { token: tokens.access_token };
```

注意 `tokens.expires_in` 缺失时 `accessTokenExpiresAt` 被写成 **null**（`:207`），落入 4.1 的“永不过期”分支。这是有意为之的保守选择：宁可少刷新也不误刷。

### 4.3 并发续期：两级锁 + 指纹匹配

这是整个模块设计密度最高的部分。**并发场景**：Web 请求、Worker 任务、用户重新登录（OAuth 回调写 account）三者可能同时发生；多进程（Web + Worker 是两个 Node 进程）也会同时进来。

**第一级：PostgreSQL 事务级 advisory lock（跨进程）**

`src/server/connectors/github-auth.ts:100-106`

```ts
  const result = await transaction(
    async (client): Promise<{ token: string } | { error: GitHubAuthError }> => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [stateKey(userId)]);
      options.signal?.throwIfAborted();
      // Also serialize against OAuth callback updates during a new login.
      const account = (await client.query<Account>(`${accountQuery} FOR UPDATE`, [userId])).rows[0];
      if (!account) return { token: '' };
```

`stateKey(userId)` = `github-auth:${userId}`（`:26`）。`pg_advisory_xact_lock` 是**事务结束自动释放**的会话无关咨询锁，因此 Web 进程和 Worker 进程（不同 PG 连接、不同 Node 进程）会真正排队。`hashtext()` 把字符串映射成 bigint 锁 ID，代价是理论哈希碰撞会互相阻塞（只影响性能，不影响正确性）。

**第二级：行级锁 `FOR UPDATE`**

同一行上的 `SELECT ... FOR UPDATE` 保证读到的 `account` 是最新值（`accessToken`/`expiresAt`/`refreshToken`），也保证 `UPDATE` 不会覆盖别人刚写的值。注释 `:104` 明确说明它还负责“与新登录回调的写入串行化”。

配合 `src/server/db/client.ts:17-30` 的封装，`BEGIN`/`COMMIT`/`ROLLBACK` 都是手写的，事务边界清晰：

```ts
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

**并发效果（由测试证明）**：

`tests/integration/github-auth.test.ts:62-67`

```ts
  expect(await Promise.all(Array.from({ length: 5 }, () => githubReadToken(userId)))).toEqual(
    Array(5).fill('new-access'),
  );
  expect(refresh).toHaveBeenCalledTimes(1);
```

5 个并发调用，**GitHub 只被调用 1 次**，5 个调用者都拿到新令牌。第二个到达的调用在拿到锁之后重新 `SELECT ... FOR UPDATE`，看到 `accessTokenExpiresAt` 已被更新 → 走 `:145-146` 的提前返回分支，直接用新令牌，不再刷新。这就是“**重新读取最新令牌**”而不是“靠乐观并发版本号”。选择锁而不是 CAS/version 字段的理由：令牌轮换不是幂等操作（GitHub 每次刷新都会轮换 refresh token），失败重试代价高，锁的语义最简单直接。

**第三层：失败状态与指纹（避免锁外重复打上游）**

`src/server/connectors/github-auth.ts:22-29,107-135`

```ts
const fingerprint = (account: Account) =>
  createHash('sha256')
    .update(account.accessToken ?? '')
    .digest('hex');
const stateKey = (userId: string) => `github-auth:${userId}`;
...
      const fail = async (state: Failure['state']) => {
        await client.query(
          'INSERT INTO system_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
          [
            stateKey(userId),
            {
              fingerprint: fingerprint(account),
              state,
              retryAt:
                state === 'temporary_error' ? new Date(Date.now() + 60000).toISOString() : null,
            },
          ],
        );
        return { error: new GitHubAuthError(state) };
      };
      if (!allowed(account)) return { error: new GitHubAuthError('reconnect_required', '此 GitHub 账号已不在访问允许名单中。') };
      if (!account.accessToken) return fail('reconnect_required');
      const failure: Failure | undefined = (
        await client.query('SELECT value FROM system_state WHERE key=$1', [stateKey(userId)])
      ).rows[0]?.value;
      if (
        failure?.fingerprint === fingerprint(account) &&
        (failure.state === 'reconnect_required' ||
          (failure.retryAt && Date.parse(failure.retryAt) > Date.now()))
      )
        return { error: new GitHubAuthError(failure.state) };
```

设计要点：

- 失败状态写入**共享表 `system_state`**（不是进程内存），所以 Web 与 Worker 都能看到，跨进程退避有效。
- **指纹 = SHA-256(accessToken 密文)**。指纹本身也不落明文：以密文为输入，密文变化（新登录/新轮换）→ 指纹变化 → 旧失败状态自动失效。这是“错误状态关联令牌指纹，重新登录换发凭据后旧错误自动失效”（`docs/12-github-auth-renewal.md:17`）的实现。
- `retryAt` 只在 `temporary_error` 时设置（`+60s`），`reconnect_required` 无退避（因为重试无意义，必须人工介入）。
- `system_state` 的 key 是 `github-auth:<userId>`，**按用户隔离**，不是全局单键。
- 只有指纹匹配时才短路，所以“旧失败状态 + 新登录令牌”不会把新令牌误判为失效。测试：
  `tests/integration/github-auth.test.ts:93-109`
  ```ts
  it('permanent rejection asks to reconnect, and fresh login clears the stale failure', async () => {
    ...
    await getPool().query(
      'UPDATE account SET "accessToken"=$2,"accessTokenExpiresAt"=now()+interval \'8 hours\' WHERE id=$1',
      [userId, await encrypt('login-access')],
    );
    expect(await githubReadToken(userId)).toBe('login-access');
    expect(await getGitHubAuthStatus(userId)).state).toBe('connected');
    await markGitHubRejected(userId, 'old-access');
    expect((await getGitHubAuthStatus(userId)).state).toBe('connected');
  });
  ```

**第四层：401 重试只用“本次实际发送的令牌”**

`src/server/connectors/github-user.ts:6-31`

```ts
export async function createUserGitHubConnector(userId: string, signal?: AbortSignal) {
  let token = await githubReadToken(userId, { signal });
  return new GitHubConnector(async (path, etag) => {
    const sentToken = token;
    try {
      return await createGitHubTransport(signal, sentToken)(path, etag);
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 401 || !sentToken) throw error;
      if (getConfig().GITHUB_READ_TOKEN) {
        await markGitHubRejected(userId, sentToken);
        throw new GitHubAuthError('configuration_error');
      }
      const retryToken = await githubReadToken(userId, { signal, rejectedToken: sentToken });
      token = retryToken;
      try {
        return await createGitHubTransport(signal, retryToken)(path, etag);
      } catch (retryError) {
        if (retryError instanceof GitHubError && retryError.status === 401) {
          await markGitHubRejected(userId, retryToken);
          throw new GitHubAuthError('reconnect_required');
        }
        throw retryError;
      }
    }
  });
}
```

关键在 `sentToken` 的捕获时机 —— 闭包把它固定成“这次请求真正用的那个令牌”。因此：

- 并发请求 A 用 `old` 得到 401、请求 B 已经刷新出 `new` 时，A 调 `githubReadToken(userId, { rejectedToken: 'old' })`。`github-auth.ts:145` 的 `options.rejectedToken !== token` 判定让 A **直接拿到 `new` 而不触发第二次刷新**。测试：
  `tests/integration/github-auth.test.ts:134-138`
  ```ts
  it('401 renewal uses the latest token if another request already refreshed it', async () => {
    expect(await githubReadToken(userId, { rejectedToken: 'old-access' })).toBe('new-access');
    expect(await githubReadToken(userId, { rejectedToken: 'old-access' })).toBe('new-access');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  ```
- 迟到的 401 不会把别人刚换的新令牌标成失效，由 `markGitHubRejected` 的比对兜住：
  `src/server/connectors/github-auth.ts:238-252`
  ```ts
  await transaction(async (client) => {
    const account = (await client.query<Account>(`${accountQuery} FOR UPDATE`, [userId])).rows[0];
    if (!account?.accessToken) return;
    const current = await symmetricDecrypt({
      key: getConfig().BETTER_AUTH_SECRET,
      data: account.accessToken,
    });
    if (current !== token) return; // Late 401s cannot invalidate a newer login.
    await client.query(... state: 'reconnect_required' ...);
  });
  ```
  注释 `// Late 401s cannot invalidate a newer login.` 就是设计意图的自我说明。单元测试 `tests/github-user.test.ts:19-69` 用两个高度构造的并发时序覆盖了这两条（首个测试甚至断言 `expect(mocks.mark).not.toHaveBeenCalled()`）。
- **最多重试一次**，避免 401 → 刷新 → 401 → 刷新 的循环。

### 4.4 状态机：7 个取值

`src/shared/types.ts:136-148`

```ts
export type GitHubAuthStatus = {
  state:
    | 'connected'
    | 'refresh_pending'
    | 'reconnect_required'
    | 'temporary_error'
    | 'configuration_error'
    | 'public'
    | 'configured';
  message: string;
  expiresAt: string | null;
  retryAt: string | null;
};
```

判定优先级（`src/server/connectors/github-auth.ts:62-83`）：

```ts
  let state: GitHubAuthStatus['state'];
  const configuredToken = getConfig().GITHUB_READ_TOKEN;
  if (configuredToken)
    state =
      failure?.fingerprint === createHash('sha256').update(configuredToken).digest('hex')
        ? 'configuration_error'
        : 'configured';
  else if (!account) state = 'public';
  else if (!account.accessToken || !allowed(account)) state = 'reconnect_required';
  else if (matching) state = failure!.state;
  else if (expired(account.accessTokenExpiresAt, 60000))
    state =
      account.refreshToken && !expired(account.refreshTokenExpiresAt)
        ? 'refresh_pending'
        : 'reconnect_required';
  else state = 'connected';
```

优先级顺序（不可调换，否则语义错）：**configured 令牌 > 无账号 > 无令牌/不在白名单 > 已知失败状态 > 即将过期 > 正常**。

状态语义与用户可见文案（`src/server/connectors/github-auth.ts:30-38`）：

| state | 中文 message | 触发条件 | 用户该做什么 |
| --- | --- | --- | --- |
| `connected` | GitHub 已连接，访问凭据将按需自动续期。 | 令牌未到期且无失败记录 | 无 |
| `refresh_pending` | 访问凭据即将到期或已到期，下次同步会自动续期。 | 到期 <60s 且有未过期 refresh token | 无（等下次同步） |
| `temporary_error` | GitHub 连接暂时失败，稍后会自动重试，无需重新登录。 | 网络/5xx/畸形响应，60s 内不重试 | 无（有 `retryAt`） |
| `reconnect_required` | GitHub 授权已失效，请重新连接。订阅和阅读记录仍保留。 | refresh token 失效/过期、解密失败、不在白名单、被 401 拒 | 点「重新连接 GitHub」 |
| `configured` | 使用服务端配置的访问凭据，其有效性将在请求时检查。 | 配了 `GITHUB_READ_TOKEN` 且未被拒 | 无 |
| `configuration_error` | 服务端 GitHub 访问凭据已失效，请更新服务端配置，无需重新登录。 | `GITHUB_READ_TOKEN` 被 401 | 运维换 token，**用户不用重登** |
| `public` | 使用公开访问，尚未连接 GitHub 账号。 | 无 account 行 | 可选登录 |

**续期失败后用户看到什么**（这一条面试常问）：

- 后端：`GitHubAuthError` 继承 `GitHubError`，状态固定 **503**（`github-auth.ts:40-47`）；经 `src/server/http.ts:15-19` 时 `error.status === 401 ? 503 : error.status`，因此任何 GitHub 凭据问题对外都是 503 + 中文 message。
- 前端不会看到任何 GitHub 原文错误。`docs/12-github-auth-renewal.md:21` 明确：“不返回令牌、刷新令牌、指纹或提供方原始错误正文”。集成测试还用 `error_description: 'do-not-display'` 反向验证：
  `tests/integration/github-auth.test.ts:93-98`
  ```ts
  refresh.mockResolvedValueOnce(
    Response.json({ error: 'bad_refresh_token', error_description: 'do-not-display' }),
  );
  ```
- UI 上分两种展示（`src/components/github-connection.tsx:18-23,62-80`）：设置页显示完整状态 + 到期时间 + 「检查连接」；其他页面只在 `reconnect_required` / `temporary_error` / `configuration_error` 时显示横幅。
- **订阅偏好不会被关闭**（这是本次设计的核心目标）：`docs/12-github-auth-renewal.md:7-9` 与 `tests/integration/github-auth.test.ts:147-155`
  ```ts
  it('Star authorization failure stays enabled for recovery after reauthentication', async () => {
    await setStarSync(userId, true);
    refresh.mockResolvedValueOnce(Response.json({ error: 'bad_refresh_token' }));
    await expect(syncStarred(userId)).rejects.toThrow('重新连接');
    expect(await getStarSync(userId)).toMatchObject({
      enabled: true,
      error: expect.stringContaining('重新连接'),
    });
  });
  ```
  即“授权失败”与“用户偏好”解耦：失败只写 `error` 字段，不改 `enabled`。
- 安全细节：`github-auth.ts:29` 的 `accountQuery` **只 SELECT 需要的列**，且 `getGitHubAuthStatus` 的返回值里只有 `state` / `message` / `expiresAt` / `retryAt`（`:78-83`），没有 token 字段 —— 结构上就不可能泄露。

### 4.5 为什么不走 Better Auth 自带的刷新

`src/server/auth/index.ts:22-24`

```ts
    // All token rotation goes through our cross-process lock; these unused routes
    // otherwise rotate independently and can return provider tokens to clients.
    disabledPaths: ['/get-access-token', '/refresh-token', '/account-info'],
```

两个理由（也写在 `docs/12-github-auth-renewal.md:19`）：

1. **并发正确性**：框架自带的刷新路径不受项目的 PostgreSQL 咨询锁约束，会形成“第二条无锁刷新通路”，可能两次刷新互相覆盖 refresh token。
2. **凭据不出服务端**：`/get-access-token` 这类端点会把提供方 token 返回给调用方（浏览器）。本应用的产品前提是“业务接口不向前端返回令牌”（`docs/05-operations-and-quality.md:48`），所以必须 404 掉。

`disabledPaths` 的实现是 router 级短路：

`node_modules/better-auth/dist/api/index.mjs:165-168`

```js
		async onRequest(req) {
			const disabledPaths = ctx.options.disabledPaths || [];
			const normalizedPath = normalizePathname(req.url, basePath);
			if (disabledPaths.includes(normalizedPath)) return new Response("Not Found", { status: 404 });
```

文档还记录了验证结果：`docs/12-github-auth-renewal.md:42` “上述三个禁用的 Better Auth 入口返回 404”。

---

## 5. `src/server/http.ts` 的接口守卫

全文仅 30 行，但承担了全项目 API 的横切关注点。

`src/server/http.ts:1-30`

```ts
import { AccessError, checkMutationOrigin, getViewer } from './auth';
import { ZodError } from 'zod';
import { GitHubError } from './connectors/github';

export async function api(
  request: Request,
  action: (viewer: Awaited<ReturnType<typeof getViewer>>) => Promise<unknown>,
) {
  try {
    if (request.method !== 'GET') checkMutationOrigin(request);
    const viewer = await getViewer(request.headers);
    const data = await action(viewer);
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json(
        { error: error.message },
        { status: error.status === 401 ? 503 : error.status },
      );
    if (error instanceof AccessError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError)
      return Response.json(
        { error: error.issues[0]?.message || '输入格式不正确' },
        { status: 400 },
      );
    console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: '服务暂时不可用，请稍后重试。' }, { status: 500 });
  }
}
```

### 5.1 执行顺序（安全关键）

`if (request.method !== 'GET') checkMutationOrigin(request);` 在 `getViewer` **之前**（`:10-11`）。也就是说**未登录的跨站写请求会先收到 403「请求来源不受信任」，而不是 401「请先登录」**。这是有意的顺序选择：来源校验属于“便宜的、无状态的、不触碰数据库的”检查，放在最前可以避免跨站流量触发 DB 查询（也算一点抗放大/抗 DoS）。副作用是错误码语义上“泄漏”了一点点信息（攻击者能区分“来源不对”和“来源对但没登录”），但攻击者本来就知道自己从哪个源发请求，没有实际收益。

`getViewer` 返回的 `viewer` 被**注入**给 action（`:7,11-12`），而不是让每个 route 自己去取 —— 这是一种“默认安全（secure by default）”的 API 设计：**route 里根本没有拿到未鉴权 userId 的途径**。写一个新的 route 时只要用了 `api()`，鉴权与来源校验自动生效，忘了写的概率大幅降低。

### 5.2 认证：`getViewer` 双模式

`src/server/auth/index.ts:44-67`

```ts
export async function getViewer(requestHeaders?: Headers) {
  const h = requestHeaders ?? (await headers());
  const config = getConfig();
  if (config.APP_MODE === 'demo') {
    if (!isLocalHost(h.get('host') || '')) throw new AccessError('演示模式仅允许本地访问', 403);
    return { id: 'demo', name: '我的工作空间', image: null };
  }
  if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET)
    throw new AccessError('请先配置 GitHub 登录', 503);
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) throw new AccessError('请先登录');
  const account = await getPool().query(
    'SELECT "accountId" FROM account WHERE "userId"=$1 AND "providerId"=$2',
    [session.user.id, 'github'],
  );
  const allowed = config.ALLOWED_GITHUB_USER_IDS.split(',').map((x) => x.trim());
  if (!account.rows.some((row) => allowed.includes(row.accountId)))
    throw new AccessError('此账号尚未获得访问权限', 403);
  await getPool().query(
    'INSERT INTO app_users(id,name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET name=excluded.name',
    [session.user.id, session.user.name],
  );
  return session.user;
}
```

**demo 模式的安全设计（值得讲）**：

- `getViewer` 在 demo 下**签发一个假身份** `{ id: 'demo', ... }`，完全跳过 session。
- 唯一的门禁是 `isLocalHost(h.get('host'))`，即**请求的 Host 头必须是 `127.0.0.1` / `localhost` / `[::1]`**。
- `isLocalHost` 的实现在 `src/server/config.ts:61-67`：
  ```ts
  export function isLocalHost(host: string) {
    try {
      return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname);
    } catch {
      return false;
    }
  }
  ```
  用 `new URL('http://' + host).hostname` 做解析而不是字符串 `startsWith`，所以 **`localhost.evil.com` 会被判定为非本地**。有测试专门锁这个：
  `tests/config.test.ts:8-12`
  ```ts
  it('rejects a public demo URL and misleading host suffix', () => {
    expect(() => getConfig({ APP_MODE: 'demo', APP_URL: 'https://news.example.com' })).toThrow();
    expect(isLocalHost('localhost.evil.com')).toBe(false);
    expect(isLocalHost('127.0.0.1:3000')).toBe(true);
  });
  ```
  这防的是“DNS rebinding + 恶意子域后缀”这类绕过。
- 而且 demo 模式在配置阶段就被禁止公开运行（`config.ts:30-36`）：`NODE_ENV=production` 直接抛错；`APP_URL` 不是 loopback 直接抛错；`tests/config.test.ts:5-7` 断言 “never bypasses authentication in production”。

**live 模式的额外动作**：`app_users` 的 upsert（`:62-65`）。这是为满足业务表外键（`drizzle/0001_initial.sql:2-3` 的 `REFERENCES app_users(id)`）而做的“镜像用户表”。它用 `ON CONFLICT ... DO UPDATE SET name=excluded.name`，只同步 name，不碰 id。

注意 `getViewer` 内部会调 `getAuth().api.getSession()`，这是每个请求一次 DB 查询 + 一次 `account` 查询 + 一次 `app_users` upsert（3 次往返）。单用户 MVP 可接受；多用户规模下这是最先要加的缓存点。

### 5.3 来源校验：为什么写请求必须校验

`src/server/auth/index.ts:69-73`

```ts
export function checkMutationOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(getConfig().APP_URL).origin)
    throw new AccessError('请求来源不受信任', 403);
}
```

**为什么这些写请求需要来源校验**（面试核心问法）——要分三层讲：

1. **Cookie 是浏览器自动附加的，不区分“谁发起的”**。会话凭据放在 `better-auth.session_token`（HttpOnly Cookie），浏览器对同源请求会自动带上。因此“请求来自已登录浏览器”**不等于**“用户主观上同意发起了这个操作”。

2. **`SameSite=Lax` 挡不住所有场景**：
   - 站内 XSS 或第三方脚本注入可以同源发请求（SameSite 完全无效）；
   - 一些旧的/嵌入式浏览器对 `SameSite` 支持不完整；
   - 若未来为了跨域部署把 SameSite 放宽到 `None`（HTTPS 下常见诉求），CSRF 立刻回归。
   所以 **SameSite 是缓解，Origin 校验是断言**。真正的防护要显式断言“这个请求是从我自己的源发起的”。

3. **这些接口全部是“有副作用、且以 Cookie 会话为唯一凭据”的写操作**，逐个看后果：
   - `PATCH /api/items/[id]/state`（`src/app/api/items/[id]/state/route.ts:5`）→ 改阅读/收藏/静音状态；
   - `PATCH /api/settings`（`src/app/api/settings/route.ts:18`）→ 改时区/紧凑模式；
   - `POST /api/subscriptions`、`PATCH|DELETE /api/subscriptions/[id]`（`src/app/api/subscriptions/route.ts:6`、`src/app/api/subscriptions/[id]/route.ts:5,17`）→ 增删改订阅；
   - `POST /api/subscriptions/[id]/sync`（`.../sync/route.ts:5`）→ 触发 GitHub 抓取（**消耗配额**）；
   - `POST /api/items/[id]/translation`、`/summary/retry`、`/trending/translation`、`/skills/ai` → **触发计费的 LLM 调用**；
   - `POST /api/github/connection`、`/github/starred/auto`、`/notifications/preview`。

   其中“**计费 AI 调用**”和“**配额消耗**”这两类是 CSRF 的现实收益：攻击者不需要读数据，只要让受害者浏览器发一堆 POST，就能烧掉预算或触发限流。这是“读接口可以放宽、写接口必须严格”的具体理由。

4. **本项目为什么选了 Origin 严格相等而不是 token 方案**：`trustedOrigins: [config.APP_URL]` 单源部署 + `APP_URL` 已经是 OAuth 回调基址，所以“合法源”是单一且已知的。用 `new URL(APP_URL).origin` 比较，天然忽略 path/query 差异，且**不做 `endsWith` 之类的宽松匹配**（避免 `APP_URL=https://app.example.com` 被 `https://evil-app.example.com` 或 `https://app.example.com.evil.com` 通过）。类型上 `origin !== ...origin` 是精确等价比较，无前缀/后缀绕过空间。

5. **与框架层的分工**：Better Auth 的 `originCheckMiddleware` 保护 `/api/auth/*`；`checkMutationOrigin` 保护业务 `/api/*`。之所以不能只靠一层，是因为业务 API **不经过** Better Auth 的 handler（它们直接是 Next.js route handler），框架中间件根本不在调用链上。

6. **已知缺口（诚实记录）**：`checkMutationOrigin` 只对**非 GET** 生效（`http.ts:10`）。因此 `GET /api/bootstrap`、`GET /api/trending`、`GET /api/skills/local`、`GET /api/subscriptions`、`GET /api/settings` 等读接口没有 Origin 校验。这在当前设计下是可接受的：GET 应该是幂等的、无副作用的；但**这是一个必须靠纪律维持的约定**——一旦有人把写操作实现成 GET（例如 `GET /api/items/[id]/read?value=true`），CSRF 防护就破了。建议把“写操作禁止用 GET”写进 CONTRIBUTING 或加 lint 规则。另有一个更硬的事实：`/api/health/live` **完全无鉴权**（`src/app/api/health/live/route.ts:1`：`export const GET = () => Response.json({ status: 'ok' })`），这是有意为之的存活探针，但它也是唯一一个任何人可打、且不设 Origin 校验的端点。

### 5.4 错误响应形状与状态码约定

**统一形状**：`{ "error": "<中文用户可读消息>" }`。成功时直接返回数据本身（不是 `{ data: ... }` 包装），所以前端判断成功与否靠 HTTP 状态码而非 body 形状。

**状态码映射表**：

| 来源 | 状态码 | 位置 | 说明 |
| --- | --- | --- | --- |
| `AccessError` 默认 | **401** | `auth/index.ts:9` | 未登录（`请先登录`） |
| `AccessError` 显式 403 | 403 | `auth/index.ts:48,61,72` | demo 非本地、不在允许名单、来源不受信任 |
| `AccessError` 显式 503 | 503 | `auth/index.ts:52` | 未配置 GitHub 登录 |
| `AccessError` 业务 404 | 404 | `items/[id]/state/route.ts:17`、`subscriptions/[id]/sync/route.ts:8` | **越权/不存在统一返回 404**（见第 8 节） |
| `AccessError` 业务 400/429 | 400 / 429 | `subscriptions/[id]/sync/route.ts:9,11` | 订阅被停用 / 限流等待 |
| `GitHubError` 默认 | **502** | `github.ts:8` | 上游不可达 |
| `GitHubError` 401 | **503**（被重映射！） | `http.ts:18` | 凭据问题对用户而言是“服务不可用”，不是“你未授权” |
| `GitHubError` 400/404/429 | 400 / 404 / 429 | `github.ts:77,87,95,128,139` | 输入非法 / 来源不存在 / 限流（带 `retryAfter`） |
| `ZodError` | **400** | `http.ts:22-26` | 只回第一个 issue 的 message，且 `|| '输入格式不正确'` 兜底 |
| 其它未知异常 | **500** | `http.ts:27-28` | 只 `console.error` 记录 **error.name**，body 是固定文案 |

`GitHubError 401 → 503` 这个重映射很有讲究：`401` 在 HTTP 语义上是“调用方未认证”，但这里的 401 来自 **GitHub 说我们的凭据过期**，与前端用户无关。把它透传成 401 会让前端误以为“我该重新登录本站”，从而触发错误的 UI 分支（重定向到登录页）。映射成 503 才是“服务暂时不可用，稍后重试”的正确语义。这也是 `docs/12-github-auth-renewal.md:9` 强调的“网页会话到期与 GitHub 授权失效分开处理”。

**500 的信息隐藏**：`http.ts:27-28`

```ts
    console.error('API request failed:', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ error: '服务暂时不可用，请稍后重试。' }, { status: 500 });
```

只记录 `error.name`（例如 `TypeError`、`PostgresError`），**不记录 message**，也不把 message 返回给客户端。所以数据库连接串、SQL 片段、文件路径这类常见泄漏源不会出现在响应里。不过这也意味着**排障信息不足**（只有 error.name，没有 stack/message），运维时需要额外手段。

**缓存控制**：`http.ts:13` 所有成功响应带 `Cache-Control: no-store`。

```ts
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
```

`docs/05-operations-and-quality.md:97` 与 `SECURITY.md:21` 解释理由：业务 API 返回用户私有数据，任何中间缓存（公司代理、CDN、反向代理）都不应缓存。页面侧另有 `export const dynamic = 'force-dynamic'`（`src/app/[[...path]]/page.tsx:7`）。

### 5.5 有没有防 CSRF —— 汇总回答

**有，而且是三层**：

1. **框架层**（`/api/auth/*`）：`originCheckMiddleware` + `validateFormCsrf`（Fetch Metadata），见 1.5。
2. **应用层**（业务 `/api/*` 写方法）：`checkMutationOrigin`，Origin 严格相等。
3. **协议层**：OAuth `state` 落 `verification` 表 + PKCE `codeVerifier` + 10 分钟过期 + `state_security_mismatch` 校验。

**没有做的**（需要如实说明）：**没有 double-submit CSRF token、没有自定义 header 强制要求（如 `X-Requested-With`）、没有 per-request nonce**。当前方案依赖“`Origin` 头不可被脚本伪造”这一浏览器保证：`Origin` 是浏览器生成的**禁止修改的头**（forbidden header name），`fetch`/`XHR` 无法设置它，因此同源之外的脚本无法伪造合法 Origin。对于不使用 Cookie 的 API 客户端（如果未来加了 Bearer token），Origin 校验就不再是必要屏障，但也无害。

**Cookie 侧的配合**：`SameSite=Lax` + `HttpOnly` + HTTPS 下的 `Secure` 前缀（见 1.4）。三者叠加的效果是“跨站 POST 不带 Cookie（Lax）+ 即使带了也被 Origin 拦（断言）+ 即使响应被读也拿不到 token（HttpOnly）”。

---

## 6. `src/server/config.ts` 的环境变量校验

### 6.1 用 zod 吗：用了，zod 4.6.2

`package.json` 的 dependencies 里有 `"zod": "4.6.2"`。`src/server/config.ts:1-26` 是全量 schema：

```ts
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
  LLM_ENABLE_THINKING: z.enum(['auto', 'true', 'false']).default('auto'),
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(0.5),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),
  LLM_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  LLM_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().default(0),
  LOG_LEVEL: z.string().default('info'),
  SYNC_REPO_INTERVAL_MINUTES: z.coerce.number().positive().default(15),
  SYNC_AUTHOR_INTERVAL_MINUTES: z.coerce.number().positive().default(30),
  SYNC_STAR_INTERVAL_MINUTES: z.coerce.number().positive().default(5),
});
```

值得注意的技术点：

- **`APP_MODE: z.enum(['demo','live'])`** —— 枚举类型，不是 `z.string()`。因此 `APP_MODE=Demo`、`APP_MODE=dev`、空字符串都会**解析失败并抛错**，不会静默降级到某个分支。这个“不猜”的态度很重要：拼写错误不会变成“意外进入 demo 无鉴权模式”。
- **`APP_URL: z.url()`** —— zod 4 的顶层 URL 校验器（zod 3 是 `z.string().url()`，这里用的是新 API）。这保证了后面 `new URL(env.APP_URL)` 一定不会抛。
- **`z.coerce.number()`** —— 环境变量天然是 string，`coerce` 负责转换；`LLM_DAILY_BUDGET_USD: z.coerce.number().positive()` 把“预算必须为正”编码进类型层，`LLM_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative()` 允许 0（表示不计算费用）。
- **弱默认值 + 后续强校验的两段式**：`BETTER_AUTH_SECRET`、`GITHUB_CLIENT_ID/SECRET`、`ALLOWED_GITHUB_USER_IDS`、`GITHUB_READ_TOKEN` 默认都是 `''`，schema 层不强制；**必填性由随后的条件断言施加**。这样本地 demo（不需要 GitHub 凭据）能跑，而生产必须配齐。
- **`DATABASE_URL` 硬编码本地默认值** `postgresql://news:news_local_only@127.0.0.1:54329/news`：与 `compose.yaml:5-8` 的 `POSTGRES_USER: news` / `POSTGRES_PASSWORD: news_local_only` / `127.0.0.1:54329:5432` 完全一致。**这是一个刻意的“本地便利”默认，密码 `news_local_only` 本身也写成这个名字自我说明**；`docs/05-operations-and-quality.md:22` 明确“密码仅适用于本地演示”。

### 6.2 `APP_MODE` 的约束差异（demo vs live）

`src/server/config.ts:28-59`（完整分支逻辑）

```ts
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
```

**约束矩阵**：

| 变量 | `APP_MODE=demo` | `APP_MODE=live` + 非 production | `APP_MODE=live` + `NODE_ENV=production` |
| --- | --- | --- | --- |
| `NODE_ENV` | **必须不是 production** | 无要求 | production |
| `APP_URL` hostname | **必须是 loopback**（127.0.0.1/localhost/[::1]） | 无要求 | loopback 允许 http；**非 loopback 必须 `https:`** |
| `APP_URL` protocol | 无额外要求（但 hostname 已限制） | 无要求 | 同上 |
| `BETTER_AUTH_SECRET` | 不校验（可为空/占位串） | 不校验 | **≥32 字符，且不得以 `replace-with-` 开头** |
| `ALLOWED_GITHUB_USER_IDS` | 不校验 | 不校验 | **非空（trim 后）** |
| `GITHUB_CLIENT_ID` / `SECRET` | 不校验 | 不校验 | **不在此处校验**（延迟到 `getViewer` 运行时报 503） |
| `DATABASE_URL` | 有本地默认 | 有本地默认 | 有本地默认（不强制显式配置——**一个可讨论的宽松点**） |
| LLM 相关（`LLM_ENABLED=true` 时，**两种模式都适用**） | `LLM_API_KEY`、`LLM_MODEL`、`LLM_API_BASE_URL` 均非空，且输入/输出单价 **> 0** | 同左 | 同左 |

**几个容易在面试中被追问的细节**：

1. **demo 的 hostname 检查用的是 `new URL(env.APP_URL).hostname`**，与 `isLocalHost` 用的是**两套**代码路径（前者白名单数组 `['127.0.0.1','localhost','[::1]']` 直接比较 URL hostname；后者接受带端口/Host 头的字符串并解析）。“两处都限制了 loopback，但实现不同”这件事本身是个小的一致性隐忧，不过在行为上等价（`new URL('http://127.0.0.1:3000').hostname === '127.0.0.1'`）。
2. **`NODE_ENV=production` + `APP_MODE=demo` 直接抛错**，而不是“自动降级为 live”。这意味着即使有人手工把 demo 塞进生产，也会**启动失败**而不是静默变成无鉴权服务。测试锁死：`tests/config.test.ts:5-7`。
3. **live + production 下 `GITHUB_CLIENT_ID/SECRET` 缺失不会在启动时报错**，而是在 `getViewer` 里返回 503（`auth/index.ts:51-52`）。这是一个有意的“软失败”：允许先部署、后配 OAuth。代价是配错凭据时是运行时才发现，而不是启动时。`docs/05-operations-and-quality.md:50` 也承认“没有配置真实 OAuth 凭据时登录流程未完成，不能将登录页面可见视为验证通过”。
4. **`BETTER_AUTH_SECRET` 的双重防线**：项目在 `config.ts` 检查长度与占位串；Better Auth 自己也有一套：
   `node_modules/better-auth/dist/context/create-context.mjs:39-46`
   ```js
   function validateSecret(secret, logger) {
   	const isDefaultSecret = secret === DEFAULT_SECRET;
   	if (isTest()) return;
   	if (isDefaultSecret && isProduction) throw new BetterAuthError("You are using the default secret. Please set `BETTER_AUTH_SECRET` in your environment variables ...");
   	if (!secret) throw new BetterAuthError("BETTER_AUTH_SECRET is missing. Set it in your environment or pass `secret` to betterAuth({ secret }).");
   	if (secret.length < 32) logger.warn(`[better-auth] Warning: your BETTER_AUTH_SECRET should be at least 32 characters long for adequate security. ...`);
   	if (estimateEntropy(secret) < 120) logger.warn("[better-auth] Warning: your BETTER_AUTH_SECRET appears low-entropy. Use a genuinely random secret for production.");
   }
   ```
   注意区分：`secret` 为空时，`create-context.mjs:70-82` 会先回退到 `legacySecret || "better-auth-secret-12345678901234567890"`，所以 `if (!secret)` 在实际上很难触发；真正生效的是 `isDefaultSecret && isProduction` 那条。**在非生产环境，`BETTER_AUTH_SECRET=''` 会静默使用公开已知的默认密钥**，只打 warning。本地无妨，但如果有人用 `next dev` 绑到公网就是灾难。项目在 demo 模式下用 `isLocalHost` 拦了这一点，算是间接补上了。
5. **LLM 价格的强校验是安全/成本双重防护**：强制填真实单价（`LLM_INPUT_USD_PER_MILLION > 0`）才能启用模型，避免“开了模型但没有计价 → 预算守卫失效 → 无限烧钱”。测试：`tests/config.test.ts:13-16`
   ```ts
   it('does not enable billable AI without credentials and pricing', () => {
     expect(() => getConfig({ LLM_ENABLED: 'true' })).toThrow('实际 token 单价');
     expect(getConfig({}).LLM_ENABLED).toBe('false');
   });
   ```

### 6.3 启动失败策略：fail fast，不降级

**结论：严格 fail fast。** 所有校验都是 `throw new Error(...)`，没有任何 `console.warn` + 继续运行的降级路径。

调用时机决定了它是“启动即失败”还是“请求时失败”：

- `src/worker/main.ts:14`：`const config = getConfig();` 在模块顶层 → Worker **启动瞬间就失败**（进程退出，systemd/PM2 会看到非零退出并重试/告警）。
- `src/server/auth/index.ts:15,40-42`：`getAuth()` 是懒加载单例，`createAuth()` 内部 `getConfig()` → Web 侧在**首次调用认证时**失败（而不是 `next build` 时，这是刻意的，见 1.6）。
- `src/server/db/client.ts:9`：`getPool()` 懒加载，`getConfig().DATABASE_URL` 在首次取连接池时求值。
- 路由/页面里散落的 `getConfig()` 调用（`src/app/[[...path]]/page.tsx:10`、`server/feed/bootstrap.ts:14`、`connectors/github-auth.ts:49,63,98,224` 等）都是**每次调用重新 parse**——没有缓存。所以在运行时改了环境变量（某些平台支持热更新 env）会**立即生效于下一次请求**，这对“允许名单变更立即生效”是加分项，代价是每请求重复 `zod.parse`（可忽略的开销，但值得知道）。

**失败时的可读性**：`scripts/demo.ts:113-117` 把异常收敛成一条中文提示：

```ts
} catch (error) {
  console.error(
    `Startup failed: ${(error as Error).message}\nCheck .env.local and PostgreSQL. If Docker is unavailable, use pnpm demo --no-docker.`,
  );
  await stop(1);
}
```

`pnpm start` 走 `scripts/start-web.mjs:14-17`，强制生产模式并默认只绑 loopback：

```js
process.env.NODE_ENV = 'production';
// Do not inherit a machine/container HOSTNAME and accidentally bind publicly.
// Set APP_HOSTNAME=0.0.0.0 explicitly when running behind a container proxy.
process.env.HOSTNAME = process.env.APP_HOSTNAME ?? '127.0.0.1';
await import('../.next/standalone/server.js');
```

`process.env.NODE_ENV = 'production'` 这一行是**安全关键**：它保证 `pnpm start` 一定会走 `config.ts:37-47` 的生产分支（HTTPS + 密钥强度 + 允许名单），从而杜绝“用 start 命令跑出 demo 无鉴权模式”。`docs/05-operations-and-quality.md:88` 明确：“两者均强制使用生产模式，启用生产配置校验，拒绝演示登录绕过。”

**环境变量注入方式的取舍**：`start-web.mjs:6-12` 先尝试 `loadEnvFile('.env.local')` 再 `.env`，失败就忽略（允许 systemd/Docker 直接注入）。同时构建产物里**不留 env 文件**：`next.config.ts:8-10` 的 `outputFileTracingExcludes: { '/*': ['.env*'] }` + `scripts/clean-standalone-env.mjs:13-15`

```js
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  await rm(`${distDir}/standalone/${name}`, { force: true });
}
```

两道清理，防止本地 `.env.local`（含真实密钥）被打进可分发产物。

---

## 7. 密钥泄露防护

### 7.1 `.gitignore` 覆盖范围

`.gitignore`（全文 23 行）：

```
node_modules/
.next/
.next-e2e/
dist/
.env*
!.env.example
*.tsbuildinfo
work/
test-results/
playwright-report/
coverage/
.data/
*.log
# Local databases, backups and editor state
*.dump
*.backup
*.sqlite
*.sqlite3
*.db
*.pem
*.key
.DS_Store
Thumbs.db
```

逐条与安全的关系：

| 规则 | 防的东西 |
| --- | --- |
| `.env*` + `!.env.example` | **核心规则**。忽略一切 `.env` / `.env.local` / `.env.production`，但保留模板。注意 `.env*` 也覆盖 `.env.local.example` 之类；`!.env.example` 是精确例外 |
| `work/` | 本地运行日志、观察数据、截图（含 `work/live-observation.jsonl`、`work/github-auth-mobile.png`） |
| `*.log` | 日志文件 |
| `*.dump` / `*.backup` / `*.sqlite` / `*.sqlite3` / `*.db` | **数据库导出与本地库**。这正是“加密只防 DB 泄露”威胁模型对应的东西——但本项目的 `pg_dump` 导出恰好是 `.dump`/`.backup`，已被忽略 |
| `*.pem` / `*.key` | 私钥文件 |
| `test-results/` `playwright-report/` `coverage/` | 测试产物可能含截图/请求记录（含 Cookie） |
| `dist/` `.next/` `.next-e2e/` | 构建产物（可能含被打进 bundle 的 `NEXT_PUBLIC_*` 或误留的 env） |
| `.data/` | 本地数据目录 |
| `.DS_Store` `Thumbs.db` | 编辑器/系统残留 |

**实际验证**（本次分析执行的只读命令）：

```
$ git check-ignore -v .env.local .env .env.example work/live-observation.jsonl
.gitignore:5:.env*	.env.local
.gitignore:5:.env*	.env
.gitignore:8:work/	work/live-observation.jsonl
```

`.env.local` 与 `.env` 命中 `.gitignore:5`，`work/` 内容命中 `:8`，而 **`.env.example` 没有被忽略**（`git check-ignore` 对它无输出）——说明 `!.env.example` 例外生效，模板可以正常提交。

`SECURITY.md:29` 也把这条写成了纪律：

```
`.env*`（除示例）、构建目录、运行日志、测试产物和数据库导出不得提交。演示数据不是私人账号数据，但截图和日志仍需检查再公开。
```

### 7.2 日志里会不会打出 token

**结论：默认路径下不会，而且有多处刻意的设计保证。**

**(a) 项目自己的日志点极少且只记元数据**

唯一的 pino 使用者在 Worker：

`src/worker/main.ts:15`

```ts
const logger = pino({ level: config.LOG_LEVEL });
```

四处日志调用：

`src/worker/main.ts:58,71,113,116,124`

```ts
        logger.info({ job_id: task.id, kind: task.kind }, 'Task completed');
...
        logger.warn({ job_id: task.id, kind: task.kind, final }, 'Task failed');
...
  () => tick().catch((error) => logger.error({ error: error.name }, 'Scheduler failed')),
...
logger.info('Worker ready');
...
    logger.warn('Trending snapshot refresh failed');
```

每个 payload 都只有 `job_id`（UUID）、`kind`（`'sync'`/`'stars'`/...）、`final`（boolean）、`error.name`。**没有任何一处记录 HTTP headers、Cookie、token、请求 body 或上游响应原文。**

`src/worker/main.ts:66-70` 把错误写进数据库 `jobs.error`：

```ts
        await getPool().query('UPDATE jobs SET status=$2,error=$3,updated_at=now() WHERE id=$1', [
          task.id,
          final ? 'failed' : 'pending',
          error instanceof Error ? error.message : '任务失败',
        ]);
```

这里存的是 `error.message`。风险面在于：`GitHubError` 的 message 全是项目自己写的中文文案（`github.ts:95,128,130,138,143`），`GitHubAuthError` 也是（`github-auth.ts:30-38`），所以不会带 token。但 **`throw error` 从 Octokit 冒泡上来的异常 message 可能在极端情况包含 URL** —— Octokit 的错误 message 通常形如 `"Bad credentials"` 或带 endpoint 路径，不含 Authorization 头。`@octokit/rest` 不会把 `auth` 值放进 message。综合看风险很低。

**(b) `console.error` 的路径只打 error.name**

`src/server/http.ts:27-28`（已引）只打 `error instanceof Error ? error.name : 'UnknownError'`。

`src/server/connectors/github-auth.ts:141` 等多种 `catch { }` 是**完全静默**的空 catch（解密失败 → 直接转状态，不打印任何东西）。

**(c) 状态查询接口被测试断言不泄露**

`tests/integration/github-auth.test.ts:139-145`（已引）用 `expect(status).not.toMatch(/old-access|old-refresh|test-client-secret|fingerprint/)` 断言状态对象里既无 token、也无 fingerprint。

`docs/12-github-auth-renewal.md:21` 把这条写成了接口契约：“不返回令牌、刷新令牌、指纹或提供方原始错误正文。”

**(d) pino 的 redact 配置：没有**

`src/worker/main.ts:15` 只有 `{ level: config.LOG_LEVEL }`，**没有 `redact: [...]`**。这一点必须如实说明：

- 当前没有需要脱敏的字段被打出来，所以 `redact` 缺失**不构成现实漏洞**；
- 但它意味着**没有兜底网**：将来任何人加一行 `logger.info({ headers: req.headers })` 或 `logger.error({ error })`（打印整个 error 对象而非 `.name`），`Authorization: Bearer ghp_xxx` / `cookie: better-auth.session_token=...` 就会直接进日志。pino 的默认序列化会完整输出 error 的 `stack` 和自定义属性。

**建议（不改代码，仅建议）**：给 pino 加

```ts
pino({ level: config.LOG_LEVEL, redact: {
  paths: ['req.headers.authorization', 'req.headers.cookie', '*.accessToken', '*.refreshToken', '*.token', 'token', 'error.config.headers'],
  censor: '***',
} })
```

并把 `logger.error({ error: error.name }...)` 的写法固化成规范（永远打 `.name`/`.message`，不打整个对象）。

**(e) 其它泄露面**

| 面 | 现状 |
| --- | --- |
| 前端 bundle | 项目**没有** `NEXT_PUBLIC_*` 变量，服务端密钥不可能进 client bundle。`src/server/auth/index.ts` 没有 `'use client'` |
| API 响应 | 无任何端点返回 token（见 5、8 节）；`disabledPaths` 关掉了 Better Auth 会返回 token 的三个端点 |
| 构建产物 | `outputFileTracingExcludes` + `clean-standalone-env.mjs` 双层清理 `.env*` |
| 截图/测试产物 | `work/`、`test-results/`、`playwright-report/` 已 gitignore；`SECURITY.md:29` 要求公开前人工检查 |
| Git 历史 | 本次分析用 `git status --porcelain` 只看到源码改动（`SECURITY.md`、`docs/05-...`、`next.config.ts`、`package.json`、`scripts/start-worker.mjs`、`src/server/config.ts`、`tests/config.test.ts`、`tsconfig.json` 等），未见 `.env*` 出现在待提交列表 |
| 错误响应 | 500 只回固定中文文案，不回 message/stack |

---

## 8. 越权（IDOR）防护

核心原则：**所有用户态数据访问都以 `viewer.id` 作为 WHERE 谓词的一部分，并且调用方无法覆盖它。**

### 8.1 `PATCH /api/items/[id]/state`

`src/app/api/items/[id]/state/route.ts`（全文 19 行）

```ts
import { z } from 'zod';
import { api } from '@/server/http';
import { AccessError } from '@/server/auth';
import { patchItemState } from '@/server/db/store';
export const PATCH = async (request: Request, context: { params: Promise<{ id: string }> }) =>
  api(request, async (viewer) => {
    const patch = z
      .object({
        read: z.boolean().optional(),
        saved: z.boolean().optional(),
        muted: z.boolean().optional(),
      })
      .strict()
      .refine((x) => Object.keys(x).length > 0)
      .parse(await request.json());
    if (!(await patchItemState(viewer.id, (await context.params).id, patch)))
      throw new AccessError('更新不存在', 404);
    return { ok: true };
  });
```

底层实现：

`src/server/db/store.ts:45-56`

```ts
export async function patchItemState(
  userId: string,
  id: string,
  patch: Partial<Pick<FeedItem, 'read' | 'saved' | 'muted'>>,
) {
  const result = await getDb()
    .update(items)
    .set(patch)
    .where(and(eq(items.userId, userId), eq(items.id, id)))
    .returning({ id: items.id });
  return result.length > 0;
}
```

IDOR 防护的四个要点：

1. **`and(eq(items.userId, userId), eq(items.id, id))`** —— `userId` 是作用域，`id` 是用户提供的目标。SQL 形如 `UPDATE items SET ... WHERE user_id = $1 AND id = $2 RETURNING id`。别人的 item 匹配 0 行。
2. **`userId` 来自 `viewer.id`，不来自请求体**。zod schema 是 `.strict()`，所以 `{"userId": "victim"}` 会被**拒绝（400）**而不是被静默忽略。这是 `.strict()` 在这里的关键价值——防止参数污染类的越权尝试，也防止“参数被当成 user 作用域”的实现错误。
3. **`.refine((x) => Object.keys(x).length > 0)`** —— 空 patch `{}` 被拒。否则 `UPDATE items SET  WHERE ...` 会生成非法 SQL（或至少是无意义写）；更重要的是，空 patch 会让“是否命中”的返回值失去意义。
4. **`RETURNING` + 404 而非探测**：
   ```ts
   if (!(await patchItemState(viewer.id, (await context.params).id, patch)))
     throw new AccessError('更新不存在', 404);
   ```
   **“不存在”和“存在但属于别人”返回完全相同的 404**。这是刻意的：如果存在时返回 403、不存在时返回 404，攻击者就能用状态码差异做**存在性探测**（枚举 id 判断哪些 item 真实存在，进而推断系统规模、其它用户的活跃时间等）。统一 404 把它降级为“对攻击者无信息量”。

`drizzle/0001_initial.sql:6-11` 的表结构也支持这个查询模式：

```sql
CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), source_id text NOT NULL,
  external_key text NOT NULL, data jsonb NOT NULL, published_at timestamptz NOT NULL,
  read boolean NOT NULL DEFAULT false, saved boolean NOT NULL DEFAULT false, muted boolean NOT NULL DEFAULT false,
  UNIQUE(user_id,external_key)
);
```

注意 `id` 是 **全局主键**（不是 `(user_id, id)` 复合主键），所以不同用户理论上可以有相同 id；WHERE 里的双条件因此是**必需的**，不能只靠主键。

### 8.2 `PATCH | DELETE /api/subscriptions/[id]`

`src/app/api/subscriptions/[id]/route.ts`（全文 21 行）

```ts
import { z } from 'zod';
import { api } from '@/server/http';
import { updateSubscription, deleteSubscription } from '@/server/subscriptions/service';
type Context = { params: Promise<{ id: string }> };
export const PATCH = (request: Request, context: Context) =>
  api(request, async (viewer) =>
    updateSubscription(
      viewer.id,
      (await context.params).id,
      z
        .object({ enabled: z.boolean().optional(), priority: z.boolean().optional() })
        .strict()
        .refine((x) => Object.keys(x).length > 0)
        .parse(await request.json()),
    ),
  );
export const DELETE = (request: Request, context: Context) =>
  api(request, async (viewer) => {
    await deleteSubscription(viewer.id, (await context.params).id);
    return { ok: true };
  });
```

`src/server/subscriptions/service.ts:106-118`

```ts
export async function updateSubscription(
  userId: string,
  id: string,
  patch: Partial<Pick<Subscription, 'enabled' | 'priority'>>,
) {
  const result = await getPool().query(
    'UPDATE subscriptions SET data=data || $3::jsonb WHERE user_id=$1 AND id=$2 RETURNING data',
    [userId, id, JSON.stringify(patch)],
  );
  if (!result.rows[0]) throw new GitHubError('订阅不存在', 404);
  if (patch.enabled) await enqueue(userId, 'sync', id);
  return result.rows[0].data as Subscription;
}
```

`src/server/subscriptions/service.ts:91-104`

```ts
export async function deleteSubscription(userId: string, id: string) {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`subscription:${userId}`]);
    const { rows } = await client.query(
      'DELETE FROM subscriptions WHERE user_id=$1 AND id=$2 RETURNING kind,external_id',
      [userId, id],
    );
    if (rows[0]?.kind === 'repo')
      await client.query(
        'INSERT INTO star_sync_exclusions(user_id,external_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [userId, rows[0].external_id],
      );
  });
}
```

要点：

1. **`WHERE user_id=$1 AND id=$2 RETURNING`** 与 items 同构；`RETURNING` 用于判定命中，未命中 → 404，同样不区分“不存在”与“不属于你”。
2. **DELETE 的额外设计**：`pg_advisory_xact_lock(hashtext('subscription:' + userId))` 是**按用户**的锁（不是全局、不是按订阅）。它串行化同一用户的并发删改，防的是“删除的同时 Star 同步把它又加回来”这类竞态。锁粒度选在 user 级而不是 subscription 级，是因为 Star 同步会批量操作同一用户的多个订阅。注意这里的 `ON CONFLICT DO NOTHING` 写入 `star_sync_exclusions`（用户级表），也是带 `user_id` 的。
3. **DELETE 返回 `{ ok: true }` 而不校验是否真的删掉**：这意味着删除一个不存在的 id 也返回 200。这是幂等语义的选择（DELETE 天然幂等，重复删除不报错），但**与 PATCH 的 404 语义不一致**。安全上无碍（都没有跨用户操作），一致性上算是小瑕疵。
4. **`if (patch.enabled) await enqueue(userId, 'sync', id)`** —— 入队也带 `userId`，任务执行时再按 `(user_id, target_id)` 定位（`src/worker/main.ts:29-35`），所以任务不会跨用户执行。

### 8.3 其它路由的同类模式

| 端点 | 作用域来源 | 证据 |
| --- | --- | --- |
| `POST /api/subscriptions/[id]/sync` | 先 `getSubscription(viewer.id, id)`，null → 404 | `.../sync/route.ts:7-8` |
| `POST /api/items/[id]/translation`、`/summary/retry` | `enqueueAi(viewer.id, id, ...)` | `items/[id]/translation/route.ts:4` |
| `GET/PATCH /api/settings` | `getPreferences(viewer.id)` / `savePreferences(viewer.id, ...)` | `settings/route.ts:17-22` |
| `GET /api/bootstrap` | `bootstrap(viewer)` → 内部全部 `(user.id)` | `feed/bootstrap.ts:16-28` |
| `GET /api/subscriptions` | `getSubscriptions(viewer.id)` | `subscriptions/route.ts:5` |
| `POST /api/github/connection` | `createUserGitHubConnector(viewer.id, ...)` + `getGitHubAuthStatus(viewer.id)` | `github/connection/route.ts:6-17` |
| `GET /api/skills/starred`、`/skills/local`、`/skills/detail` | 见各自 route，均接收 `viewer` | 全部经 `api()` |

**派生出的系统性观察**：项目里没有任何一个 route handler 自己解析 userId（没有从 query/body/header 取用户标识的代码）。**唯一来源是 `getViewer()`**。这是比逐个 route 审查更强的保证——它把 IDOR 从“每个接口都要记得写对”变成了“框架层只有一条路径”。

**服务端页面侧的同类约束**：`src/app/[[...path]]/page.tsx:25-27`

```ts
  if (path.length !== (path[0] === 'items' ? 2 : 1)) notFound();
  const initial = await bootstrap(viewer);
  if (path[0] === 'items' && !initial.items.some((item) => item.id === path[1])) notFound();
```

`/items/<别人的id>` 在 `initial.items`（已经按当前用户过滤）里找不到 → `notFound()`。所以 **SSR 页面层也不会泄露别人的 item**。配合 `export const dynamic = 'force-dynamic'`（`:7`），不会出现 Next.js 缓存把 A 用户的页面回给 B 用户的情况。

**文档层面的自述**：`SECURITY.md:21`

```
订阅、更新、阅读状态、偏好、任务、通知、AI 用量和每个账号的 OAuth 凭据都以登录用户 ID 为查询条件；页面首屏强制动态渲染，业务 API 禁止缓存，不能用一个用户的会话读取另一个用户的这些数据。Trending 和基于公开正文的 AI 缓存是跨用户共享的公开结果，不包含账号私有状态。
```

**明确共享、因此不算越权的部分**（写清楚边界）：`trending` 快照与部分 AI 缓存是跨用户共享的公开数据。相关端点虽然也走 `api()`（因此仍需登录），但内容对所有人相同。`SECURITY.md:21` 与 `docs/05-operations-and-quality.md:98` 都对此作了说明。

**一个需要注意的例外**：`src/app/api/skills/local/route.ts` 读取**服务器运行账号的文件系统**：

```ts
export const GET = (request: Request) => api(request, async () => listLocalSkillCatalog());
```

`SECURITY.md:23` 明确这是主机级共享内容、不是按用户隔离的：

```
本项目的本地 Skill 目录读取服务器运行账号的文件系统，属于主机级共享内容；它不是每个登录用户独立的文件空间。多人公开运行时不要把个人资料、令牌或其他私密内容放入这些目录。
```

也就是说：**`/api/skills/local` 对任何已登录用户返回同一份服务器文件系统内容**。在“允许名单只放自己”的当前部署下没问题；一旦多人共用，这是信息隔离上的真实缺口（不是 IDOR，而是“没有 per-user 隔离”），文档已如实披露。

---

## 9. 安全响应头与 next.config.ts

`next.config.ts`（全文 27 行）

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.STARRED_E2E === 'true' ? '.next-e2e' : '.next',
  output: 'standalone',
  // Environment files must be supplied at runtime and must not be copied into
  // the standalone artifact (a local .env may contain unrelated credentials).
  outputFileTracingExcludes: {
    '/*': ['.env*'],
  },
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ['pg', 'pg-boss', 'pino'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
```

### 9.1 已配置的三个头（`next.config.ts:14-25`）

| 头 | 值 | 防护目标 | 对本项目具体防了什么 |
| --- | --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | 阻止 MIME 嗅探 | 防止浏览器把某个 `.json`/上传回显体猜成 `text/html` 并执行脚本。对所有 `/:path*` 生效 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 控制 Referer 粒度 | 跨站时不泄漏完整 URL（可能含 `/items/<id>` 这类路径信息）；同源时仍给完整 referer，保证 Better Auth 的 `validateOrigin` 在缺 `Origin` 时有可用的回退值 |
| `X-Frame-Options` | `DENY` | 禁止被 iframe 嵌入 | **防点击劫持（clickjacking）**。对 `/api/auth/*` 尤其重要：登录按钮流程不能被套在攻击者页面里骗取点击 |

`poweredByHeader: false`（`:11`）去掉 `X-Powered-By: Next.js`，减少版本指纹（虽然不影响实质安全，但属于低成本的收敛）。

`source: '/:path*'` 覆盖所有路径（页面 + API），所以业务 API 响应也会带这三个头。

### 9.2 CSP：**没有**

`Content-Security-Policy` 在 `next.config.ts` 里**完全不存在**。这是本项目安全头配置中最大的缺口，需要如实说明并解释权衡：

**没有 CSP 意味着**：

- 不能通过 `script-src` 限制脚本来源，XSS 一旦植入就可自由执行、外联、读取同源数据（Cookie 因 HttpOnly 读不到，但可以通过同源 fetch 以用户身份调 API）；
- 没有 `frame-ancestors 'none'`（虽然有 `X-Frame-Options: DENY` 覆盖了现代浏览器，CSP 的 `frame-ancestors` 是更推荐的等价手段）；
- 没有 `form-action 'self'`，无法限制表单提交目的地；
- 没有 `default-src 'none'` 起点的默认拒绝姿态；
- 没有 `upgrade-insecure-requests`（生产 HTTPS 场景下有用）。

**为什么在这个项目里没做**（可以从代码推断的合理原因）：

1. **Next.js 的 CSP 需要 nonce 或 hash**，而 nonce 要求每个请求动态生成 header → 与 `output: 'standalone'` + 可能的静态优化存在张力，也要改 `middleware.ts`。项目当前**没有 `middleware.ts`**（本次分析的 glob 未发现该文件）。
2. **应用大量使用内联样式/脚本**：`src/components/*` 有大量 className 使用 Tailwind，`ReaderApp` 是客户端组件。若上严格 CSP 需要 `'unsafe-inline'`，安全性提升有限。
3. **部署形态是本机 MVP**：`SECURITY.md:1` 明确“当前版本面向个人本机使用”，`SECURITY.md:27` 说对外运行需要但“本仓库没有交付这些部署设施”。CSP 属于“公开部署验收”清单里的一项。

**面试时怎么讲**：不要声称“本项目有完整的安全头”——明确说“三个头，没有 CSP，这是已知缺口，原因是 X-Frame-Options 已覆盖点击劫持这一个最现实的向量，而完整 CSP 需要引入 nonce/middleware，属于公开部署前的待办”。这种精确的边界陈述比模糊的“安全头都配了”更有说服力。

**其它缺失的头**（一并列出，显示分析的完整性）：

| 缺失的头 | 影响 |
| --- | --- |
| `Content-Security-Policy` | 见上，XSS 纵深防御缺失 |
| `Strict-Transport-Security` | 无 HSTS。生产强制 HTTPS 只靠 `config.ts:39-40` 的启动校验 + 反向代理。`SECURITY.md:27` 与 `docs/05-operations-and-quality.md:96` 把 HTTPS 交给反向代理 |
| `Permissions-Policy` | 未限制 camera/microphone/geolocation 等（本应用不用，风险低） |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | 未设，跨源窗口/资源隔离较弱（本应用无跨源嵌入需求） |
| `X-DNS-Prefetch-Control` | 未设（低风险） |

**注意 Better Auth 自己会加的头**：`node_modules/better-auth/dist/api/index.mjs:220` 导出了 `NO_STORE_HEADERS`，auth 端点会带 `no-store`。这与 `http.ts:13` 的手写 `Cache-Control: no-store` 属于同一策略的两处实现。

**进程绑定层面的“隐形安全头”**：`scripts/start-web.mjs:17` 把 `HOSTNAME` 默认设为 `127.0.0.1`（除非显式 `APP_HOSTNAME=0.0.0.0`），`compose.yaml:8` 把数据库端口绑到 `127.0.0.1:54329`。这两条比任何响应头都更能降低暴露面——服务在网络上根本不可达。`docs/05-operations-and-quality.md:96-97` 与 `SECURITY.md:27` 都强调了这一点。

---

## 10. 已知未完成的安全事项

### 10.1 SECURITY.md 明说的边界

`SECURITY.md:1-3`

```
# 安全与数据说明

当前版本面向个人本机使用，尚未完成正式安全审计或公开部署验收。
```

`SECURITY.md:9`（加密的边界，已引）

```
数据库与密钥同时泄露时，加密无法继续提供有效保护。
```

`SECURITY.md:11`（撤销授权的语义边界）

```
访问令牌按需续期，不等于永久授权。撤销访问请在 GitHub Settings → Applications 找到对应应用并 Revoke；退出网页登录通常只结束网页会话，不撤销 GitHub 授权。
```

`SECURITY.md:21,23`（多用户隔离与主机级共享，已引）

`SECURITY.md:27-29`

```
Compose 数据库和默认 Web 只绑定 `127.0.0.1`。演示密码仅用于本地，`APP_MODE=demo` 不是可公开部署的认证方案。对外运行需要 HTTPS、独立数据库账户、生产随机密钥、备份与恢复验证；本仓库没有交付这些部署设施。
```

### 10.2 运维文档里的边界

`docs/05-operations-and-quality.md:50`

```
没有配置真实 OAuth 凭据时登录流程未完成，不能将登录页面可见视为验证通过。
```

`docs/05-operations-and-quality.md:52`

```
允许名单面向个人试用，不等于完整多人 SaaS 权限体系。
```

`docs/05-operations-and-quality.md:101`

```
当前只提供本地运行与构建产物。生产进程守护、域名、备份计划和恢复演练未部署。数据库结构变化通过新增有序 SQL 迁移完成；手工检查迁移，特别是 Auth 和 pg-boss 管理的表。
```

`docs/12-github-auth-renewal.md:46-50`（续期的固有限制）

```
刷新发生在实际请求时，不是固定每小时轮换。网页登录会话仍有自己的有效期。用户撤销授权、刷新令牌到期、服务端密钥无法解密凭据时仍需要重新连接。如果 GitHub 已轮换令牌而网络中断导致响应完全丢失，或进程在保存前崩溃，也可能需要重新登录，无法通过本地事务消除跨系统的不确定性。

当前验证是一次真实续期和可重复的模拟故障测试，不代表已验证长期无人值守运行。应用仍为本机 MVP，公开部署前需配置 HTTPS、生产密钥与相应安全验证。
```

### 10.3 本次分析额外发现的、文档未明说的缺口

我把它们按“是否值得在面试里主动提”排序：

| # | 缺口 | 证据 | 风险等级 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | **允许名单拒绝在 OAuth 回调路径上表现为 500，而不是 403/可读错误页** | `auth/index.ts:32` 抛非 `APIError` 异常 → `better-call/dist/router.mjs:92-97` 兜底 500；`api/index.mjs:195-216` 的 `onError` 不返回 Response | 低（安全语义正确，是可用性问题） | 改用 `APIError.from('FORBIDDEN', {...})`，或让 `AccessError extends APIError` |
| 2 | **没有 CSP** | `next.config.ts:14-25` 无 `Content-Security-Policy` | 中（仅在本机/单用户部署下低） | 公开部署前加 `middleware.ts` + nonce，或至少加 `frame-ancestors 'none'` / `form-action 'self'` |
| 3 | **pino 无 `redact`** | `src/worker/main.ts:15` 只有 `level` | 低（当前无敏感字段入日志），但无兜底 | 加 `redact.paths`，并固化“只记 error.name”的规范 |
| 4 | **`checkMutationOrigin` 不覆盖 GET** | `src/server/http.ts:10` | 低（依赖“GET 无副作用”纪律） | 文档/lint 层面禁止用 GET 实现写操作；或对特定写语义的 GET 单独加校验 |
| 5 | **live + production 下不校验 `GITHUB_CLIENT_ID/SECRET` 必填** | `config.ts:37-47` 只查密钥与允许名单；凭据缺失在 `auth/index.ts:51-52` 运行时报 503 | 低 | 生产分支加 `!env.GITHUB_CLIENT_ID \|\| !env.GITHUB_CLIENT_SECRET` 则抛错，与 LLM 的校验风格统一 |
| 6 | **非生产环境 `BETTER_AUTH_SECRET=''` 会静默使用框架公开默认密钥**（`better-auth-secret-12345678901234567890`） | `better-auth/dist/context/create-context.mjs:71-82`；项目 `config.ts` 只在 production 检查 | 低（demo 有 `isLocalHost` 兜底；live+dev 若绑公网则有风险） | 在 `getConfig` 里对 `APP_MODE=live` 也要求 secret ≥32 且非占位 |
| 7 | **email/password 相关 Better Auth 内置端点未被禁用**（虽然数据库无密码字段、UI 不调用） | `auth/index.ts:24` 的 `disabledPaths` 只禁了 3 个 token 相关路径 | 低 | 若确认不需要密码登录，可显式禁用 `/sign-up/email`、`/sign-in/email` 等 |
| 8 | **`config.ts` 每次调用都 `zod.parse`，无缓存** | `config.ts:28-29`；调用点遍布（`bootstrap.ts:14`、`page.tsx:10`、`github-auth.ts:49,63,98,224` 等） | 极低（性能而非安全） | 可加按 `input` 的 memo；**但“允许名单变更立即生效”这个特性依赖不缓存，改的时候要小心** |
| 9 | **`getViewer` 每请求 3 次 DB 往返**（getSession + account 查询 + app_users upsert） | `auth/index.ts:53-65` | 极低（规模问题） | 多用户前加短 TTL 缓存；注意不要让授权结果被缓存过久 |
| 10 | **DELETE 订阅对不存在的 id 返回 200**，与 PATCH 的 404 不一致 | `subscriptions/[id]/route.ts:17-21` vs `service.ts:115` | 无（无跨用户风险） | 若在意一致性可统一 |
| 11 | **`/api/skills/local` 返回主机级共享文件内容** | `skills/local/route.ts:4`；`SECURITY.md:23` 已披露 | 低（单用户部署）/中（多人） | 多人部署时移除该端点或做明显的主机共享提示 |
| 12 | **`APP_MODE=demo` 的 `getViewer` 用 `Host` 头判断本地性** | `auth/index.ts:48` + `config.ts:61-67` | 低（Host 可伪造，但前提是 attacker 已能让请求到达服务且服务绑在127.0.0.1） | 已有 `config.ts:30-36` 在启动时禁止 demo 公开运行，叠加后足够 |

### 10.4 明确已做对、值得在面试里强调的点

- ✅ **fail closed 的默认**：`ALLOWED_GITHUB_USER_IDS` 未配置 = 谁都不能登录（`''.split(',')` → `['']`，永不匹配）。
- ✅ **允许名单实时生效**：不只在注册时检查，每次 `getViewer` 都重查（`auth/index.ts:55-61`）。
- ✅ **凭据泄露面收敛到极致**：禁用框架的 token 端点 + 状态接口不含 token + 测试断言 + 500 不回 message。
- ✅ **并发正确性有真实数据库测试**：`tests/integration/github-auth.test.ts` 用真 PostgreSQL 验证“5 并发只刷新 1 次”“迟到 401 不作废新令牌”“取消也先落库”。
- ✅ **安全断言可回归**：`expect(row.accessToken).not.toContain('new-access')`、`expect(status).not.toMatch(/old-access|.../)`、`expect(refresh).not.toHaveBeenCalled()`、`expect(isLocalHost('localhost.evil.com')).toBe(false)` —— 都是把安全属性写成可执行断言的范例，而不是文档里的口头承诺。
- ✅ **`docs/12-github-auth-renewal.md:37-44` 记录了人工验证**：本地无会话调 `/api/github/connection` 返回 401、三个禁用端点返回 404、健康接口 200、真实账号完成一次真实续期。

---

## 11. 面试话术：三个指定问题的完整答法

### 11.1 “为什么用 Better Auth 而不是 NextAuth/Auth.js 或自己写 session”

**先给结论**：因为我们需要的不是“一个登录按钮”，而是 **OAuth 凭据生命周期管理 + 数据库会话 + 可审计的越权边界**，这三件事里 Better Auth 帮我兜住了两件半，而 Auth.js 兜住的更少，自己写则会引入我最不想自己实现的加密和 CSRF。

**理由分解（每条都有本仓库的证据）**：

1. **会话是数据库会话，不是 JWT**。`drizzle/0001_initial.sql:38-42` 的 `session` 表带 `expiresAt`/`ipAddress`/`userAgent`，`ON DELETE CASCADE` 到 `user`。这让我能**服务端强制失效**某人的会话（删行即可），而不是等 JWT 过期。Auth.js 的主线是 JWT session，做服务端撤销要额外配 adapter + database strategy。

2. **默认值就是安全的**。Better Auth 的 Cookie 默认 `httpOnly: true, sameSite: 'lax', path: '/'`，HTTPS 自动加 `__Secure-` 前缀（`dist/cookies/index.mjs:27-51`）。**我没有写任何一行 Cookie 配置代码**，安全性来自框架默认。自己写 session 最容易错的就是这里——`httpOnly` 忘了、`sameSite` 设成 `None`、`secure` 在开发环境忘了关。Auth.js 也安全，但它把很多决定暴露在 `cookies` 配置里。

3. **OAuth token 加密是配置项而不是重写**：`account: { encryptOAuthTokens: true }`（`auth/index.ts:25`）一行，落库前自动 XChaCha20-Poly1305 加密（`dist/oauth2/utils.mjs:21-27`）。**如果我手写，我要自己处理 nonce 管理、AEAD 选择、密钥派生、以及“加密路径”和“解密路径”必须对称**——而我在 `github-auth.ts` 里还有第二条 raw SQL 通路，两边必须用同一算法同一密钥。这是最容易出 silent bug 的地方（加密用了 A 算法、解密走了 B 分支，本地测试还过，生产才发现）。框架给了一个我信任的实现，我只需要保证两条路径都调它。

4. **CSRF 是框架内建的，不是我要记得加的中间件**。Better Auth 把 `originCheckMiddleware` 挂在 `/**`（`api/index.mjs:159-162`），并对无 Cookie 的首登场景用 Fetch Metadata 额外防了一层登录 CSRF（`origin-check.mjs:131-153`）。**Auth.js 同样有 CSRF 保护**（它设计上更早就有），这点不是它的劣势；但 Better Auth 的 Origin/Referer + Sec-Fetch-* 组合更贴我“单源、Cookie 会话”的部署形态，而且它把 `trustedOrigins` 做成了显式必填概念——我必须在 `auth/index.ts:21` 写 `trustedOrigins: [config.APP_URL]`，这个强制动作本身就是一次安全设计确认。

5. **OAuth 的 state + PKCE 自动落库**：`verification` 表 + 10 分钟过期 + `state_security_mismatch` 校验（`oauth2/state.mjs:23-35,56-60`）。自己写这段极容易写成“state 只存内存”或“不校验 state”，后者是 OAuth 里最经典的漏洞。

6. **有意识地不做的事比做的更能说明选型**：我用 `disabledPaths` 关掉了框架自带的 `/get-access-token`、`/refresh-token`、`/account-info`（`auth/index.ts:22-24`）。理由写在注释里：这些路径不受我的 PostgreSQL 咨询锁约束，会形成第二条刷新通路（并发覆盖 refresh token），而且会把提供方 token 返回给浏览器。**能这样“拆掉框架的一部分”而不影响其余功能，说明框架的边界清晰**——它是可组合的库，不是需要我绕着走的黑盒。这也是我选它而不是 NextAuth 的一个重要原因：NextAuth 的 token 刷新与回调定制在历史上更绕（尤其 v4 的 `jwt` callback + `account` 表语义），改造成本高。

7. **类型与错误语义更干净**：`getAuth().handler(request)` 就是一个标准 `Request → Response` 函数（`api/auth/[...all]/route.ts:2-3`），我可以直接放进 Next.js App Router 的 route handler，不需要为框架搭一个特殊的 catch-all 约定。这让我能把业务 API 写成自己的 `api()` 包装（`http.ts:5-30`），两份守卫各管一段、职责清晰。

8. **为什么不自写 session（决定性理由）**：自写唯一的好处是完全可控。代价是我要实现：密码学安全的随机 token → 哈希后落库（不能明文存）→ Cookie 属性正确 → 常量时间比较 → 会话固定攻击防护 → 滑动过期策略 → 并发登录/登出 → 撤销。**其中任意一条写错都是静默漏洞**，而我的项目价值在于 GitHub 更新聚合，不在重新发明 session。用成熟库把“已知正确”的部分拿走，把精力留给“令牌续期与并发”这种真正属于本项目的难题——事实上我的 `github-auth.ts` 有 254 行，全部花在续期状态机、锁、指纹和错误分类上，**没有一行花在 session 上**。

9. **反面补充（显得不是盲目站队）**：Better Auth 我付出的是“多一层依赖 + 它自己的默认值要读懂”。例如我必须知道它在**非生产环境**会用公开默认密钥（`create-context.mjs:79`），所以我加了 `config.ts` 的生产校验（`:41-47`）；我必须知道 `disabledPaths` 才关掉那三个端点；我必须知道它把 `profile.id` 当 `accountId`（`social-providers/github.mjs:13`）才能让允许名单对上。**选型不是“框架帮我搞定”，而是“框架给的默认值我审过一遍并接受了”**。

### 11.2 “令牌为什么必须加密存”

1. **它不是“数据”，是“凭据”**。数据库里大多数列泄露了顶多是隐私问题，`accessToken` 泄露是**身份与权限问题**——拿到它就能以用户身份调 GitHub API。用同一张表的 `items`/`preferences` 的敏感性做类比是错的，它们不是一个量级。

2. **refresh token 的价值高于 access token，且存活期长 1000 倍**。本项目 access token 是 8 小时量级（`docs/12-github-auth-renewal.md:7` 明确“8 小时”），refresh token 是半年量级（`refresh_token_expires_in: 15552000` 秒 = 180 天，见 `tests/integration/github-auth.test.ts:43`）。明文存 refresh token = **半年期免密后门，且攻击者可以静默轮换续命**。不加密的话，“今晚数据库备份被传出去”和“半年内持续被读取用户数据”是同一件事。

3. **数据库泄露的路径远多于密钥泄露**：备份文件、`pg_dump` 导出、从库、误授的 `SELECT` 权限、日志采集、误挂的卷、BI 工具、开发同事的本地快照。而 `BETTER_AUTH_SECRET` 只存在于进程环境（生产由 systemd/Docker 注入，见 `docs/05-operations-and-quality.md:88`）。**加密把“单点泄露即失守”变成“两点同时泄露才失守”**。

4. **攻击成本不对称**：拿到 `account` 表导出还只是 hex 字符串；要变成 token 必须**同时**拿到密钥并知道算法。本项目用的是 `symmetricEncrypt`（XChaCha20-Poly1305）派生自 `SHA-256(BETTER_AUTH_SECRET)`——攻击者即使知道算法，没有密钥也无法解密。这是纯粹的“抬高地攻击者成本”，成本极低（一行配置），收益明确。

5. **纵深防御：应用层漏洞不会直接变成凭据泄露**。如果哪天出现 SQL 注入或某个越权读，攻击者最可能拿到的是“能读表”。此时密文让他还需要绕过应用层去取环境变量，而后者一般在不同的信任边界里。

6. **做到位的具体细节**（比“我加密了”更有说服力）：
   - **AEAD 而不是裸流密码**：Poly1305 tag 让密文篡改可检测（`crypto/index.mjs:30-39`）；
   - **managed nonce**：nonce 随机生成并前置，**不会因为同一密钥重复 nonce 而崩掉 ChaCha20-Poly1305 的安全性**——这是我用库而不是自己 `createCipheriv` 的核心理由；
   - **指纹不落明文**：失败状态用 `SHA-256(密文)` 做指纹（`github-auth.ts:22-25`），所以连 `system_state` 表里都没有可反推的材料；
   - **测试断言明文不入库**：`expect(row.accessToken).not.toContain('new-access')`（`tests/integration/github-auth.test.ts:72`）；
   - **解密失败降级而不崩溃**：`catch { return fail('reconnect_required') }`（`github-auth.ts:142-143`），用户看到“重新连接”，而不是 500 或 crypto 堆栈。

7. **诚实交代它的边界**（面试官会认同这种清醒）：`SECURITY.md:9` 明写“数据库与密钥同时泄露时，加密无法继续提供有效保护”。对称加密不解决“两个都丢”的场景——那是 KMS/HSM/信封加密要解决的问题（用 KMS 的 data key 加密、密钥不出 KMS）。本项目是个人本机 MVP，选对称加密 + 环境变量密钥是**成本与收益的合理点**；如果要做多人 SaaS，下一步就是把 `BETTER_AUTH_SECRET` 换成 KMS 托管的密钥或至少引入 keyring 版本化（`symmetricEncrypt` 已经支持 `{keys, currentVersion}` 信封形式——我这次传的是 string，所以没用上，但升级路径是现成的）。

### 11.3 “允许名单为什么用数字 ID”

1. **它是 GitHub 侧不可变的主键**。`profile.id` 是数字，永不改变；`login`（用户名）可以被用户随时修改，且**改名后旧用户名会被 GitHub 释放**，别人可以注册。用 `login` 做白名单 = 攻击者把自己改名成白名单里的名字就能进（或至少造成“改名即掉线”的运维故障）。

2. **框架本身就是用数字 ID 做主键的**。Better Auth 的 GitHub provider 定义 `accountSubject: ({ profile }) => profile.id`（`@better-auth/core/dist/social-providers/github.mjs:13`），所以 `account."accountId"` 存的就是数字 id。我的白名单只要做同构比较（`String(profile.id)` / `row.accountId`），**不需要任何映射表或额外查询**。如果用用户名，我就要多维护一列“login ↔ id”的映射，且这个映射本身会过期。

3. **比较的确定性**：数字 ID 没有大小写、没有 Unicode 规范化、没有前后空格歧义。用户名字符串比较需要考虑 `Torvalds` vs `torvalds`、以及 GitHub 允许的连字符规则。数字 ID 的 `String(x)` 比较是**精确且唯一的**。

4. **三道闸门的一致性**（这是最实际的理由）：我的白名单要在三个地方判断——OAuth 回调（`auth/index.ts:31`）、每次请求（`auth/index.ts:60`）、GitHub 读取凭据前（`github-auth.ts:48-52`）。三处都必须用**同一个等价值**判断，否则会出现“回调让你进、Worker 却不给你同步”这类不一致。数字 ID 是这三处唯一都天然可得的字段（回调有 `profile.id`，session 路径能从 `account.accountId` 读到，Worker 路径也只有 `account.accountId`）。**如果用用户名，第三处（Worker）根本拿不到 username**——`account` 表里没有 login 列，只有 `accountId`。这一条基本锁死了方案。

5. **fail closed 的默认行为**：`ALLOWED_GITHUB_USER_IDS` 未配置时 `''.split(',')` → `['']`，永远不会匹配任何数字 ID，所以“忘记配置 = 谁都不能登录”，而不是“谁都能登录”（`auth/index.ts:16,31,59`）。这一点在 `docs/05-operations-and-quality.md:52` 被表述为“允许名单面向个人试用”，而 `config.ts:44` 强制生产环境必须非空。

6. **可审计性**：运维在 `.env.local` 里写 `ALLOWED_GITHUB_USER_IDS=12345,67890` 时，数字 ID 是**指向唯一实体的稳定标识**，不会因为某人改昵称而在日志里对不上号。`docs/05-operations-and-quality.md:44` 把“不是用户名”明确写进配置表，就是为了防止后来者图方便填 login。

7. **补充一个"为什么不用邮箱"**：邮箱可以改、可以设隐私、`user:email` 可能返回空（provider 代码里显式做了 `profile.email` 为空时从 `/user/emails` 兜底，见 `github.mjs:71-76`），且邮箱不是 GitHub 的不可变主键。数字 ID 是 `/user` 必然返回、且永不变化的字段。

---

## 附录 A：本次分析读取的文件清单（只读）

| 类别 | 文件 |
| --- | --- |
| 认证核心 | `src/server/auth/index.ts`、`src/server/http.ts`、`src/server/config.ts` |
| 令牌 | `src/server/connectors/github-auth.ts`、`src/server/connectors/github-user.ts`、`src/server/connectors/github.ts` |
| 路由 | `src/app/api/auth/[...all]/route.ts`、`src/app/api/bootstrap/route.ts`、`src/app/api/settings/route.ts`、`src/app/api/items/[id]/state/route.ts`、`items/[id]/translation/route.ts`、`items/[id]/summary/retry/route.ts`、`subscriptions/route.ts`、`subscriptions/[id]/route.ts`、`subscriptions/[id]/sync/route.ts`、`trending/route.ts`、`trending/translation/route.ts`、`github/connection/route.ts`、`health/live/route.ts`、`skills/local/route.ts` |
| 数据层 | `src/server/db/client.ts`、`src/server/db/store.ts`、`src/server/subscriptions/service.ts`、`drizzle/0001_initial.sql` |
| 页面/组件 | `src/app/[[...path]]/page.tsx`、`src/components/login.tsx`、`src/components/github-connection.tsx`、`src/server/feed/bootstrap.ts`、`src/shared/types.ts` |
| Worker | `src/worker/main.ts` |
| 配置/构建 | `next.config.ts`、`package.json`、`compose.yaml`、`.gitignore`、`.env.example`、`.env.local`（仅键名）、`scripts/demo.ts`、`scripts/start-web.mjs`、`scripts/clean-standalone-env.mjs` |
| 文档 | `SECURITY.md`、`docs/05-operations-and-quality.md`、`docs/12-github-auth-renewal.md` |
| 测试 | `tests/config.test.ts`、`tests/github-user.test.ts`、`tests/integration/github-auth.test.ts`、`tests/e2e/github-auth.spec.ts`、`playwright.auth.config.ts` |
| 依赖源码（为确认框架默认值） | `better-auth@1.7.4/dist/{crypto/index.mjs,cookies/index.mjs,api/index.mjs,api/middlewares/origin-check.mjs,api/routes/callback.mjs,oauth2/utils.mjs,oauth2/state.mjs,context/create-context.mjs,adapters/index.mjs}`、`@better-auth/core@1.7.4/dist/{social-providers/github.mjs,oauth2/utils.mjs}`、`@better-auth/kysely-adapter@1.7.4/dist/index.mjs`、`better-call@1.4.0/dist/router.mjs` |

**未执行任何写操作；未修改任何项目文件；报告中所有密钥值均以 `***` 替代，未读取或输出任何真实凭据明文。**
