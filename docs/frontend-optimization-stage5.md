# 前端优化阶段 5 记录

日期：2026-10-23

## 开发契约

- 用户流程：查看 Trending 榜单、切换语言、刷新/重试、翻译简介并订阅项目；在 Skill 目录搜索、筛选、打开详情、阅读原文或 AI 内容。
- 主操作：语言选择、榜单刷新、翻译重试、Skill 来源切换、搜索/分类/标签筛选、详情返回和原文/摘要切换。
- 数据假设：保持 Trending、Skill 目录和 AI API 契约不变；详情读取失败时保留当前 Skill 并在详情页提供重试。
- 状态矩阵：榜单加载、旧快照、空榜单、接口失败、翻译 pending/success/error、Skill 目录加载/空结果、详情加载失败、AI 未启用/排队/成功/失败、长原文。
- 响应式与无障碍：Skill 来源和详情 tabs 暴露 ARIA 关系并支持方向键；翻译失败按钮提供重试语义；详情读取失败不丢失当前 Skill；移动布局保持无横向溢出。

## 变更

- `src/components/trending-panel.tsx`：单独记录简介翻译错误，失败后将按钮改为“重试翻译”。
- `src/components/skills-panel.tsx`：Skill 来源/详情 tabs 增加 `aria-controls`、`aria-labelledby`、roving tabindex 和键盘导航；详情读取失败显示详情级重试入口；切换 Skill 时重置详情视图。
- `tests/e2e/discovery.spec.ts`：覆盖 Trending 翻译失败与重试。
- `tests/e2e/skills.spec.ts`：覆盖详情 tab 语义、键盘切换和详情读取失败重试。

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm lint` | 通过，退出码 0 |
| `pnpm test` | 通过，29 个文件、159 个测试 |
| `pnpm test:e2e` | 通过，36 个 demo 浏览器测试 |

Trending 的旧快照、失败重试、语言切换和移动布局均通过验证；Skill 本地和 GitHub Star 来源、筛选、详情、原文/双语视图、AI 状态和详情恢复路径均通过验证。

## 阶段 5 结论

阶段 5 的 Trending 与 Skill 目录阅读流程已通过验证，可以进入阶段 6。
