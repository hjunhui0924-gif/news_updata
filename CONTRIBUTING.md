# 开发与贡献

## 环境

使用 Node.js 24+、pnpm 11、PostgreSQL 17。首次安装执行 `pnpm install --frozen-lockfile`，按 README 配置 `.env.local`。不要提交真实配置、日志、数据库导出或包含个人信息的截图。

演示入口为 `pnpm demo`；真实模式分别运行 `pnpm dev` 和 `pnpm worker:dev`。配置变更后重启两者。新开发者应先阅读 `AGENTS.md` 和 `docs/02-architecture.md`；修改 Next.js 代码前查阅当前依赖内置的 `node_modules/next/dist/docs/`。

## 工作流程

1. 明确当前模块的范围、接口和验收条件，再修改代码。平台读取遵循 `PlatformAdapter`；GitHub 与 YouTube 已有实现，后续平台复用同步、存储和阅读状态流程，详见 [适配层](docs/18-platform-adapters.md)。
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
- 完整和增量浏览器测试统一在 3002 端口自动启动 Demo Web/Worker，使用独立 `news_e2e_test`，每轮重建该专用库并迁移/seed，真实 GitHub/YouTube/模型凭据清空。不得在专用库中保存有价值的数据。
- 自定义 `E2E_DATABASE_URL` 必须为无查询参数/fragment 的本机连接，库名以 `_e2e_test` 结尾；不接受日常 `news` 或单元测试 `news_test`。已有数据库连接会阻止重建，脚本不强行终止其他连接。
- 各 Playwright 配置共享启动器、端口和隔离约束。完整测试、增量组合、类型生成和构建按顺序运行，避免争用生成目录和运行资源；`pnpm test:e2e:search` 可用于局部开发回归，提交前执行完整流程。
- Windows 优先使用系统 Chrome，可通过 `CHROME_PATH` 指定路径；其他环境安装 Playwright Chromium。
- `.next-e2e`、`.next-trial-e2e` 与 `output/` 等测试产物已忽略。若现有 Demo 占用默认测试构建目录，可设置 `E2E_ISOLATED_BUILD=server-trial` 后运行完整套件，或使用 `pnpm test:e2e:server`；仍需串行运行浏览器套件。Next 测试/构建可能自动修改 `next-env.d.ts` 与 `tsconfig.json`，提交前判断是否为本次必要改动，勿连带还原他人的修改。
- `drizzle/*.sql` 是完整迁移依据。Auth/pg-boss 表不应被未经复核的 `db:generate` 输出覆盖。
- 日常库升级前先备份，再执行迁移；本机命令为 `pnpm db:backup`、`pnpm db:migrate`、`pnpm db:drill`，边界见 [维护说明](docs/17-database-maintenance.md)。恢复演练只操作本轮新建临时库，不覆盖源库。

## 改动约定

凭据只在服务端处理；各平台用户内的数据查询必须带用户约束；业务写接口使用现有 `api()` 包装处理会话和 Origin。新平台在注册表和契约中扩展，以平台 + 来源种类 + 外部 ID 区分身份，保留 GitHub 历史键兼容。不要为搜索或订阅功能擅自增加源站写权限。YouTube 简介不进入全文 AI；接口 fixtures 不替代真实密钥/网络验证。

提交前检查 `git diff --check`、暂存文件和历史中的敏感信息。Pull Request 写明用户可见变化、验证命令、结果及尚未验证的场景。

## 更新公开截图

在专用 Demo 环境启动应用后执行 `pnpm screenshots http://127.0.0.1:3000`，端口可替换为自己的 Demo 地址。脚本拒绝 live 账号和非本机地址，使用合成数据与模拟搜索，不调用真实提供方或付费模型，生成 `docs/assets/` 下的五张 README 图片。需要本机安装 Chrome 或 Playwright Chromium。

逐张查看截图，确认无真实账号、密钥、错误浮层、横向溢出或过渡状态。不要用设计草图替代当前应用截图。README、功能边界、最新验收、截图和源代码必须在同一次发布中保持一致。
