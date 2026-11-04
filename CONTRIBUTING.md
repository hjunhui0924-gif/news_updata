# 开发与贡献

## 环境

使用 Node.js 24+、pnpm 11、PostgreSQL 17。首次安装执行 `pnpm install --frozen-lockfile`，按 README 配置 `.env.local`。不要提交真实配置、日志、数据库导出或包含个人信息的截图。

演示入口为 `pnpm demo`；真实模式分别运行 `pnpm dev` 和 `pnpm worker:dev`。配置变更后重启两者。新开发者应先阅读 `AGENTS.md` 和 `docs/02-architecture.md`；修改 Next.js 代码前查阅当前依赖内置的 `node_modules/next/dist/docs/`。

## 工作流程

1. 明确当前模块的范围、接口和验收条件，再修改代码。当前优先完成 GitHub 主流程，其他平台属于后续规划。
2. 完成一个模块，先运行相关测试和类型检查，通过后再进入下一模块。
3. 行为变化应覆盖实际故障或用户流程，尤其是权限隔离、分页、并发、取消和失败恢复。低影响文案修改不需要机械补测试。
4. 收尾运行适用的检查，更新对应文档。说明真实服务联调、模拟接口测试和未验证限制，不能互相替代。

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

## 数据与测试隔离

- 单元/集成测试使用 `news_test`，可以通过 `TEST_DATABASE_URL` 指定另一座名字以 `_test` 结尾的数据库。自动创建测试库需要建库权限。
- 完整和增量浏览器测试统一在 3002 端口自动启动 Demo Web/Worker，使用独立 `news_e2e_test`，每轮重建该专用库并迁移/seed，真实 GitHub/模型凭据清空。不得在专用库中保存有价值的数据。
- 自定义 `E2E_DATABASE_URL` 必须为无查询参数/fragment 的本机连接，库名以 `_e2e_test` 结尾；不接受日常 `news` 或单元测试 `news_test`。已有数据库连接会阻止重建，脚本不强行终止其他连接。
- 各 Playwright 配置共享启动器、端口和隔离约束。完整测试、增量组合、类型生成和构建按顺序运行，避免争用生成目录和运行资源；`pnpm test:e2e:search` 可用于局部开发回归，提交前执行完整流程。
- Windows 优先使用系统 Chrome，可通过 `CHROME_PATH` 指定路径；其他环境安装 Playwright Chromium。
- `.next-e2e` 和测试产物已忽略。Next 测试/构建可能自动修改 `next-env.d.ts` 与 `tsconfig.json`，提交前判断是否为本次必要改动，勿连带还原他人的修改。
- `drizzle/*.sql` 是完整迁移依据。Auth/pg-boss 表不应被未经复核的 `db:generate` 输出覆盖。
- 日常库升级前先备份，再执行迁移；本机命令为 `pnpm db:backup`、`pnpm db:migrate`、`pnpm db:drill`，边界见 [维护说明](docs/17-database-maintenance.md)。恢复演练只操作本轮新建临时库，不覆盖源库。

## 改动约定

凭据只在服务端处理；GitHub 用户内的数据查询必须带用户约束；业务写接口使用现有 `api()` 包装处理会话和 Origin。新平台不能直接混入 GitHub 来源枚举。不要为搜索或订阅功能擅自增加 GitHub 写权限。

提交前检查 `git diff --check`、暂存文件和历史中的敏感信息。Pull Request 写明用户可见变化、验证命令、结果及尚未验证的场景。
