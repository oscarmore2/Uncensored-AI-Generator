# Railway 部署指南

面向公开仓库的部署说明：产品描述采用中性表述（AI 创作平台 / UGC / 内容审核），不含业务敏感文案。真实密钥请只配置在 Railway Variables 或本地 `.env`（勿提交 git）。

## 产品说明（对外表述）

本项目是一个 **Next.js 全栈 AI 创作平台**，主要能力包括：

- 用户注册登录、点数余额、AI 生成任务
- 公共作品展示（Explore）、创作中心（Make）
- 内容审核台（Moderator）、运营管理台（Admin）
- 多渠道充值（Stripe / NOWPayments）、VIP 订阅
- 对象存储（S3 兼容）、Webhook 与审计日志

## 架构

| 组件 | 方案 | 说明 |
|------|------|------|
| 应用 | Railway Web Service | 根目录设为 `web` |
| 数据库 | Railway PostgreSQL | 通过 `DATABASE_URL` 注入 |
| 媒体存储 | 外部对象存储（R2 / S3 等） | 可选；env 或 `/admin/oss` 配置 |
| 日志 | Railway Logs | 平台内置 |
| 第三方 API | Zen / Stripe / NOWPayments / Telegram | Webhook 回调至公网 `APP_URL` |

无需单独部署 Serverless / 函数计算：支付与可选 Webhook 由 Next.js API Routes 在同一服务内处理。

```text
用户 / Webhook  -->  Railway Web (Next.js)
                         |
                    DATABASE_URL
                         v
                 Railway PostgreSQL

可选：R2/S3 存媒体，Telegram 做运营通知
```

## 前置条件

