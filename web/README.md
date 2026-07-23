# AVClubs Web（Next.js 安全全栈版）

Next.js 15 App Router 全栈应用，替代原「静态 HTML + 跨域 FastAPI」架构。

## 快速启动

```bash
# 1. 本地数据库（PostgreSQL 17，仅首次）
brew install postgresql@17
brew services start postgresql@17
/opt/homebrew/opt/postgresql@17/bin/createdb avclubs

# 2. 应用
cd web
npm install

cp .env.example .env
# 必填：AUTH_SECRET（openssl rand -hex 32 生成，>= 32 字符）
# DATABASE_URL 默认指向本地 postgresql://localhost:5432/avclubs
# 选填：ZEN_API_KEY / STRIPE_* （Demo 模式下可留空）

npx prisma db push   # 初始化数据库表
npm run dev          # http://localhost:3000
```

常用数据库命令：

```bash
/opt/homebrew/opt/postgresql@17/bin/psql -d avclubs   # 命令行连接
npx prisma studio                                     # 图形化浏览数据
brew services stop postgresql@17                      # 停止数据库
```

Demo 模式（`DEMO_MODE=true`）下：
- 首次用 `demo_user` / `demo123` 登录会自动创建该账号（128 点）
- 首次用 `mod_user` / `mod123` 登录会自动创建审核员账号（role=moderator）
- 首次用 `admin_user` / `admin123` 登录会自动创建管理员账号（role=admin）
- 充值立即到账、生成返回占位图，无需真实 Zen / Stripe 密钥

生产环境可通过 `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` 环境变量种子一个 admin 账号（首次登录该用户名时自动创建/提升）。

## 角色与页面

| 角色 | 权限 |
|------|------|
| `user` | 创作、历史、充值 |
| `moderator` | user 权限 + 审核台 `/mod`（软删/恢复/曝光/公共库管理/采集导入） |
| `admin` | moderator 权限 + 管理端 `/admin`（看板/用户/审核员启停/流水/加密订单/Cryptomus 多商户） |

页面分区：
- **游客可访问**：`/`（落地页）、`/explore`（公共作品墙）、`/explore/[id]`（参数详情 + 引流 CTA）、`/login`
- **登录后**：`/make` `/history` `/profile`；详情页 CTA 会把 prompt/negative/mode 带进创作中心
- **审核员/管理员**：`/mod`（队列概览）、`/mod/generations`（审核+批量软删+曝光）、`/mod/users`（按用户管理作品）、`/mod/public`(公共库上下架/排序/删除/导入)
- **仅管理员**：`/admin`（数据看板：分渠道收入/生成管道/审核队列摘要）、`/admin/users`（列表+`/admin/users/[id]` 详情：改角色/调余额/VIP/封禁）、`/admin/mods`（启停审核员/升降角色）、`/admin/transactions`（日期筛选+CSV 导出）、`/admin/crypto`（加密订单+人工入账）、`/admin/cryptomus`（多 Merchant 增删激活）、`/admin/stripe`（多 Stripe 账户增删激活）、`/admin/zen`（Zen 多账户 / 余额 / 任务映射）、`/admin/oss`（对象存储 S3 兼容）、`/admin/audit`（审计日志）、`/admin/webhooks`（Webhook 事件日志）、`/admin/settings`（只读配置快照）

封禁说明：被封禁用户（`disabledAt` 非空）无法登录，已登录会话的所有受保护 API 立即失效；admin 不能封禁或降级自己。余额调整会写入 `admin_adjust` 类型流水，可在交易流水页审计。审核员「停用」即封禁登录；「撤销角色」则降为普通 `user`。

软删除说明：审核员软删的作品对用户不可见但保留在库中，可恢复；「曝光」会把作品复制为 `PublicWork` 独立副本进公共库，原作品之后被软删也不影响引流页。

## 安全架构

