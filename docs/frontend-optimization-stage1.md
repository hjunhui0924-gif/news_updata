# 前端优化阶段 1 记录

日期：2026-10-23

## 开发契约

- 用户流程：在现有阅读器中使用统一的按钮、焦点和状态视觉反馈。
- 主操作：按钮点击、异步提交、重试和取消操作。
- 页面模式：基础设计系统与共享 UI 原语。
- 数据假设：不改变 bootstrap、API、权限、路由或业务状态；`Button` 只负责呈现和阻止重复提交。
- 状态矩阵：正常、hover、focus-visible、active、disabled、loading/busy、success/error 由业务组件分别提供反馈；原语提供统一控制尺寸、焦点环和 busy/disabled 语义。
- 响应式与无障碍：保留现有断点；交互控件使用稳定尺寸和可见 focus-visible；按钮 loading 暴露 `aria-busy` 并禁用重复提交；保留 reduced-motion 规则。

## 变更

- `src/app/globals.css`：新增 surface、text、status、focus、shadow、radius、control height 和 motion 语义 token；统一基础按钮过渡与焦点环；补充危险按钮状态。
- `src/components/ui/button.tsx`：新增可选 `loading` 属性，自动设置 `aria-busy` 并在提交中禁用按钮。

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm lint` | 通过，退出码 0 |
| `pnpm exec vitest run --config vitest.unit.config.ts` | 通过，5 个文件、17 个测试 |
| `git diff --check` | 通过，退出码 0；仅有工作区既有的换行符提示 |
| `pnpm test` | 通过，29 个文件、159 个测试 |
| `pnpm test:e2e` | 通过，28 个 demo 浏览器测试 |

## 浏览器与回归验证

- `tests/e2e/reader.spec.ts` 新增详情返回上下文和 onboarding 回归；浏览器后退后搜索词保持，`/onboarding` 仍显示订阅面板并打开添加订阅 Dialog。
- 1440x1000、390x844 和 768x844 截图已生成并检查；列表/详情无横向溢出，移动返回和底部导航可用。
- 完整 demo E2E 覆盖键盘 Escape 关闭 Dialog、表单交互、移动端布局和页面错误检查；共 28 项通过。
- `tests/e2e/sync-status.spec.ts` 的离线提示断言改为定位 `.sync-service-banner`，避免与合法的全局 toast `role=status` 产生严格模式歧义。

## 阶段 1 结论

阶段 1 的实现、静态检查、数据库测试和浏览器门禁均已通过，可以进入阶段 2。