- 代码已 push 到 GitHub
- [Railway](https://railway.app) 账号（GitHub 登录）
- 本地生成密钥（不要写入仓库）：

```bash
openssl rand -hex 32   # AUTH_SECRET，至少 32 字符
```

- 按需准备：Zen Creator、Stripe、NOWPayments、对象存储、Telegram Bot

## 1. 创建 Railway 项目

1. **New Project** → **Deploy from GitHub repo** → 选择本仓库。
2. Web 服务设置（**二选一**，推荐 A）：
   - **A. 设置 Root Directory（推荐，构建更快）**
     - **Settings → Root Directory** = `web`
     - 使用 `web/railway.toml` 中的 build/start/release 命令
   - **B. 不改 Root Directory（仓库根目录部署）**
     - 保持根目录为 `/`
     - 仓库已包含根目录 `railway.toml` + `web/Dockerfile`，Railway 会用 Docker 构建
     - 若仍报 `Railpack could not determine how to build`，见下方「常见错误」
3. 同一 Project 内 **+ New** → **Database** → **PostgreSQL**。
4. Web 服务 **Variables** 中 **Reference** Postgres 的 `DATABASE_URL`（建议带 `?sslmode=require`）。

## 2. 构建 / 启动 / 数据库

Web 服务 **Settings → Deploy**：

| 配置项 | 值 |
|--------|-----|
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Release Command | `npm run db:deploy` |

`postinstall` 已包含 `prisma generate`。Release Command 在每次部署前同步表结构。

Railway 会注入 `PORT`，`npm start` 会自动监听。

## 3. 环境变量

完整变量名见 [`.env.example`](../.env.example)。在 Railway **Variables** 中配置，**不要提交真实值**。

### 必填

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Reference 自 Railway Postgres |
| `AUTH_SECRET` | `openssl rand -hex 32` 生成 |
| `APP_URL` | `https://<服务>.up.railway.app` 或自定义域名（无末尾 `/`） |
| `DEMO_MODE` | 生产环境设为 `false` |

### 生产推荐

| 变量 | 说明 |
|------|------|
| `ZEN_API_KEY` | AI 生成 API（或在 `/admin/zen` 配置多账户） |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 或在 `/admin/stripe` 配置 |
| `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET` | 可选兜底；推荐部署后在 `/admin/nowpayments` 保存数据库配置 |
| `RESEND_API_KEY` / `EMAIL_FROM` | 邮箱注册验证；`EMAIL_FROM` 必须来自 Resend 已验证域名 |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | 首个管理员（密码 ≥ 8 位），首次登录自动创建/提升 |
| `CREDIT_PACKAGES` / `VIP_PRICE` | 有默认值，可按需覆盖 |

### 对象存储（推荐）

| 变量 | 说明 |
|------|------|
| `OSS_ENDPOINT` / `OSS_REGION` / `OSS_BUCKET` | S3 兼容端点与桶 |
| `OSS_ACCESS_KEY_ID` / `OSS_SECRET_ACCESS_KEY` | 访问密钥 |
| `OSS_PUBLIC_BASE_URL` | 对外 CDN 域名 |
| `OSS_MIRROR_ZEN_RESULTS` | 是否镜像生成结果到桶（默认 `true`） |
| `MEDIA_CLEANUP_SECRET` | 自动媒体清理内部接口密钥，使用 `openssl rand -hex 32` 生成 |
| `MEDIA_CLEANUP_BATCH_SIZE` | 每次每类清理数量（默认 `100`，最大 `500`） |

### 可选

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 充值、注册、失败退款等通知 |
| `ZEN_CREDIT_RATIO` / `ZEN_MONTHLY_BUDGET` | 管理端成本估算 |
| `ZEN_WEBHOOK_SECRET` | 预留 Zen 回调校验 |
| `GOOGLE_SITE_VERIFICATION` | Google Search Console HTML meta 验证值，仅填写 `content` 内容 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google 登录；不配置则前端自动隐藏入口 |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Facebook 登录；不配置则前端自动隐藏入口 |
| `FACEBOOK_GRAPH_VERSION` | Graph API 版本，默认 `v25.0`，升级时显式修改 |
| `IPINFO_TOKEN` | 可选；注册时补充国家级 IP 地理推测，Core/Plus 可返回地区与城市 |
| `IPINFO_API_BASE` | 默认 `https://api.ipinfo.io` |

### 登录与邮箱验证配置

1. 在 Resend 验证发信域名，创建 API Key，并将 `EMAIL_FROM` 设置为该域名下的发件地址。
2. 在 Google Cloud Console 创建 Web OAuth 客户端，配置授权域名、同意屏幕及精确回调：
   `{APP_URL}/api/auth/oauth/google/callback`。
3. 在 Meta for Developers 创建应用并启用 Facebook Login，配置精确回调：
   `{APP_URL}/api/auth/oauth/facebook/callback`，上线前将应用切换到 Live 并完成平台要求。
4. 自定义域名或 `APP_URL` 发生变化时，必须同步更新两个平台的回调地址并重新部署。

密码注册账户在邮箱验证成功前不能登录。Google 使用已验证邮箱时可与同邮箱账户安全绑定；
Facebook 不会仅凭同邮箱自动合并既有账户，以避免账户接管。

### NOWPayments 数据库配置

部署后进入 `/admin/nowpayments`，填写 API Key、IPN Secret 和 API Base URL，并激活配置。
密钥会使用 `AUTH_SECRET` 派生的 AES-256-GCM 密钥加密保存。创建新订单时优先使用激活的
数据库配置；只有没有可用激活配置时才回退 `NOWPAYMENTS_*` 环境变量。IPN 验签会尝试
所有已保存配置和 ENV Secret，以兼容切换配置前创建的未完成订单。

注册所在地识别会优先使用 Cloudflare、Vercel 等平台可信请求头；配置 `IPINFO_TOKEN`
后可补充查询。该结果只是出口 IP 的粗略推测，VPN、代理、Tor、移动网络或企业网关
会导致偏差，无法用于恢复用户的真实地址，也不采集 GPS 坐标。

## 4. 首次部署

1. 保存 Variables，等待自动部署（或手动 **Redeploy**）。
2. 查看 Build / Deploy / Release 日志，确认 `prisma generate`、`next build`、`prisma db push` 成功。

## 自动媒体清理 Cron

在同一 Project 新增独立 Cron Service，Root Directory 设为 `web`，Config File 设为
`/railway.cleanup.toml`，并与 Web Service 共享 `APP_URL`、`MEDIA_CLEANUP_SECRET`。
默认每小时（UTC）运行 `npm run cleanup:media`。完整说明见
[`MEDIA_CLEANUP.md`](MEDIA_CLEANUP.md)。
3. **Networking → Generate Domain** 获取临时 HTTPS 域名。
4. 将 `APP_URL` 更新为该域名并重新部署（若已变更）。

## 5. Webhook 配置

`APP_URL` 稳定后，在第三方后台配置：

| 服务 | 回调地址 | 常见事件 |
|------|----------|----------|
| Stripe | `{APP_URL}/api/payments/webhook` | `checkout.session.completed`、`customer.subscription.deleted` |
| NOWPayments | `{APP_URL}/api/payments/crypto/webhook` | IPN 支付状态回调 |
| Zen（预留） | `{APP_URL}/api/zen/webhook` | 若后续自建中转 |

签名密钥写入 env 或管理端对应账户配置。可在 `/admin/webhooks` 查看投递记录。

## 6. 验收清单

- [ ] 首页 `/` 可访问
- [ ] 种子管理员可登录并进入 `/admin`
- [ ] 邮箱注册可收到验证邮件，链接仅可使用一次，验证后自动登录
- [ ] Google / Facebook 登录回调与生产域名完全一致
- [ ] `/admin/settings` 显示 `DEMO_MODE=false`
- [ ] 配置 Zen 后可提交生成任务
- [ ] Stripe（及 NOWPayments，若启用）测试支付 + Webhook 入账
- [ ] 可选：OSS 镜像、Telegram 通知、`/admin/audit` 有记录
- [ ] `robots.txt`、`sitemap.xml`、Manifest 和网站图标均返回 200
- [ ] Search Console 已验证，并提交 `{APP_URL}/sitemap.xml`

```bash
curl -sS "$APP_URL/api/public/works" | head
```

SEO 与 Google 收录的完整设置见 [`SEO_GOOGLE.md`](SEO_GOOGLE.md)。

## 7. 自定义域名（可选）

1. Railway → **Custom Domain** → 添加主机名。
2. 按提示配置 DNS（CNAME），等待 TLS 生效。
3. 更新 `APP_URL` 及所有 Webhook URL。
4. 媒体 CDN（`OSS_PUBLIC_BASE_URL`）建议使用独立子域名。

## 8. 运维说明

- **日志**：Railway 服务日志；应用内 `/admin/audit`（管理操作）、`/admin/webhooks`（回调）。
- **扩缩容**：建议先 **单实例** 运行；进程内限流不跨实例共享，水平扩展前需 Redis 等共享存储。
- **Schema 变更**：保持 Release Command 为 `npm run db:deploy`；若改用正式迁移，再切换为 `prisma migrate deploy`。
- **费用粗估**（小流量）：Web + Postgres 约数十 USD/月；对象存储通常较低。

## 9. 提交 GitHub 前检查

- [ ] `.env` 已 gitignore，仓库内仅有 `.env.example` 占位项
- [ ] 文档与代码中无真实 API Key、密码、数据库连接串
- [ ] 生产 `DEMO_MODE=false`，`AUTH_SECRET` 足够强
- [ ] 公开文档使用中性产品描述，不含业务敏感文案

## 10. 快速上线（约 30 分钟）

1. Railway 连 GitHub，Root Directory = `web`
2. 添加 Postgres，Reference `DATABASE_URL`
3. 配置 build / start / release 命令
4. 填写 `AUTH_SECRET`、临时 `APP_URL`、`DEMO_MODE=false`、`ZEN_API_KEY`、`SEED_ADMIN_*`
5. 生成域名 → 更新 `APP_URL`
6. 登录 `/admin`，检查 Stripe / NOWPayments / Zen / OSS 配置
7. 配置 Webhook → 完成一笔测试支付

## 常见错误

### `Railpack could not determine how to build the app`

日志里若出现根目录只有 `backend/`、`web/` 等文件夹，说明 Railway **在仓库根目录**扫描，而 `package.json` 在 `web/` 内。

**解决办法（推荐）：** Settings → **Root Directory** = `web` → Save → Redeploy。

### `"/web": not found`（Docker 构建失败）

原因：**Root Directory = `web`** 时，构建上下文里已经没有 `web/` 子目录，但旧 Dockerfile 还在执行 `COPY web/...`。

**解决办法：**

1. 确认 **Root Directory = `web`**
2. `git pull` / push 最新代码（`web/Dockerfile` 已改为直接 `COPY package.json`，不再 `COPY web/...`）
3. Redeploy

若坚持 **Root Directory 留空**，请用仓库根目录的 `Dockerfile`（会 `COPY web/...`），不要混用两套路径。

### 构建成功但 502 / 应用起不来

- 检查 `AUTH_SECRET` 是否已配置（≥ 32 字符）
- 检查 `DATABASE_URL` 是否 Reference 到 Postgres
- 查看 Deploy Logs 中 `prisma db push` 是否报错

## 相关文档

- 本地开发与 API 概览：[README.md](../README.md)
- 环境变量模板：[`.env.example`](../.env.example)