| 项 | 实现 |
|----|------|
| 会话 | JWT 写入 `HttpOnly + SameSite=Lax + Secure(生产)` Cookie，2 小时过期；JS 无法读取 token |
| 鉴权 | `src/middleware.ts` 统一拦截 `/make` `/history` `/profile` 与受保护 API，未登录页面 307 → `/login`、API 返回 401 |
| CORS | 前后端同源，无跨域开放；第三方密钥（Zen / Stripe）只存在于服务端 |
| 密码 | bcrypt (cost 12)，注册要求至少 8 字符 |
| 限流 | 登录 10 次/分/IP、注册 5 次/分/IP、生成 10 次/分/用户（进程内滑动窗口） |
| 输入校验 | 所有 API 入参经 Zod 校验 |
| 启动校验 | `AUTH_SECRET` 缺失、过短或为已知默认值时拒绝启动（`src/lib/env.ts`） |
| 安全头 | `X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy` 等（`next.config.ts`） |
| Stripe Webhook | 仅签名验证（不走会话），按 `payment_intent` 幂等入账 |
| 扣费 | 原子条件更新（余额不足则拒绝），失败自动退款 |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册并建立会话 |
| POST | `/api/auth/login` | 登录并建立会话 |
| POST | `/api/auth/logout` | 清除会话 |
| GET | `/api/me` | 当前用户信息 |
| POST | `/api/generations` | 提交生成任务（扣点） |
| GET | `/api/generations` | 生成历史（最近 50 条） |
| GET | `/api/generations/{id}/status` | 任务状态 |
| POST | `/api/payments/create-checkout` | 充值（Demo 直接到账 / Stripe Checkout） |
| POST | `/api/payments/webhook` | Stripe Webhook |
| POST | `/api/payments/subscribe-vip` | VIP 订阅 |
| POST | `/api/payments/crypto/create` | 创建 Cryptomus 加密支付订单（USDT/USDC） |
| POST | `/api/payments/crypto/webhook` | Cryptomus Webhook（MD5 验签 + 幂等入账） |
| GET | `/api/payments/crypto/status` | 查询加密支付到账状态（前端轮询） |
| GET | `/api/public/works` | 【游客】公共作品列表（分页/按 mode 筛选） |
| GET | `/api/public/works/{id}` | 【游客】公共作品详情 |
| GET | `/api/mod/generations` | 【mod】审核队列（status/mode/user/含已删筛选） |
| POST | `/api/mod/generations/{id}/soft-delete` | 【mod】软删除 |
| POST | `/api/mod/generations/{id}/restore` | 【mod】恢复 |
| POST | `/api/mod/generations/bulk-soft-delete` | 【mod】批量软删除 |
| POST | `/api/mod/generations/{id}/feature` | 【mod】曝光：复制到公共库 |
| GET | `/api/mod/users` | 【mod】用户列表（含作品数） |
| GET | `/api/mod/users/{id}/generations` | 【mod】某用户作品（含已删） |
| GET | `/api/mod/public-works` | 【mod】公共库管理列表 |
| PATCH/DELETE | `/api/mod/public-works/{id}` | 【mod】上下架/排序/改标题/删除 |
| POST | `/api/mod/public-works/import` | 【mod】Zen/外部内容采集导入 |
| GET | `/api/admin/stats` | 【admin】看板：总量+分渠道收入+生成管道+审核队列+近 30 天序列+Zen 估算 |
| GET/PATCH | `/api/admin/users` / `[id]` | 【admin】用户列表；详情；改角色/调余额/VIP/封禁 |
| GET | `/api/admin/transactions` | 【admin】流水（type/method/用户/日期筛选） |
| GET | `/api/admin/transactions/export` | 【admin】流水 CSV 导出（最多 5000 行） |
| GET | `/api/admin/crypto-payments` | 【admin】加密支付订单（入账状态筛选） |
| PATCH | `/api/admin/crypto-payments/[id]/credit` | 【admin】人工确认加密订单入账 |
| GET | `/api/admin/audit-logs` | 【admin】管理端审计日志 |
| GET | `/api/admin/settings` | 【admin】只读配置快照（脱敏） |
| GET | `/api/admin/webhook-logs` | 【admin】Stripe/Cryptomus Webhook 事件日志 |
| GET/POST | `/api/admin/mods` | 【admin】审核员列表；提升用户为审核员 |
| PATCH | `/api/admin/mods/[id]` | 【admin】启停审核员 / 撤销角色 |
| GET/POST | `/api/admin/cryptomus-merchants` | 【admin】Cryptomus 商户列表/新增 |
| PATCH/DELETE | `/api/admin/cryptomus-merchants/[id]` | 【admin】激活/停用/换 Key/删除 |
| GET/POST | `/api/admin/stripe-accounts` | 【admin】Stripe 账户列表/新增 |
| PATCH/DELETE | `/api/admin/stripe-accounts/[id]` | 【admin】激活/停用/换 Key/删除 |
| GET/POST/PATCH | `/api/admin/zen-accounts` | 【admin】Zen 账户列表/新增/批量同步余额 |
| GET/PATCH/DELETE | `/api/admin/zen-accounts/[id]` | 【admin】账户任务列表 / 激活换 Key / 删除 |
| GET/POST | `/api/admin/oss-accounts` | 【admin】OSS 对象存储账户列表/新增 |
| PATCH/DELETE | `/api/admin/oss-accounts/[id]` | 【admin】激活/停用/换 Key/删除 |
| POST | `/api/admin/oss-accounts/[id]/test` | 【admin】测试 OSS 桶连通性 |
| POST | `/api/zen/webhook` | 【预留】按 zen_job_id 更新任务状态（Zen 官方暂无 webhook） |

