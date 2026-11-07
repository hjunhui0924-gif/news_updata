# 阿里云全原生部署

适用于 Ubuntu 22.04 amd64、项目目录 `/home/admin/projects/news_updata`、外部端口 8003。不使用 Docker 或镜像；Node.js、PostgreSQL 和 systemd 都在服务器运行。本机可以关机。保留现有 8001 / 8002 及其他项目服务。

服务器使用 `APP_RUNTIME=native` + `DATABASE_RUNTIME=native`。本机开发与测试仍保留 `APP_RUNTIME=native` + `DATABASE_RUNTIME=docker`，`docker compose up -d --wait db` 启动本机数据库后，使用原 `pnpm demo`、`pnpm test` 等入口；两套环境独立，部署服务器不要求本机 Docker 常驻。

## 当前上线范围

先发布 `http://47.98.151.228:8003` 的空白访客工作台。`--preview` 生成 `APP_MODE=live`、原生空数据库、8003 监听和空 OAuth 配置，访客不读取任何账号数据；不会执行 Demo seed，不开启真实平台同步或付费 AI。`APP_URL` 暂时保持回环地址，仅用于满足现有生产配置约束；它不表示公网 HTTP 的 OAuth、会话或写操作已经受支持。根页面进入登录页，可点跳过，或直接访问 `/guest`。

HTTPS 和真实账号登录后续再配置，本轮不修改其安全校验。不要把预览配置用于已有真实账号数据库；如已有用户数据，应保留原 `BETTER_AUTH_SECRET` 和数据库连接配置。

## 1. 更新代码

```bash
cd ~/projects/news_updata
git pull --ff-only origin master
```

所有命令在服务器上运行；先前的镜像构建、传输、Compose 指令不再适用。保留旧环境文件和数据库；无需卸载 Docker，更不要操作其他项目的容器或端口。

## 2. 安装项目独立的 Node.js 24

不要替换服务器 `/usr/bin/node`：其他项目可能仍依赖 Node 20。以下使用已核对的 Node 24.15.0 Linux x64 官方包，放在 `/opt/newsroom-node24`，仅供本项目使用。

```bash
set -e
cd ~/projects/news_updata
sudo apt-get update
sudo apt-get install -y ca-certificates curl xz-utils
mkdir -p work/native-downloads
cd work/native-downloads
curl --http1.1 -fL --retry 3 -C - https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz -o node-v24.15.0-linux-x64.tar.xz
curl --http1.1 -fL --retry 3 https://nodejs.org/dist/v24.15.0/SHASUMS256.txt -o SHASUMS256.txt
grep ' node-v24.15.0-linux-x64.tar.xz$' SHASUMS256.txt > node-checksum.txt
test -s node-checksum.txt
sha256sum -c node-checksum.txt
sudo install -d -m 0755 /opt/newsroom-node24
sudo tar -xJf node-v24.15.0-linux-x64.tar.xz -C /opt/newsroom-node24 --strip-components=1
export PATH="/opt/newsroom-node24/bin:$PATH"
node --version
npm install --prefix "$HOME/.local/newsroom-tools" pnpm@11.19.0
export PATH="$HOME/.local/newsroom-tools/node_modules/.bin:$PATH"
pnpm --version
cd ~/projects/news_updata
```

如果 apt 提示旧 Docker 软件源缺少公钥，先修复/停用那个失败的软件源；本部署不依赖它，不要使用 `--allow-unauthenticated`。Node 下载仍需服务器能访问 nodejs.org；失败会停止，成功下载后无需本机提供镜像。

## 3. 安装 PostgreSQL 17

```bash
sudo apt-get install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt-get update
sudo apt-get install -y postgresql-17
sudo systemctl enable --now postgresql
pg_lsclusters
sudo -u postgres psql -h /var/run/postgresql -p 5432 -Atc 'SHOW server_version;'
```

核对 **5432 上的实例是 PostgreSQL 17 或更新版本**。如果其他旧实例已占用 5432，不要停掉其他项目数据库；先检查集群和依赖再调整。本安装器为防止连错库会拒绝旧版本。全原生应用通过 `127.0.0.1:5432` 连接，保留 PostgreSQL 默认回环监听和本机 TCP 的密码认证即可；不需要 Docker 网桥、修改防火墙开放 5432 或把 `listen_addresses` 设为 `*`。

## 4. 生成配置并构建

```bash
cd ~/projects/news_updata
export PATH="/opt/newsroom-node24/bin:$HOME/.local/newsroom-tools/node_modules/.bin:$PATH"
pnpm server:init --runtime native --preview
pnpm install --frozen-lockfile
APP_MODE=live APP_URL=http://127.0.0.1:8003 BETTER_AUTH_SECRET=build-only-placeholder-never-use-for-login ALLOWED_GITHUB_USER_IDS=0 pnpm build
```

`deploy/native.env` 自动生成独立随机数据库密码和登录密钥，不打印秘密，不覆盖已有文件。不要 `cat`、截图或提交这个文件。构建使用临时占位配置，实际运行配置由 systemd 单独加载，不复制到浏览器。服务器不得保留开发者个人 `.env.local` / `.env.production*`；这些文件会影响 Next 构建。

