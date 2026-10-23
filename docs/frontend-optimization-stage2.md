# 前端优化阶段 2 记录

日期：2026-10-23

## 开发契约

- 用户流程：从侧栏或移动底部导航切换页面、打开更新详情、使用 onboarding 深链接。
- 主操作：导航切换、详情返回、浏览器后退和添加订阅入口。
- 页面模式：应用壳层 + 数据列表/详情导航框架。
- 数据假设：不改变路由、API、权限和 bootstrap 数据；只统一客户端路由状态与可访问性语义。
- 状态矩阵：当前页、详情页、`/onboarding`、桌面侧栏、移动导航、键盘焦点。
- 响应式与无障碍：当前导航暴露 `aria-current=page`；路由切换后将焦点放到标题；详情页标题显示为“更新详情”；移动导航保留所有主要入口。

## 变更

- `src/components/reader-app.tsx`：为路由标题增加可聚焦的 live region；详情页使用正确标题；移动导航补充 `type` 和 `aria-current`。
- `src/components/sidebar.tsx`：侧栏主导航、订阅管理和设置入口补充 `aria-current`。
- `src/components/feed-list.tsx`：暴露列表面板 ref 和滚动回调，配合阶段 1 的 feed 上下文恢复。
- `tests/e2e/reader.spec.ts`：覆盖详情返回保留筛选、onboarding 路由映射和导航焦点落点。
- `tests/e2e/sync-status.spec.ts`：将离线同步提示断言限定到 `.sync-service-banner`，避免与全局 toast 的合法 `role=status` 冲突。

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm lint` | 通过，退出码 0 |
| `pnpm exec vitest run --config vitest.unit.config.ts` | 通过，5 个文件、17 个测试 |
| `pnpm test:e2e` | 通过，29 个 demo 浏览器测试 |

浏览器检查确认桌面和 390px/768px 窄布局无横向溢出；侧栏和移动导航都能标识当前页；点击导航后标题获得焦点，详情返回和 onboarding Dialog 的键盘流程可完成。

## 阶段 2 结论

阶段 2 的壳层导航、焦点和移动入口已通过验证，可以进入阶段 3。
