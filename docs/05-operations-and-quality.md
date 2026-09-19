# 运行与质量指南

更新日期：2026-09-19。

## 本地运行：Docker 可选

要求 Node.js 24+、pnpm 11、PostgreSQL 17。推荐启动方式：

```powershell
pnpm install
pnpm demo
```

启动器首次补建 `.env.local` 并生成随机密钥（已有文件不覆盖），执行 `docker compose up -d --wait db`、迁移和演示种子，然后启动 Web 与 Worker。地址默认 http://127.0.0.1:3000 。端口已被占用时明确退出，不会终止其他程序。

已有 PostgreSQL 时手工创建数据库，在 `.env.local` 设置 DATABASE_URL，使用：

```powershell
pnpm demo --no-docker
```

数据库默认连接：`postgresql://news:news_local_only@127.0.0.1:54329/news`。Compose 端口仅绑定本机，密码仅适用于本地演示。Ctrl+C 停止启动器创建的应用进程，不删除数据库卷；停止本地数据库可用 `docker compose stop db`。当前不是整个应用的 Docker 部署。

需要热更新 Worker 时用独立终端：

```powershell
pnpm db:migrate
pnpm db:seed
pnpm dev
# 第二个终端
pnpm worker:dev
```

## 演示与真实模式

| 配置                                    | 用途                                             |
| --------------------------------------- | ------------------------------------------------ |
| APP_MODE=demo                           | 本地免登录演示，生产环境拒绝运行                 |
| APP_MODE=live                           | GitHub OAuth 与用户允许名单                      |
| APP_URL                                 | 浏览器访问源，也是写请求 Origin 与 OAuth 的基址  |
| DATABASE_URL                            | Web、Worker、迁移共用数据库                      |
| BETTER_AUTH_SECRET                      | 至少 32 字符的随机秘密，真实使用前更换示例占位值 |
| GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET | GitHub OAuth App 凭据                            |
| ALLOWED_GITHUB_USER_IDS                 | 允许登录的稳定数字 ID，逗号分隔，不是用户名      |
| GITHUB_READ_TOKEN                       | 可选，服务端公开数据读取 Token                   |
| SYNC_STAR_INTERVAL_MINUTES              | 当前登录账号公开 Star 列表检查间隔，默认 5 分钟  |

真实模式的 OAuth 回调为 `<APP_URL>/api/auth/callback/github`。将回调填入自己的 GitHub OAuth App，配置后重启 Web 与 Worker。OAuth 登录凭据和数据读取 Token 用途不同；采集优先使用 GITHUB_READ_TOKEN；未配置时，在服务端复用当前用户加密保存的 OAuth access token 读取公开数据。业务接口不向前端返回令牌。访问令牌距到期不足 60 秒或已到期时按需自动续期；只有刷新令牌失效、授权撤销等需要重新连接。网络失败保留重试，授权错误不再关闭订阅偏好。设置页提供状态和检查入口，详见 [授权续期](12-github-auth-renewal.md)。

没有配置真实 OAuth 凭据时登录流程未完成，不能将登录页面可见视为验证通过。演示固定用户的数据不会自动迁移到真实登录用户。

`.env.local` 已被 Git 忽略。公开运行前使用独立数据库账户、随机密钥和 HTTPS。允许名单面向个人试用，不等于完整多人 SaaS 权限体系。

## 模型配置

默认 `LLM_ENABLED=false`。启用需要设置以下全部字段：

```dotenv
LLM_ENABLED=true
LLM_API_BASE_URL=https://your-provider.example/v1
LLM_API_KEY=your-secret
LLM_MODEL=your-model
LLM_ENABLE_THINKING=auto
LLM_INPUT_USD_PER_MILLION=实际输入单价
LLM_OUTPUT_USD_PER_MILLION=实际输出单价
LLM_DAILY_BUDGET_USD=0.5
LLM_MONTHLY_BUDGET_USD=5
```

上面地址和单价是填写示意，不能直接调用。base URL 不包含 `/chat/completions`，请求路径由应用追加。模型须支持严格 JSON Schema 和 max_completion_tokens；部分兼容服务可能不支持，需实际验证。非本地模型地址要求 HTTPS。