## 5. 安装系统服务并启动

```bash
sudo bash deploy/install-native.sh admin /opt/newsroom-node24/bin/node
```

安装器会执行以下操作：

- 首次复制 `deploy/native.env` 到 root 专用的 `/etc/newsroom/runtime.env`，后续保持已有配置；修改运行参数请显式编辑后者。
- 使用 PostgreSQL 本机 peer 管理连接创建专用 `news` 账号/数据库，通过本机 TCP 验证应用密码，不替换已有账号密码、权限或数据库内容。已有账号与配置不匹配会停止。
- 安装 `newsroom-migrate`、`newsroom-web`、`newsroom-worker` 服务；备份后停止本项目进程，运行迁移，成功后才启动 Web / Worker。
- 以 `admin` 运行应用，仅允许向项目 `.next` 目录写入缓存；非 root 应用进程、退出自动重启、开机启动。
- 安装 `newsroom-pg-backup.timer`，每日备份到 `/var/backups/newsroom`，保留 14 天并生成校验文件，安装时立即执行一次。

程序不会修改或重启服务器其他项目。Web / Worker 启动会等待健康检查；失败时用下节日志定位，不要重新生成密钥。首次空库安装也会生成备份，该文件仅证明可导出，不能代替后续有数据后的恢复演练。

## 6. 验收与日志

```bash
sudo systemctl status newsroom-web newsroom-worker --no-pager
curl --fail http://127.0.0.1:8003/api/health/ready
sudo systemctl list-timers newsroom-pg-backup.timer --no-pager
sudo journalctl -u newsroom-web -u newsroom-worker -u newsroom-migrate -n 100 --no-pager
```

浏览器访问 `http://47.98.151.228:8003` 或 `http://47.98.151.228:8003/guest`。期望数据库与迁移 ready、Worker online，访客信息流为空、功能入口可点击并提示登录。8003 已在阿里云安全组开放；8001/8002 不受影响。若宿主机另有防火墙，确认 8003 被允许。不要把原生数据库密码或完整日志发到公开渠道。

备份在同一服务器；需要异机保存时单独配置复制。恢复应先用独立数据库验证，不能把恢复脚本直接指向运行库。

## 后续更新

构建会修改当前 `.next` 文件，因此更新前先停止本项目，避免旧进程继续使用被替换的文件。普通更新允许短暂停机：

```bash
cd ~/projects/news_updata
git pull --ff-only origin master
export PATH="/opt/newsroom-node24/bin:$HOME/.local/newsroom-tools/node_modules/.bin:$PATH"
sudo systemctl start newsroom-pg-backup.service
sudo systemctl stop newsroom-web newsroom-worker
pnpm install --frozen-lockfile
APP_MODE=live APP_URL=http://127.0.0.1:8003 BETTER_AUTH_SECRET=build-only-placeholder-never-use-for-login ALLOWED_GITHUB_USER_IDS=0 pnpm build
sudo bash deploy/install-native.sh admin /opt/newsroom-node24/bin/node
curl --fail http://127.0.0.1:8003/api/health/ready
```

任一步失败应停止继续操作，修复后重新构建/安装。迁移失败时服务保持停止，不会自动回滚数据库；按迁移日志判断修复方法。保留升级前备份，正式用户使用前再补充发布目录切换等降低停机的流程。

## 后续接入真实账号

配置 HTTPS 域名与反向代理后，编辑 `/etc/newsroom/runtime.env` 中 `APP_URL=https://你的域名`、`APP_HOSTNAME=127.0.0.1`、受邀 GitHub 数字 ID 和 OAuth 客户端。Web / Worker 共用同一文件、数据库与稳定的 `BETTER_AUTH_SECRET`。OAuth 回调和外部网络验证参考 [服务器邀请试用指南](26-server-invitation-trial.md)。不要重新运行生成器来轮换已使用的密钥。

## 验证记录与边界

代码包含不依赖 Docker / PostgreSQL 的部署测试配置：`pnpm exec vitest run --config vitest.deployment.config.ts`。语法、服务生成和构建验证不等同于已在阿里云完成远程上线，实际结果以服务器健康检查、日志与浏览器页面为准。

2026-11-07 本轮验证：26 项部署/配置测试、类型检查、lint、Web / Worker / 迁移生产构建、Shell 语法检查均通过。WSL 的 `systemd-analyze verify` 通过服务配置校验（使用 PostgreSQL 服务占位，仅校验 unit 语法与依赖结构）；Windows 原生 Node 启动生产 Web 后，`/login`、`/guest` 返回 200，未登录数据接口拒绝访问。未在该阿里云服务器执行安装；PostgreSQL 初始化、真实迁移与 systemd 进程运行须按上面的服务器命令验收。

官方安装资料：[PostgreSQL Ubuntu 仓库](https://www.postgresql.org/download/linux/ubuntu/)、[Node.js 24.15.0 官方包及校验文件](https://nodejs.org/en/download/archive/v24.15.0)。
