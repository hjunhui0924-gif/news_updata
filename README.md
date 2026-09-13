# 知更 / NEWSROOM

一个面向个人的开发者更新阅读器：关注 GitHub 开发者和公开仓库，在网页查看更新、中文摘要、按需译文和原文。

当前版本：本地 MVP，2026-09-13。应用代码已实现；最终验证结果见 [验收记录](docs/07-mvp-validation.md)。**没有邮件功能，Docker 不是必需依赖。**

## 快速运行

准备 Node.js 24+、pnpm 11 和 PostgreSQL 17。使用 Docker Desktop 管理数据库时，先确保 Docker 已启动，然后在项目目录执行：

```powershell
pnpm install
pnpm demo
```

访问 http://127.0.0.1:3000 。首次启动会创建 `.env.local`、生成本地登录密钥、启动 PostgreSQL、执行迁移、写入 24 条标注的示例，再启动 Web 与 Worker。Ctrl+C 停止应用进程，保留数据库数据。

已有 PostgreSQL 时，复制 `.env.example` 为 `.env.local`，修改 `DATABASE_URL` 后执行：

```powershell
pnpm demo --no-docker
```

Docker Compose **只运行数据库**。Web 与 Worker 直接运行在本机；当前未提供整套应用的 Docker 镜像。演示启动器绑定 `127.0.0.1`，不是公开部署入口。

## 可以体验什么

- 今日精选、全部更新、搜索、类型/来源/未读筛选、收藏、批量已读。
- 桌面分栏阅读，手机和平板查看详情、返回列表；详情链接可刷新。
- 添加公开仓库以跟踪正式 Release；关注个人开发者以发现其新建的非 fork 公开仓库。
- 导入当前账号的 Star 仓库，支持分页、勾选、重复导入和部分失败重试；也支持导入公开关注列表（前 50 人）。
- 真实登录后每 5 分钟自动检查当前账号的公开 Star，新项目自动加入 Release 订阅；订阅管理可关闭或立即检查。
- 订阅暂停/恢复、重点标记、手动同步，以及 Worker 定时轮询。
- 中文摘要、原文依据、按需翻译和原文阅读；模拟数据明确标记为演示。
- 在设置页生成站内更新简报，查看服务状态并保存阅读偏好。

演示模式也可以添加真实 GitHub 订阅。真实 AI 默认关闭，演示译文是预先编写的样本，不代表真实模型效果。未配置模型时，真实更新保留原文，生成按钮会提示配置要求。

## 技术栈

Next.js 16.3.5 / React 19 / TypeScript 5.9、Tailwind 4、自定义 UI + Radix Dialog + Lucide、PostgreSQL 17、Drizzle、pg-boss、Better Auth、Octokit、Vitest、Playwright。安装版本以 `pnpm-lock.yaml` 为准。

## 开发命令

```powershell
pnpm dev                 # 网页，默认 127.0.0.1:3000
pnpm worker:dev          # 另一个终端启动后台任务
pnpm db:migrate          # 应用 SQL 迁移，可重复执行
pnpm db:seed             # 仅演示模式，首次写入样本
pnpm typecheck
pnpm lint
pnpm test                # 独立 news_test 数据库，需要 PostgreSQL
pnpm test:e2e            # 演示 Web + Worker 启动后运行
pnpm build              # 构建 Web 和 Worker
```

真实使用模式、登录与 AI 配置，以及生产启动约束见 [运行指南](docs/05-operations-and-quality.md)。`pnpm start` 是生产 Web 入口，不能用于绕过演示模式的生产限制。

## 文档

| 文档                                          | 内容                        |
| --------------------------------------------- | --------------------------- |
| [产品需求](docs/01-product-requirements.md)   | MVP 范围与数据覆盖          |
| [技术架构](docs/02-architecture.md)           | 模块、任务和实际数据模型    |
| [界面规范](docs/03-ui-design.md)              | 风格、布局和交互            |
| [开发路线](docs/04-development-plan.md)       | 分模块交付与后续工作        |
| [运行指南](docs/05-operations-and-quality.md) | Docker 可选启动、配置与测试 |
| [决策记录](docs/06-decisions.md)              | 选择依据和方案调整          |
| [验收记录](docs/07-mvp-validation.md)         | 已验证内容与限制            |

当前不包含 X/Twitter、RSS、PR/Issue/提交动态、私有仓库、邮件、浏览器推送和公开注册。GitHub OAuth 真实登录与 Star 导入已经实测；真实模型质量及生产部署仍待专项验证。详见 [Star 跟踪交付记录](docs/08-starred-tracking.md)。
