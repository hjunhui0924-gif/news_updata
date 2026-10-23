# 前端优化阶段 0 基线记录

日期：2026-10-23

本记录对应 `docs/frontend-optimization-plan.md` 的阶段 0。它描述当前代码基线和验证边界，不改变产品行为。

## 入口与当前行为

| 入口 | 当前实现 | 备注 |
| --- | --- | --- |
| `/login` | 服务端直接渲染登录页 | 不依赖 `ReaderApp`；live 模式是否可登录取决于 GitHub 配置 |
| `/today` | `ReaderApp` 的 Trending 发现页 | 需要 bootstrap、数据库和 Trending 接口 |
| `/feed` | 更新列表 + 详情双栏 | 列表筛选状态保存在组件内存中 |
| `/saved` | 收藏更新列表 + 详情双栏 | 与 `/feed` 共用列表组件 |
| `/subscriptions` | 订阅管理 | 包含添加订阅入口、同步状态和导入功能 |
| `/skills` | Skill 目录 | 详情和 AI 状态由独立组件处理 |
| `/settings` | 设置页 | 偏好保存和简报预览由异步请求完成 |
| `/onboarding` | 初始进入订阅页并自动打开添加订阅 Dialog | 初始加载有特殊映射；浏览器后退到该路径时没有同等映射，属于后续修复项 |
| `/items/:id` | 更新详情深链接 | 找不到条目由服务端返回 404 |

路由白名单位于 `src/app/[[...path]]/page.tsx`。数据读取统一经过 `bootstrap`，写操作通过 `/api` 路由完成。`ReaderApp` 使用原生 History API 管理视图和详情路径。

## 状态流基线

- 初始页面由服务端 `bootstrap(viewer)` 提供数据，客户端随后每 30 秒刷新一次；有 pending/running 任务时刷新间隔缩短为 1.5 秒。
- 选择条目会写入 `/items/:id`，并触发标记已读请求；列表返回会写回当前视图路径。
- 收藏、已读和 muted 使用乐观更新失败回滚；其他异步操作统一通过 `busy` 和 toast 反馈。
- 切换主导航会清空搜索、类型、来源、未读和选中条目。详情返回不会恢复进入详情前的筛选和滚动上下文，这是阶段 3 的明确回归项。
- `/onboarding` 仅在首次服务端进入时映射为 subscriptions；`popstate` 分支没有复用该映射，需在导航阶段统一。
- 通知、GitHub 连接、订阅导入、摘要和翻译分别有组件级状态，尚未形成统一的全局错误/成功反馈规范。

## 代码与自动化基线

已执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm lint` | 通过，退出码 0 |
| `pnpm exec vitest run --config vitest.unit.config.ts` | 通过，5 个文件、17 个测试 |

无法执行的检查：

- `pnpm test` 在 `tests/setup-db.ts` 连接 `127.0.0.1:54329` 时失败；这是 PostgreSQL 不可达，不是测试断言失败。
- `pnpm demo` 无法启动：当前 `.env.local` 为 `APP_MODE=live`，启动器拒绝以 live 配置运行 demo；尝试使用 demo 环境变量时 Docker Desktop Linux 引擎未运行。
- 因此本轮没有新增浏览器截图，也没有把既有 `docs/assets/reader-demo.png` 和 `project-search-demo.png` 当作本次运行证据。两张既有基线图片尺寸分别为 1440x1000 和 390x844。

## 初始问题清单

按影响排序：

1. **核心流程上下文恢复**：详情返回不恢复筛选和滚动位置；刷新/轮询后的列表上下文也没有 URL 持久化。
2. **路由状态一致性**：`/onboarding` 的初始渲染和 `popstate` 渲染不一致，存在回退后显示错误面板的风险。
3. **设计 token 分散**：`globals.css` 同时使用语义变量和大量字面颜色、尺寸、圆角，阶段 1 需要先收敛基础 token，避免模块改造继续复制字面值。
4. **反馈机制不统一**：toast、`role=status`、`role=alert` 和局部提示并存，需在阶段 1/6 定义边界并检查重复播报。
5. **运行验证依赖外部环境**：数据库和 Docker 不可用时，完整 Vitest、demo 和 E2E 无法复现；后续验证记录必须标注环境前提。

## 阶段 0 结论

代码入口、状态流和测试边界已锁定。当前 TypeScript、ESLint 和无数据库单元测试均通过；数据库依赖的集成测试和浏览器 demo 证据待 PostgreSQL/Docker 可用后补采。阶段 1 可以在不改变 API、权限和数据含义的前提下开始，优先处理语义 token、控件状态和焦点规则。
