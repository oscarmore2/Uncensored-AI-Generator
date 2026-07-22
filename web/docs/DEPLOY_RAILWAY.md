# Railway 部署指南

面向公开仓库的部署说明：产品描述采用中性表述（AI 创作平台 / UGC / 内容审核），不含业务敏感文案。真实密钥请只配置在 Railway Variables 或本地 `.env`（勿提交 git）。

## 产品说明（对外表述）

本项目是一个 **Next.js 全栈 AI 创作平台**，主要能力包括：

- 用户注册登录、点数余额、AI 生成任务
- 公共作品展示（Explore）、创作中心（Make）
- 内容审核台（Moderator）、运营管理台（Admin）
- 多渠道充值（Stripe / Cryptomus）、VIP 订阅
- 对象存储（S3 兼容）、Webhook 与审计日志

## 架构

| 组件 | 方案 | 说明 |
|------|------|------|
| 应用 | Railway Web Service | 根目录设为 `web` |
| 数据库 | Railway PostgreSQL | 通过 `DATABASE_URL` 注入 |
| 媒体存储 | 外部对象存储（R2 / S3 等） | 可选；env 或 `/admin/oss` 配置 |
| 日志 | Railway Logs | 平台内置 |
| 第三方 API | Zen / Stripe / Cryptomus / Telegram | Webhook 回调至公网 `APP_URL` |

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

- 按需准备：Zen Creator、Stripe、Cryptomus、对象存储、Telegram Bot

## 1. 创建 Railway 项目

1. **New Project** → **Deploy from GitHub repo** → 选择本仓库。
2. Web 服务设置：
   - **Root Directory** = `web`
   - 可选 **Watch Paths** = `web/**`
3. 同一 Project 内 **+ New** → **Database** → **PostgreSQL**。
4. Web 服务 **Variables** 中 **Reference** Postgres 的 `DATABASE_URL`（建议带 `?sslmode=require`）。

## 2. 构建 / 启动 / 数据库

Web 服务 **Settings → Deploy**：

| 配置项 | 值 |
|--------|-----|
| Build Command | `npm run build` |
| Start Command | `npm start` |
| Release Command | `npx prisma db push` |

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
| `CRYPTOMUS_*` | 可选，加密货币充值 |
| `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | 首个管理员（密码 ≥ 8 位），首次登录自动创建/提升 |
| `CREDIT_PACKAGES` / `VIP_PRICE` | 有默认值，可按需覆盖 |

### 对象存储（推荐）

| 变量 | 说明 |
|------|------|
| `OSS_ENDPOINT` / `OSS_REGION` / `OSS_BUCKET` | S3 兼容端点与桶 |
| `OSS_ACCESS_KEY_ID` / `OSS_SECRET_ACCESS_KEY` | 访问密钥 |
| `OSS_PUBLIC_BASE_URL` | 对外 CDN 域名 |
| `OSS_MIRROR_ZEN_RESULTS` | 是否镜像生成结果到桶（默认 `true`） |

### 可选

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 充值、注册、失败退款等通知 |
| `ZEN_CREDIT_RATIO` / `ZEN_MONTHLY_BUDGET` | 管理端成本估算 |
| `ZEN_WEBHOOK_SECRET` | 预留 Zen 回调校验 |

## 4. 首次部署

1. 保存 Variables，等待自动部署（或手动 **Redeploy**）。
2. 查看 Build / Deploy / Release 日志，确认 `prisma generate`、`next build`、`prisma db push` 成功。
3. **Networking → Generate Domain** 获取临时 HTTPS 域名。
4. 将 `APP_URL` 更新为该域名并重新部署（若已变更）。

## 5. Webhook 配置

`APP_URL` 稳定后，在第三方后台配置：

| 服务 | 回调地址 | 常见事件 |
|------|----------|----------|
| Stripe | `{APP_URL}/api/payments/webhook` | `checkout.session.completed`、`customer.subscription.deleted` |
| Cryptomus | `{APP_URL}/api/payments/crypto/webhook` | 支付状态回调 |
| Zen（预留） | `{APP_URL}/api/zen/webhook` | 若后续自建中转 |

签名密钥写入 env 或管理端对应账户配置。可在 `/admin/webhooks` 查看投递记录。

## 6. 验收清单

- [ ] 首页 `/` 可访问
- [ ] 种子管理员可登录并进入 `/admin`
- [ ] `/admin/settings` 显示 `DEMO_MODE=false`
- [ ] 配置 Zen 后可提交生成任务
- [ ] Stripe（及 Cryptomus，若启用）测试支付 + Webhook 入账
- [ ] 可选：OSS 镜像、Telegram 通知、`/admin/audit` 有记录

```bash
curl -sS "$APP_URL/api/public/works" | head
```

## 7. 自定义域名（可选）

1. Railway → **Custom Domain** → 添加主机名。
2. 按提示配置 DNS（CNAME），等待 TLS 生效。
3. 更新 `APP_URL` 及所有 Webhook URL。
4. 媒体 CDN（`OSS_PUBLIC_BASE_URL`）建议使用独立子域名。

## 8. 运维说明

- **日志**：Railway 服务日志；应用内 `/admin/audit`（管理操作）、`/admin/webhooks`（回调）。
- **扩缩容**：建议先 **单实例** 运行；进程内限流不跨实例共享，水平扩展前需 Redis 等共享存储。
- **Schema 变更**：保持 Release Command 为 `npx prisma db push`，或改用 `prisma migrate deploy`。
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
6. 登录 `/admin`，配置 Stripe / Cryptomus / Zen / OSS
7. 配置 Webhook → 完成一笔测试支付

## 相关文档

- 本地开发与 API 概览：[README.md](../README.md)
- 环境变量模板：[`.env.example`](../.env.example)
