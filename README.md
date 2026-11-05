# 知更 / NEWSROOM

在一个网页里查看你关注的 GitHub 项目、开发者与 YouTube 频道更新。按平台筛选、阅读原文、保存已读和收藏；需要时再使用中文摘要或对照译文。

**当前阶段：服务器邀请试用准备完成。** 多用户边界与生产容器已通过本机隔离验证，实际服务器的域名、HTTPS 和 OAuth 回调仍需部署后确认。YouTube 已验证真实账号连接、关注读取、频道导入、首次同步和访问凭据自动续期；完整内容生命周期仍未验收，持续同步、真实简介翻译及撤销后重连仍待验证。G4 持续使用验收暂缓。[上线与验收范围](docs/26-server-invitation-trial.md) · [YouTube 真实验收](docs/25-youtube-live-acceptance.md)

![全部更新：统一时间线、平台筛选与来源标识](docs/assets/reader-feed-demo.png)

> 本页截图由当前应用实际渲染，全部使用标明的演示数据，不包含真实用户信息，不代表源站发布记录或真实 OAuth、模型服务验收。

## 第一次使用：访问已经部署好的站点

普通使用者不需要安装项目、填写 API Key 或配置服务器。向部署者获取站点地址并确认自己的 GitHub 账号已受邀，然后按以下步骤操作。

1. **登录**：打开站点，点击 GitHub 登录，在 GitHub 官方页面完成授权后返回。应用不接收你的 GitHub 密码；若提示未获准访问，请让部署者核对你的 GitHub 稳定数字 ID，不能用用户名代替。
2. **添加第一批关注**：打开右上角「添加订阅」或左侧「订阅管理」。可以输入 `owner/repo` 添加项目、添加开发者，或从自己的 Star / 关注列表中选择导入。第一次建议先添加少量来源。
3. **等待首次同步**：在订阅管理查看同步进度。同步由后台 Worker 执行，不是添加后立即有内容；项目没有符合范围的正式 Release 时也可能为空。刷新页面或「刷新内容」只更新站内显示，不会替代后台采集。
4. **开始阅读**：进入「全部更新」，先用 GitHub / YouTube 平台筛选缩小范围，再按类型、未读或关键词查找。点击条目查看详情，可以切换列表 / 分栏布局，标记已读或收藏。手机端使用底部导航与返回入口。
5. **可选：连接 YouTube**：进入「添加订阅 → YouTube 关注 → 连接 YouTube 账号」，在 Google 官方页面授权，返回后读取自己的关注、选择频道并导入。需要站点运营者先配置 Google OAuth；普通用户不填写客户端密钥。连接成功不等于已导入频道，导入后才会进入同步流程。
6. **调整阅读偏好**：打开「偏好设置」，调整紧凑列表和显示时区，再点击「保存偏好」。摘要、全文译文和视频简介译文取决于站点是否启用 AI；未启用时仍可阅读原文及访问源站。

站内订阅、已读和收藏只保存在本应用，不会替你 Star、Follow 或修改源站频道订阅。退出网页登录不等于撤销平台授权；YouTube 连接可以在其连接入口断开。没有邮件或浏览器推送。

## 界面预览

### 分栏阅读

![桌面分栏阅读：左侧扫描更新，右侧阅读摘要和原文](docs/assets/reader-demo.png)

### 添加来源与项目搜索

![添加订阅弹窗：不同订阅方式保持稳定尺寸](docs/assets/project-search-demo.png)

### 阅读偏好与手机布局

![偏好设置：阅读选项、保存状态和按钮清晰分隔](docs/assets/settings-demo.png)

<img src="docs/assets/reader-mobile-demo.png" alt="手机端全部更新，使用演示数据" width="390" />

## 功能与范围

