# Trending 发现与对照翻译

2026-09-13 增量开发记录。用户选择：全部领域，提供编程语言筛选；网页阅读更新，不加入邮件功能。

## 产品边界

- `/today` 今日精选负责发现：读取 GitHub Trending 每日仓库榜单，与个人 Star、重点订阅和更新流独立。按 GitHub 页面排名展示，不声称个性化推荐或质量评审。
- 语言选择读取对应语言的独立榜单，不是在全部榜单的少量结果中本地过滤。首版提供全部语言及 Python、TypeScript、JavaScript、Go、Rust、Java、C、C++、C#、Swift、Kotlin、Ruby、PHP。
- 卡片显示项目名称、原始简介、语言、总 Star、今日 Star 增量和来源。缺失的统计不填零。中文简介按点击生成并缓存，只翻译源简介，不虚构推荐理由。
- 「订阅更新」复用已有正式 Release 订阅，重复操作幂等，已暂停订阅明确标注。不会写入 GitHub Star。
- `/feed` 继续跟踪已有订阅。Trending 不自动导入全部热门项目，不把榜单条目插入个人更新流。
- 更新详情的「对照翻译」默认原文在上、中文在下。新结果保存显式对应关系；已有字符串译文全文对照，不通过数组下标猜配对。

## 技术实现

沿用 Next.js、React、TypeScript、PostgreSQL、现有 Worker 和千问配置。Cheerio 解析公开 HTML；remark/unified 解析 Markdown 块。统一 unified 依赖版本，避免同包不同版本的插件类型冲突。不需要新数据库、向量库或新的 Docker 服务。

### Trending 获取与快照

`src/server/connectors/trending.ts` 只访问固定 GitHub Trending 域名和白名单语言路径。来源为 `https://github.com/trending?since=daily`，**不是 GitHub REST 官方 Trending API**。15 秒超时，不跟随重定向；无榜单节点、异常仓库路径、页面过大等均视为失败，防止挑战页面覆盖有效数据。

`src/server/discovery/service.ts` 使用现有 `system_state` 表保存每种语言的快照。键为 `trending:daily:<language|all>`，包含 `repositories`、`fetchedAt`、`sourceUrl`、`language`、`stale`、`error`、`retryAt`。

- 24 小时 TTL，从成功抓取时间计算，不保证本地零点刷新。
- 实时模式 Worker 启动时和每分钟检查全部语言快照，到期才访问 GitHub。语言榜单在访问时按同样 TTL 获取。
- 页面每 5 分钟检查服务端快照；「刷新榜单」读取当前快照，不绕过缓存或失败冷却。
- 获取失败保留旧快照，标注旧时间及错误；无旧数据则显示错误和重试入口。失败冷却 15 分钟，避免持续访问上游。
- PostgreSQL 事务级 advisory lock 防止 Web/Worker 同时重复抓取。已有请求运行时返回旧快照或“正在刷新”提示。
- 切换语言会取消旧浏览器请求，过期响应不能覆盖当前选择。

### 简介翻译

`src/server/discovery/translation.ts` 使用现有 `callModel`、中文与完整性校验、`ai_usage` 预算账本。原文取自服务端快照，客户端只提交仓库名与语言，不能通过此接口提交任意长文。

缓存键包含仓库名、简介、模型、服务地址、thinking 配置和提示版本。成功结果写入 `ai_cache`，简介变化后重新生成。短期数据库租约防止并发请求重复计费；不在模型调用期间占用数据库连接。失败或截断结果不缓存；请求可能计费但无法确认时保留预算预留。AI 关闭时仍可读取已有缓存。

### 原文／中文配对

模型继续返回带 ID 的翻译片段；服务端验证所有 ID 恰好返回一次并恢复源顺序。`FeedItem` 增加可选 `translationBlocks: { original, translation: string | null }[]`，同时保留 `translation` 字符串供兼容。数据存在原有 JSONB 中，无需 SQL 迁移。

- 以原文 Markdown AST 的顶层块为配对边界，保留整个列表、表格、引用和代码块。
- 递归发现引用定义或脚注时保留全文解析上下文，避免跨段链接失效。
- 代码等无需翻译的块只显示一次；原始 HTML 不执行，图片保持现有禁用策略。
- 翻译缓存版本升级，旧字符串缓存不冒充显式配对。已有历史译文继续可读，不自动批量重新计费。
- 源内容哈希校验继续保护写入；来源更新时旧翻译随原有同步流程清除。
- 上限仍为 16000 字符。保留结构不等于保证模型语义完全正确，应对照原文核查。

## API

| 路径 | 方法 | 输入 / 返回 |
| --- | --- | --- |
| `/api/trending` | GET | `language` 查询参数；返回快照及已缓存中文简介 |
| `/api/trending/translation` | POST | `{ name, language }`；返回 `{ name, description, translation }` |
| `/api/subscriptions` | POST | 复用 `{ kind: "repo", input: "owner/repo" }` |

全部复用现有登录检查；写操作复用 Origin 检查。抓取错误与 AI 错误不返回环境变量、密钥或上游请求内容。

## 开发与验收

先完成对照模块、定向测试及桌面/手机验证，再接入 Trending。独立审查发现的松散列表编号、跨段/嵌套引用和订阅按钮过期状态均补充回归。

- 单元/集成测试：解析排名与计数、非法源、语言路径、持久缓存、失败保留、冷却恢复、并发锁、AI 校验、内容变化、缓存复用、预算与并发计费。
- 浏览器：`pnpm test:e2e:discovery`，使用系统 Chrome 和隔离的 3002 端口，覆盖 Trending 发现/语言切换/翻译/订阅/取消后刷新、旧快照/恢复、对照顺序/手机溢出及原有 Star 管理。
- 浏览器远程数据使用确定性 mock，不能作为真实 GitHub/模型端到端证明。
- 真实校验：本次全部榜单读取 19 个项目，Python 榜单读取 13 个项目；千问完成 `JustVugg/colibri` 简介翻译。为 `ningzimu/codex-ppt-skill` v0.6.0 生成了 4 个真实对照块。这些是本次快照，数量和榜单会变化。
- 最终结果：`pnpm test` 14 文件 / 92 项通过；`pnpm test:e2e:discovery` 7 场景通过；`pnpm typecheck`、`pnpm lint`、`pnpm build` 均通过。真实 Web 健康检查 200，未登录访问 Trending API 返回 401。

## 已知限制与后续

公开页面结构可能变化，快照会过期；没有将 GitHub 搜索结果伪装成 Trending 的备用路径。首版没有个性化打分、README 深度分析、项目质量判定或周/月榜单。下一步应先验证用户是否通过发现页找到并订阅有用项目，再考虑按兴趣筛选和基于证据的推荐理由。
