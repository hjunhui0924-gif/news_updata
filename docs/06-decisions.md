# 决策记录

2026-09-18，按本次实际实现和跨平台预研更新，替代早期仅有方案的描述。

| 决策                  | 当前采用                                        | 原因与代价                                            |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| ADR-001 个人优先      | GitHub 稳定用户 ID 允许名单；数据保留 user_id   | 控制首版范围，多人开放前仍需专项审查                  |
| ADR-002 阅读器        | 浅色分栏、中文摘要优先、独立原文与按需译文      | 先优化扫描和阅读，深色与复杂个性化后置                |
| ADR-003 运行架构      | Next.js + 独立 Node Worker + PostgreSQL/pg-boss | 可靠后台不依赖浏览器，也无需额外 Redis                |
| ADR-004 人与项目分开  | 作者发现新仓库，仓库跟踪正式发布                | 关注某人不代表监控其参与的所有项目                    |
| ADR-005 公开 API 轮询 | Release、用户仓库、README                       | 无需对方安装 webhook，有轮询延迟和覆盖限制            |
| ADR-006 AI 只处理内容 | 摘要、证据、翻译；精选与简报用规则              | 原文和模型不能修改订阅或向外发消息                    |
| ADR-007 网页提醒      | 信息流、未读、站内简报                          | 用户明确不需要邮件，取消 SMTP/Mailpit 与发送链路      |
| ADR-008 可替换模型    | 服务端兼容 Chat Completions HTTP 接口           | 默认禁用真实调用，实际供应商需验证结构化输出          |
| ADR-009 跨平台后置    | GitHub 先实现；X 先预研，RSS 作为低风险候选       | 当前不是已完成的跨平台产品，避免过早复制 GitHub 语义   |
| ADR-010 Docker 可选   | Compose 只启动 PostgreSQL；Web/Worker 用 pnpm   | 降低启动复杂度，已有数据库可完全不用 Docker           |
| ADR-011 MVP 数据模型  | 用户级条目 + JSONB 内容 + 关系身份/阅读状态     | 比初稿全局来源关系模型更小，规模化时需迁移            |
| ADR-012 依赖兼容      | Node 24、pnpm 11、TS 5.9、ESLint 9              | 当前安装组合通过验证；较新 TS/ESLint 与现有插件不兼容 |
| ADR-013 平台扩展准入  | 先完成 GitHub G1–G4 与 7 天试用，再决定 X/RSS     | 降低内容覆盖、授权、费用和数据模型风险               |

## 未解决的外部配置

真实 GitHub OAuth App、允许登录 ID、模型供应商/密钥/单价、实际关注名单、公开服务器与域名均由实际使用环境决定。缺少这些不阻止本地 Demo，但不能声称真实登录、真实 AI 质量和生产部署已经验收。

## 产品借鉴与资料

前期产品方向参考：

- [Folo](https://follow.is/)：多来源聚合与 AI 阅读入口。
- [NewReleases](https://newreleases.io/)：软件正式版本跟踪与过滤。
- [Readwise Reader](https://readwise.io/read)：阅读、收藏和详情结构。
- [Inoreader](https://www.inoreader.com/)：订阅组织和信息过滤。

这些参考来自前期官网与部分公开反馈，不是登录后的完整实测，不作效果排名；没有复用其品牌或源码。

实施参考已安装的 Next.js `node_modules/next/dist/docs`、GitHub REST API、Better Auth、Drizzle 与 pg-boss 文档。AI 请求字段核对了 [Chat Completions API 参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)；字段核对不能代替选定服务上的真实调用验证。

后续改动来源语义、数据模型或提醒范围时同步更新需求、架构、运行指南和验收记录，避免方案与代码不一致。

跨平台领域词汇见根目录 [CONTEXT.md](../CONTEXT.md)，X/RSS 预研边界见 [跨平台扩展预研](14-platform-expansion.md)。