| 功能            | 当前行为                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub 项目     | 跟踪正式 Release 及已收录版本说明的修改，不包括普通提交、PR 或 Issue                                                                            |
| GitHub 开发者   | 跟踪其新建公开非 fork 仓库，以及本人发布的正式 Release，包含组织项目                                                                            |
| Star / 关注导入 | 分页选择、去重导入、部分失败重试；可每 5 分钟发现新增公开 Star，取消 Star 不自动删除站内订阅                                                    |
| YouTube 关注    | 使用自己的 Google 账号连接、读取关注并导入频道；展示公开视频信息、作者提供的视频简介、按需简介对照翻译及原站观看入口，不搜索或推荐 YouTube 内容 |
| 聚合阅读        | 统一时间线、日期分组、平台和来源标识、筛选、搜索、已读、收藏、桌面分栏及手机导航                                                                |
| AI 辅助         | 中文摘要、原文依据、按需译文、缓存、用户及整站预算；默认关闭真实模型                                                                            |
| 更多工具        | GitHub Trending、站内未读简报、账号自己 Star 项目中的 Skill；服务器不向用户开放本机 Skill 文件目录                                              |
| 邀请试用        | GitHub 数字 ID 准入、用户数据隔离、操作限频、后台队列轮次、生产容器、健康检查及自动备份                                                         |

## 本地快速体验：无需账号或密钥

准备 **Node.js 24+、pnpm 11、Docker Desktop / Docker Compose v2**。Docker 运行 PostgreSQL 17，Web 和 Worker 在本机运行。

```powershell
git clone https://github.com/hjunhui0924-gif/news_updata.git
cd news_updata
pnpm install --frozen-lockfile
# 先打开 Docker Desktop，或确认 Docker Engine 正在运行
pnpm demo
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，按照上方阅读流程体验。首次启动自动创建 `.env.local`、生成本机随机密钥、启动数据库、执行迁移并写入 24 条标记的演示内容，再启动 Web 与 Worker。演示内容和译文是预编样本，不是实时 AI 输出；真实 AI 默认关闭，不需要 GitHub 登录。

Ctrl+C 停止本次启动的应用进程，数据库保留。再次运行 `pnpm demo` 可继续使用；已有 `.env.local` 不会被覆盖。如果该文件已经设为 `APP_MODE=live`，请使用下一节的真实账号流程。

已有 PostgreSQL 17 时，复制 `.env.example` 为 `.env.local`，填写自己的 `DATABASE_URL`、保持 `APP_MODE=demo`，执行 `pnpm demo --no-docker`。本地 `compose.yaml` 只负责数据库；整套服务器部署使用独立的 `compose.production.yaml`。

## 本机连接自己的账号

1. 复制 `.env.example` 为 `.env.local`，设置 `APP_MODE=live`、数据库连接和随机 `BETTER_AUTH_SECRET`（至少 32 字符）。不要提交该文件。
2. 在 GitHub 创建自己的 OAuth App，Homepage URL 设置为 `http://127.0.0.1:3000`，回调设置为 `http://127.0.0.1:3000/api/auth/callback/github`。
3. 填写 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`ALLOWED_GITHUB_USER_IDS`。允许名单使用稳定数字 ID，多个 ID 以逗号分隔。`GITHUB_READ_TOKEN` 可留空；公网部署拒绝共享令牌。
4. 启动数据库、迁移、Web 与 Worker：

```powershell
docker compose up -d --wait db # 已有自己的 PostgreSQL 时可跳过
pnpm db:migrate
pnpm dev
# 另开一个终端
pnpm worker:dev
```

然后打开本机网页，用 GitHub 登录，添加来源并等待同步。真实模式不需要执行 `pnpm db:seed`；建议为 Demo 和真实模式使用不同数据库。

需要连接 YouTube 时，在 Google Cloud 启用 YouTube Data API v3，创建 Web 应用 OAuth 客户端，配置回调 `http://127.0.0.1:3000/api/platforms/youtube/callback`，将客户端 ID / Secret 填入 `.env.local`，重启 Web 和 Worker，再从网页连接。个人关注读取不需要 `YOUTUBE_API_KEY`。若 OAuth 应用处于测试状态，需允许相应 Google 测试用户；后台服务器也必须能访问 Google API。[完整配置与边界](docs/19-youtube-account-following.md)