`LLM_ENABLE_THINKING=auto` 默认不发送供应商特定参数；对支持该参数的 Qwen，可设为 `false` 关闭思考。开发者联调环境曾启用 Qwen3.8 Flash；新克隆默认关闭模型。具体价格快照及真实结果见 [AI 联调记录](09-ai-connection-status.md)。

费用按 UTC 日/月累计，独立于阅读显示时区。用量缺失或超时时保留保守估计。应用预算不能替代供应商账户硬额度，定价变化时需更新配置。默认参数不是报价或质量推荐。

摘要截取最多 16000 字符，翻译超过此长度会拒绝；README 保存上限 60000 字符。原文可在网页及 GitHub 核对。已抓取且模型禁用时的条目可在启用后手动生成摘要。

## 构建与生产进程

```powershell
pnpm build
# 以下仅适用于配置完整的 APP_MODE=live
pnpm start
# 第二个终端
pnpm worker:start
```

Next.js start 与 worker:start 均强制使用生产模式，启用生产配置校验，拒绝演示登录绕过。默认启动地址为 loopback，对外服务需自行配置 HTTPS 反向代理。构建成功不代表已公开部署或完成 OAuth/模型联调。

当前只提供本地运行与构建产物。生产进程守护、域名、备份计划和恢复演练未部署。数据库结构变化通过新增有序 SQL 迁移完成；手工检查迁移，特别是 Auth 和 pg-boss 管理的表。

## 测试

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e:search # 推荐：自动启动隔离端口的增量组合
pnpm test:e2e        # 基础演示流程，需要 demo Web/Worker
pnpm build
```

单元/集成测试默认使用独立 `news_test` 数据库，自动建库需要当前测试账户具有建库权限；可设置 TEST_DATABASE_URL，数据库名必须以 `_test` 结尾。测试不会清空演示数据库。

浏览器测试使用本地 demo 数据，会修改示例的已读、收藏和偏好。启动 Web 与 Worker 后执行；默认使用 Windows 已安装的 Chrome，可设置 CHROME_PATH。其他环境安装 Playwright Chromium：`pnpm exec playwright install chromium`。

`/api/health/live` 用于存活检查；Worker 心跳和费用出现在设置页。Web 在运行不代表 Worker 正在同步，应检查设置中的后台状态。

升级自动 Star 跟踪后先运行 `pnpm db:migrate` 应用 `0003_star_sync.sql`，再启动 Web 和 Worker。真实模式下 Worker 默认为允许名单中的已登录 GitHub 账号开启自动发现，用户关闭后不会被调度器重新打开。在「订阅管理 → Star 自动跟踪」查看上次结果、错误及下一轮时间，或点击「立即检查」。需保持数据库和 Worker 运行，浏览器可以关闭；这不是即时 webhook 推送。新 Star 先加入订阅，正式 Release 抓取随后执行；已有仓库的 Release 检查默认每 15 分钟。限流、排队和服务离线会延长等待，不能保证严格 5 分钟内完成。

## 已知运行限制

单用户规模下使用客户端全量个人 feed，未做大数据量压测。部分历史扫描分批完成；长时间离线、来源改名/删除和 GitHub 限制可能影响覆盖。ETag 尚未接入同步检查点。没有邮件、浏览器推送、X/RSS 用户功能、自动数据库备份和已验证的生产部署。X/RSS 当前只有路线预研文档，不应配置或启动不存在的适配器。

## 本地长期运行观察

可以使用 PowerShell 监测脚本进行本机几小时观察；默认时长为 2 小时：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\observe-live.ps1 `
  -DurationHours 2 `
  -IntervalSeconds 300 `
  -LogPath .\work\live-observation.jsonl
```

脚本每 5 分钟记录 Web 健康接口、PostgreSQL 容器状态、Worker 心跳、任务状态数量、失败任务数量、最长运行任务和订阅错误/限流状态。启动时已有失败任务数量作为基线，只有观察期间新增失败数量才产生 `new_failed_jobs` 告警；状态变化会写入同一 JSONL 文件。日志和观察目录被 Git 忽略，不会上传账号配置或业务数据。

该脚本是本机静默监测，不会向 Codex 对话或外部通知渠道发送消息。当前会话不能承诺观察结束后自动在聊天中提醒；需要查看进度时读取 `work/live-observation.jsonl`，或在 Codex 中请求重新检查。停止监测可使用启动后记录的 PowerShell 进程 ID 执行 `Stop-Process -Id <PID>`。
