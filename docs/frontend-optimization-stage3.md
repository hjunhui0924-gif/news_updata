# 前端优化阶段 3 记录

日期：2026-10-23

## 开发契约

- 用户流程：在更新列表中搜索、筛选、清除筛选、标记已读并打开详情；在详情中切换摘要、对照翻译和原文。
- 主操作：阅读列表、返回列表、收藏、生成/重试摘要、生成/重试翻译、打开来源。
- 数据假设：保持 bootstrap、任务队列和详情路由契约不变；客户端按任务类型分别解释摘要与翻译状态。
- 状态矩阵：真实空列表、筛选无结果、已有结果、选中卡片、已读/未读、摘要 pending/success/error、翻译 pending/success/error、窄屏详情。
- 响应式与无障碍：列表卡片暴露选中状态；空状态给出下一步动作；tab 使用 `aria-controls`/`aria-labelledby` 和 roving tabindex，支持方向键、Home、End；异步状态使用邻近的 live heading 与错误提示。

## 变更

- `src/components/feed-list.tsx`：区分真实空列表和筛选无结果，提供清除筛选按钮，补充选中卡片 `aria-pressed`，移除无条件显示的来源按钮。
- `src/components/reader-app.tsx`：传递底层内容数量，分别计算摘要/翻译任务的 busy 和失败状态；清除筛选会同时重置未读条件。
- `src/components/item-detail.tsx`：补齐 tab 与 panel 的 ARIA 关系和键盘导航；摘要、翻译分别显示 pending、失败和重试按钮。
- `src/app/globals.css`：移除已不再使用的移动来源按钮规则。
- `tests/e2e/reader.spec.ts`：覆盖空列表、筛选清除、tab ARIA 关联和键盘操作。
- `tests/e2e/ai-state.spec.ts`：覆盖摘要/翻译独立的 pending、failed 和 retry 状态。

## 验证

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过，退出码 0 |
| `pnpm lint` | 通过，退出码 0 |
| `pnpm test` | 通过，29 个文件、159 个测试 |
| `pnpm test:e2e` | 通过，32 个 demo 浏览器测试 |

浏览器验证确认 390px 和 768px 阅读详情无横向溢出；列表筛选可清除；真实空列表与筛选无结果提供不同文案；详情 tab 可通过鼠标和键盘切换；摘要和翻译的排队、失败与重试状态互不串扰。

## 阶段 3 结论

阶段 3 的主阅读流、详情状态和响应式/无障碍验收已通过，可以进入阶段 4。