## 部署到服务器供其他人试用

使用生产配置，不复制开发者个人 `.env.local`、数据库、备份或 `work/`。新服务器从空库开始，各受邀用户登录后自行导入关注。

准备域名、可访问外部平台的 Linux 服务器、Docker Engine / Compose v2，以及服务器专用的 OAuth 客户端。Node.js 24 用于运行配置生成器，也可用 Node 24 容器运行。

```bash
# 替换为自己的 HTTPS 域名和受邀 GitHub 数字 ID
node deploy/prepare-env.mjs https://news.your-domain.example 123456,789012
# 在服务器编辑 deploy/server.env，填写 OAuth 配置，保管好生成的秘密

docker compose --env-file deploy/server.env -f compose.production.yaml config --quiet
docker compose --env-file deploy/server.env -f compose.production.yaml build
docker compose --env-file deploy/server.env -f compose.production.yaml up -d --wait
```

配置生成器不会覆盖已有文件。生产配置包含独立数据库、迁移、Web、Worker、Caddy HTTPS 和每日备份；数据库不发布公网端口。先配置域名解析和 80/443，再核对生产回调：

```text
GitHub:  https://你的域名/api/auth/callback/github
YouTube: https://你的域名/api/platforms/youtube/callback
```

启动后从服务器外访问 HTTPS，用两个受邀账号检查登录、来源导入、同步和阅读状态隔离，再开始小范围邀请。备份仍在同一台主机，异机备份与健康告警需另外配置。单 Web / 单 Worker 为当前验证范围，不作生产容量承诺。

**完整步骤、邀请变更、备份恢复、更新和回滚要求见 [服务器邀请试用版上线指南](docs/26-server-invitation-trial.md)。** 不要随意更换已用的认证密钥，也不要用 `down -v` 处理普通重启。

## AI 配置

普通用户无需提供模型密钥。部署者可配置兼容 Chat Completions 的模型地址、API Key、模型名、实际输入 / 输出单价，再开启 `LLM_ENABLED=true` 并重启 Web 与 Worker。本机使用 `.env.local`，服务器使用 `deploy/server.env`。

