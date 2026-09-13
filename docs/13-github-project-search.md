# GitHub 公开项目搜索

更新日期：2026-09-13。

## 用户操作

打开「添加订阅 → 搜索项目」，输入名称或关键词，选择最相关、Star 最多或最近更新排序。结果展示仓库名称、原始简介、语言、Star 数、归档标识和当前用户的订阅状态。点击「在知更中订阅」后使用既有本地 Release 订阅流程，不修改 GitHub Star 或 Follow。

原「项目仓库」入口仍支持直接输入 `owner/repo` 或 GitHub 仓库链接。信息流中的搜索仍只检索已收录的更新；新增入口搜索 GitHub 公开仓库，不是 GitHub 代码搜索。搜索结果不会自动调用 AI 翻译。

## 契约与限制

`POST /api/github/repositories/search`：`{query:string,page?:number,sort?:'relevance'|'stars'|'updated'}`。关键词去首尾空白后为 1–200 字符，页码 1–50，默认第一页、相关度排序。接口复用 Origin、会话、账号允许名单及 GitHub 自动续期。

通过固定 GitHub REST `/search/repositories` GET 请求获取结果，关键词由 URLSearchParams 编码，附加 `is:public` 并再次过滤私有仓库。每页 20 个，最多浏览 GitHub 提供的前 1000 个匹配；页面显示总匹配数和窗口上限，`incomplete_results` 单独提示。限流或接口异常显示错误，不伪装成零结果。

搜索不写订阅或任务。结果按当前用户的仓库稳定 ID 标记已订阅；点击订阅走原 `/api/subscriptions`，保留幂等、名额上限、后端重新确认公开性和事务队列。订阅成功后刷新页面失败也保留已订阅标识，不诱导重复点击。

请求期间禁用搜索输入、翻页和对话框切换。分页使用已提交的关键词与排序，不使用尚未提交的输入草稿；翻页回到结果列表顶部。搜索失败保留上一次结果及其关键词，支持重试。

## 验证记录

- 连接器 3 项测试：查询编码与公开过滤、1000 条窗口/部分结果、限流传播。
- 真实 PostgreSQL 集成测试：搜索不创建任务，已订阅标识按用户隔离。
- 浏览器组合 10 项通过，新增场景覆盖搜索、翻页、订阅、重复禁用、限流重试、无结果及手机布局；手机截图已查看。浏览器使用模拟接口。
- 真实 GitHub 搜索 `AI agent`，按 Star 排序，成功返回公开项目，包含 `obra/superpowers`、`NousResearch/hermes-agent` 等；只进行读取，没有添加这些示例项目的订阅。
- `pnpm test`：20 个文件、126 项通过；`pnpm lint`、`pnpm typecheck`、`pnpm build`（Web 与 Worker）均通过。

没有增加数据库迁移、GitHub 写权限、模型调用或其他平台接入。