## 加密货币支付（Cryptomus）

流程：用户选套餐 → `crypto/create` 用**当前激活商户**调 Cryptomus 创建发票（USD 计价，限 USDT/USDC）→ 新窗口打开托管收银台 → 用户转账、链上确认 → Cryptomus 回调 `crypto/webhook` → 验签后幂等加点 → 前端轮询 `crypto/status` 自动刷新余额。

### 多商户管理（推荐）

管理员在 `/admin/cryptomus` 可维护多组 **Merchant ID ↔ Payment API Key**：

1. 添加商户（备注名 + Merchant ID + Payment API Key），可选立即激活
2. 同一时间仅一个商户 `isActive=true`；激活某商户时自动停用其他
3. API Key 使用 `AUTH_SECRET` 做 AES-256-GCM 加密存库，列表仅显示掩码
4. 创建订单时写入 `CryptoPayment.merchantRefId`；Webhook 验签会尝试**所有**已存商户的 Key（含未激活）以及 `.env` 兜底，切换激活商户后旧订单仍可入账
5. 无激活 DB 商户时回退 `.env` 的 `CRYPTOMUS_MERCHANT_ID` / `CRYPTOMUS_PAYMENT_API_KEY`

### 环境变量兜底（可选）

1. 在 [app.cryptomus.com](https://app.cryptomus.com) 拿到 Merchant ID 和 Payment API Key，可先填 `.env`，也可只在管理端配置
2. `APP_URL` 必须是公网可达地址（本地联调可用 ngrok 等隧道），否则收不到 Webhook
3. 本地可运行 `node scripts/test-crypto-webhook.mjs` 验证验签与幂等入账逻辑（若脚本仍读 env Key）

实现要点：

- 签名算法：`md5(base64(json_body) + PAYMENT_API_KEY)`；Webhook 验签时需按 PHP `json_encode` 风格把 `/` 转义为 `\/`（`src/lib/cryptomus.ts`）
- 验签使用常数时间比较；Webhook 路由在 middleware 白名单中（无会话，仅验签）
- 入账幂等：`CryptoPayment.credited` 原子置位，Cryptomus 重发 Webhook 不会重复加点
- `paid` 与 `paid_over`（多付）视为成功；`wrong_amount`（少付）不入账，状态留档可人工处理

## Stripe 银行卡支付

流程：用户选套餐 → `create-checkout` 用**当前激活 Stripe 账户**创建 Checkout Session → 跳转 Stripe 托管页 → 支付成功后 Stripe 回调 `webhook` → 验签后幂等加点。

### 多账户管理（推荐）

管理员在 `/admin/stripe` 可维护多组 **Secret Key + Webhook Secret**：

1. 添加账户（备注名 + `sk_…` + `whsec_…`，可选 `pk_…`），可选立即激活
2. 同一时间仅一个账户 `isActive=true`；激活时自动停用其他
3. Secret / Webhook Secret 用 `AUTH_SECRET` 做 AES-256-GCM 加密存库，列表仅显示掩码
4. Webhook 验签会尝试**所有**已存账户的 Signing Secret（含未激活）以及 `.env` 兜底
5. 无激活 DB 账户时回退 `.env` 的 `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
6. **必须** `DEMO_MODE=false` 才会走真实 Stripe；Demo 模式仍是本地直接加点

Webhook 配置：Stripe Dashboard → Developers → Webhooks → 端点 `https://你的域名/api/payments/webhook`，事件勾选 `checkout.session.completed`、`customer.subscription.deleted`（VIP 订阅取消）。

### VIP 订阅

非 Demo 模式下 `subscribe-vip` 创建 Stripe Checkout Subscription（月付，价格由 `VIP_PRICE` 控制）。Webhook 在 `checkout.session.completed`（metadata `type=vip`）时激活 VIP 并赠送 800 点；`customer.subscription.deleted` 时撤销 VIP。管理员也可在 `/admin/users/[id]` 手动授予/撤销 VIP。

### 运维增强

- **人工入账**：`/admin/crypto` 对未入账订单可调用 `PATCH /api/admin/crypto-payments/[id]/credit`（支持 `credits_override` 处理 `wrong_amount`）
- **审计日志**：敏感管理操作写入 `AdminAuditLog`，可在 `/admin/audit` 查看
- **Webhook 日志**：Stripe/Cryptomus 回调写入 `WebhookEventLog`，可在 `/admin/webhooks` 排查
- **细粒度权限**：当前仍仅 `admin` 可访问 `/admin`；未来可扩展 `finance` 等角色（见 schema 注释）

## 对象存储 OSS（S3 兼容）

生成结果、公共库媒体默认存 Zen 临时 URL。配置 OSS 后，系统会自动将媒体**镜像**到自有桶，避免 Zen 链接过期。

### 管理端 `/admin/oss`

1. 添加账户（备注名 + Endpoint + Bucket + AK/SK），支持 **阿里云 OSS / AWS S3 / MinIO / Cloudflare R2**
2. 同一时间仅一个账户 `isActive=true`；无激活 DB 账户时回退 `.env` 的 `OSS_*` 变量
3. Secret Access Key 用 `AUTH_SECRET` AES-256-GCM 加密存库
4. 可配置 **CDN 公网域名**（`public_base_url`）、路径前缀、是否镜像 Zen 结果
5. 「测试连接」调用 S3 HeadBucket 验证凭证

### 自动镜像时机

- Zen 生成成功 → `generations/{id}/0.jpg` …
- 审核曝光到公共库 → `public/gen-{id}/…`
- 采集导入公共库 → `public/import-{ts}/…`

未配置 OSS 或关闭 `mirror_zen_results` 时，行为与之前一致（保留原始 URL）。

## Zen Creator 多账户与任务映射

Zen 公开 API 提供 `GET /balance`（真实余额）与生成状态 `progress`（0–100），**官方暂无 webhook**（文档要求轮询）。

### 管理端 `/admin/zen`

1. 添加多个 API Key（`zc_live_…`），添加时调用 Zen `/balance` 校验并写入 `lastKnownBalance`
2. 同一时间仅一个账户 `isActive=true`；生成走激活账户（无激活时回退 `.env` 的 `ZEN_API_KEY`）
3. 可一键「同步余额」刷新全部账户的真实 credits
4. 每个账户展示：余额、任务数、估算消耗（成功任务的 `zenCreditsCost`）
5. 「查看任务」列出本地 `Generation.id` ↔ `zenJobId`（Zen taskId）映射与进度

### 任务与进度

- 用户提交 prompt → 创建本地 `Generation` → 调用 Zen `POST /generations` 拿到 `zenJobId` 写入同一行
- 服务端每 5s 轮询 Zen status，把 `status` / `progress` 写回 DB
- 前端轮询 `GET /api/generations/{id}/status` 展示进度条（实时状态）
- 预留 `POST /api/zen/webhook`：若日后 Zen 支持或你自建中转，可按 `zen_job_id` 推送更新（可选头 `X-Zen-Webhook-Secret`）

### Railway / 机房 IP 被 Cloudflare 拦截

若管理端添加 Zen 账户时出现 `403 Just a moment...`，说明 **Zen 域名前的 Cloudflare Bot Challenge 拦了云主机出口 IP**（与 API Key 无关）。生成/余额同步都会失败。

推荐做法（你已有 Cloudflare）：

1. 部署 [`scripts/zen-proxy-worker.js`](scripts/zen-proxy-worker.js) 为 Cloudflare Worker
2. Railway 设置：
   - `ZEN_BASE_URL=https://<你的-worker域名>/api/public/v1`
   - （可选）`ZEN_PROXY_SECRET` 与 Worker 变量 `PROXY_SECRET` 相同
3. 重新部署后再在 `/admin/zen` 同步余额

## Telegram 通知（选填）

1. 用 [@BotFather](https://t.me/BotFather) 创建 Bot，拿到 `TELEGRAM_BOT_TOKEN`
2. 把 Bot 拉进接收通知的群（或直接私聊 Bot 发一条消息），通过 `https://api.telegram.org/bot<token>/getUpdates` 拿到 `chat.id`，填入 `TELEGRAM_CHAT_ID`
3. 配置后自动推送：充值成功（Stripe/Cryptomus）、新用户注册、生成失败退款、Zen 预算告警（同一告警 24h 内只发一次）；未配置时静默跳过，不影响任何流程

## 生产部署

推荐路径：**Railway**（Web Service + PostgreSQL）。公开仓库可用的中性部署说明见 [docs/DEPLOY_RAILWAY.md](docs/DEPLOY_RAILWAY.md)（不含业务敏感文案；密钥只放 Railway Variables / 本地 `.env`）。

摘要：

1. `.env` / Railway Variables：`DEMO_MODE=false`，强 `AUTH_SECRET`、`APP_URL`；Zen / Stripe / Cryptomus / OSS 按需配置（勿把真实密钥提交进仓库）
2. 数据库：PostgreSQL，`DATABASE_URL`（建议 `?sslmode=require`），部署时执行 `npx prisma db push`（Railway Release Command）
3. 构建运行：`npm run build && npm start`（Root Directory = `web`）
4. Stripe / Cryptomus Webhook 指到 `{APP_URL}/api/payments/webhook` 与 `{APP_URL}/api/payments/crypto/webhook`
5. 多实例部署时把进程内限流换成 Redis 等共享存储

## 技术栈

Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Prisma + PostgreSQL · jose (JWT) · bcryptjs · Zod · Stripe