模型关闭、预算不足或服务失败时仍保留原文阅读。启用后相关公开正文会发送到所配置的模型服务；预算为应用估算，不能替代供应商账户硬额度。视频简介翻译只处理作者文字，不代表字幕或视频全文。[模型设置与费用](docs/05-operations-and-quality.md#模型配置)

## 常见问题

| 情况                    | 建议操作                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| 登录后提示未获准访问    | 让部署者核对 GitHub 数字 ID，并重新创建 Web / Worker 应用更新后的邀请名单        |
| 连接 YouTube 按钮不可用 | 让部署者检查 Google OAuth 配置；普通用户无需填写 API Key                         |
| 授权后仍提示失败        | 按页面错误与诊断编号排查；不要公开完整回调地址、Cookie、令牌或密钥               |
| 导入后暂时没有更新      | 查看订阅同步状态、Worker 与来源范围；没有正式 Release 或符合窗口的视频时可以为空 |
| 提示操作过频            | 根据提示稍后重试；外部操作与本地阅读限额分开，未耗尽的阅读操作仍可使用           |
| 没有摘要或译文          | 可能未启用模型、预算受限、正文为空或过长；先读原文，失败后可按页面提示重试       |
| 本机 3000 端口被占用    | 启动器不会终止其他程序；停止自己之前启动的服务，或调整 `APP_URL` 端口            |

## 开发与验证

技术栈：Next.js 16 / React 19 / TypeScript 5.9、Tailwind 4、Radix、PostgreSQL 17、Drizzle、pg-boss、Better Auth、Vitest 与 Playwright。精确版本以锁文件为准，不需要 Redis。

```powershell
pnpm typecheck
pnpm lint
pnpm test               # 独立 news_test，需 PostgreSQL
pnpm test:e2e           # 完整 Demo 回归，独立 news_e2e_test
pnpm test:e2e:server    # 邀请试用相关浏览器回归，使用独立构建目录
pnpm build             # Web、Worker、生产迁移和纯 Node bundle 检查
pnpm worker:check      # 仅检查现有 Worker 产物，不调用外部服务
```

测试库可被清理，不能保存有价值的数据；浏览器测试关闭真实 OAuth 与模型凭据。Windows 优先使用已安装 Chrome；其他环境先安装 Playwright Chromium。浏览器套件、类型检查与构建按顺序运行，避免争用生成目录。[贡献与测试约定](CONTRIBUTING.md)

本轮文档发布前验证：289 项单元 / 数据库测试、完整 110 项浏览器测试、类型、Lint 和 Linux 生产镜像构建通过，5 张公开截图已更新。此前的服务器准备还完成了隔离部署与恢复演练；这些结果不是远程上线或长期使用验收。范围和结果见 [文档发布记录](docs/27-documentation-release.md) 与 [服务器试用验收](docs/26-server-invitation-trial.md)。

### 目录导航

| 路径                                 | 内容                                         |
| ------------------------------------ | -------------------------------------------- |
| `src/app/`、`src/components/`        | 页面、阅读器、订阅、账号连接与设置           |
| `src/server/`、`src/worker/`         | 用户鉴权、平台适配、同步、AI、队列与后台进程 |
| `src/shared/`                        | 前后端共用类型、平台及信息流规则             |
| `drizzle/`                           | 0001–0007 数据库迁移                         |
| `deploy/`、`compose.production.yaml` | 生产配置生成、HTTPS、健康检查、备份及恢复    |
| `scripts/`、`tests/`                 | 启动、维护、构建和隔离测试                   |
| `docs/assets/`                       | README 当前应用截图，全部使用演示数据        |
| `docs/`                              | 需求、架构、路线、边界及各轮验收记录         |

## 当前保留事项

- G4 仍等待至少 7 天真实持续使用及源站抽样；目前不宣称已经完成。
- YouTube 完整平台内容生命周期存在缺口，持续同步、真实简介翻译与撤销后重连仍待验收，按用户决定暂缓；不因登录成功或部署通过而记为完成。
- GitHub 仓库默认每 15 分钟、开发者每 30 分钟检查；YouTube 默认每 180 分钟检查。需要后台 Worker 持续运行，不是实时推送。
- 首次 YouTube 同步只收录近 30 天最多 20 条，每轮最多 250 项候选；不下载字幕、音视频或嵌入播放器。
- 全文 / 简介翻译上限 16000 字符，超限保留原文；GitHub 个人事件窗口有边界，不能保证历史回补。[订阅范围](docs/11-github-following-scope.md)
- Bilibili、X / Twitter、RSS 尚未接入；不支持私有仓库、邮件或公开注册。正式安全审计、服务器容量和异机容灾尚未验收。

## 文档导航

- [产品需求](docs/01-product-requirements.md) · [技术架构](docs/02-architecture.md) · [界面规范](docs/03-ui-design.md) · [领域词汇](CONTEXT.md)
- [开发路线](docs/04-development-plan.md) · [本地运行与模型设置](docs/05-operations-and-quality.md) · [安全与数据](SECURITY.md) · [变更记录](CHANGELOG.md)
- [服务器邀请试用与上线](docs/26-server-invitation-trial.md) · [文档与截图发布](docs/27-documentation-release.md) · [开发贡献](CONTRIBUTING.md)
- [聚合阅读器重构](docs/23-aggregation-reader-redesign.md) · [阅读体验复核](docs/24-reader-polish-review.md)
- [YouTube 账号配置](docs/19-youtube-account-following.md) · [真实闭环与生命周期验收](docs/25-youtube-live-acceptance.md) · [数据生命周期边界](docs/22-data-lifecycle-and-recovery.md)
- [平台适配层](docs/18-platform-adapters.md) · [优化路线](docs/20-aggregation-optimization-roadmap.md) · [历史实施与性能证据](docs/21-aggregation-optimization-progress.md)
