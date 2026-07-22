# AVClubs - AI 成人内容生成平台

**项目状态**：已升级为 Next.js 安全全栈版（`web/` 目录，推荐使用）

**核心目标**：复刻 avclubs.top 这类 AI NSFW 生成网站，并完整接入 **Zen Creator** API + 点数充值系统。

---

## 📁 项目文件结构

```
AVClubs_Fullstack_Project/
├── web/                            # ✅ 推荐：Next.js 安全全栈版（前后端一体）
│   ├── src/app/                    # 页面 + API Route Handlers
│   ├── src/middleware.ts           # 统一鉴权中间件
│   ├── prisma/schema.prisma        # 数据模型
│   ├── .env.example
│   └── README.md                   # 启动与部署说明
│
├── avclubs_fullstack_demo.html     # 旧版：单文件 HTML（仅作参考，localStorage 存 token）
└── backend/                        # 旧版：FastAPI 后端（仅作参考）
```

---

## 🚀 快速启动（推荐：Next.js 版）

```bash
cd web
npm install

cp .env.example .env
# 必填 AUTH_SECRET（openssl rand -hex 32）；Demo 模式下其余可留空

npx prisma db push
npm run dev
```

访问 **http://localhost:3000**，Demo 账号 `demo_user` / `demo123`（首次登录自动创建）。

### 相比旧版的安全改进

- 会话使用 **HttpOnly + SameSite Cookie**，token 不再放 localStorage
- 前后端同源，**移除 `CORS *`**；Zen / Stripe 密钥只在服务端
- middleware 统一鉴权；登录/注册/生成接口限流；Zod 输入校验
- 弱密钥拒绝启动；bcrypt 密码哈希；Stripe Webhook 验签 + 幂等入账；生成失败自动退款

详细说明见 [`web/README.md`](web/README.md)。

---

## 🗂 旧版（FastAPI + HTML，仅作参考）

### 1. 启动后端

```bash
cd backend

# 创建虚拟环境（推荐）
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# 编辑 .env，重点修改：
# - ZEN_API_KEY（你的 Zen Creator Key）
# - STRIPE_SECRET_KEY（测试密钥即可）

uvicorn main:app --reload
```

后端默认运行在：**http://localhost:8000**

访问 http://localhost:8000/docs 查看完整 API 文档。

### 2. 打开前端

直接用浏览器打开：

**推荐文件**：`avclubs_fullstack_demo.html`

- 第一次打开会弹出登录框
- 默认账号：`demo_user` / `demo123`
- 登录后即可使用完整功能（生成、充值、历史全部走真实后端）

---

## 🛠 技术栈

### 前端
- 单文件 HTML + Tailwind CSS + 原生 JavaScript
- 响应式设计，深色成人向 UI
- 已完全对接后端 API（JWT 认证 + 实时数据同步）

### 后端
- **FastAPI**（异步、高性能）
- **SQLite**（默认，轻量；生产可换 PostgreSQL）
- **SQLAlchemy** + Pydantic
- **JWT** 认证
- **Zen Creator** 完整代理（异步任务 + 状态轮询 + 失败退款）
- **Stripe** 支付集成（支持 Demo 模式快速演示）

---

## ✨ 核心功能实现

| 功能           | 状态          | 说明 |
|----------------|---------------|------|
| 用户登录/注册  | ✅ 完成       | JWT + Demo 账号自动创建 |
| 点数钱包       | ✅ 完成       | 实时扣费、充值、退款 |
| 4 种生成模式   | ✅ 完成       | txt2img / txt2vid / img2img / img2vid |
| Zen Creator 集成 | ✅ 完成     | 自动选择 Tool + 异步轮询 |
| 生成历史       | ✅ 完成       | 实时从后端拉取 |
| 充值系统       | ✅ 完成       | Demo 模式立即到账 + Stripe Checkout |
| VIP 月卡       | ✅ 完成       | 赠送点数 + 优先队列 |
| 图片上传       | 预留接口      | 当前支持 base64（生产建议改 OSS） |
| 移动端适配     | ✅ 完成       | 响应式 + 汉堡菜单 |

---

## 🔗 主要 API 接口（后端）

### 认证
- `POST /auth/login`
- `POST /auth/register`
- `GET  /users/me`

### 生成
- `POST /generations/start` → 提交生成任务
- `GET  /generations/{id}/status`
- `GET  /history`

### 支付
- `POST /payments/create-checkout`
- `POST /payments/webhook`（Stripe）
- `POST /payments/subscribe-vip`

完整接口文档请访问后端启动后的 `/docs`。

---

## 💳 充值说明（Demo 模式）

当前后端默认开启 **Demo 模式**：
- 调用充值接口后**立即加点数**
- 适合快速演示和验证流程
- 生产环境可关闭 `DEMO_MODE=false`，切换为真实 Stripe

支持的套餐（可在 `.env` 中修改）：
- 100 点 → ¥29
- 500 点 → ¥129（最受欢迎）
- 1200 点 → ¥299
- 3000 点 → ¥699
- VIP 月卡 → ¥99（每月赠送 800 点）

---

## 🔧 Zen Creator 集成细节

后端已实现完整代理逻辑：

```python
# 自动映射
txt2img  → by_prompt
img2img  → image_editor
txt2vid  → text_to_video
img2vid  → videogen
```

- 失败自动退款
- 支持 Trusted 账号的 NSFW 模型
- 生产环境建议把图片上传改成先传 OSS，再传 `asset_id`

---

## 📦 如何获取完整项目

当前你已经拥有所有文件：

1. 下载 `avclubs_fullstack_demo.html`
2. 下载整个 `backend/` 文件夹
3. 按上面步骤启动即可

如需打包成 zip，可在 artifacts 目录下执行：

```bash
zip -r AVClubs_Fullstack_Project.zip avclubs_fullstack_demo.html backend/
```

---

## 🚀 生产部署建议

### 前端
- 推荐改造成 **Next.js** 项目（我可以继续帮你生成）
- 部署到 Vercel / Cloudflare Pages

### 后端
- 数据库换成 **PostgreSQL**（Supabase / Neon / Railway）
- 认证换成 **Supabase Auth** 或 Auth0
- 图片存储使用 **Cloudinary** 或 Supabase Storage
- 支付接入真实 **Stripe** + Webhook
- 部署平台：Render.com、Railway、Fly.io、Docker

---

## 📌 下一步可以继续做的功能

- [ ] 真实图片上传到 OSS（替换 base64）
- [ ] 社区作品展示 / 用户分享
- [ ] 提示词模板库
- [ ] 管理员后台
- [ ] 多语言（中英切换）
- [ ] 完整 Next.js 全栈版本（前端 + API Routes）
- [ ] 接入真实支付宝/微信支付

---

## 📝 备注

- 本项目为**演示 + 学习用途**，包含成人内容相关功能。
- 所有生成内容均为 AI 虚构，请遵守当地法律法规。
- 如需商业使用，请自行处理合规与支付通道。

---

**项目已全部准备完毕**，你可以直接使用 `avclubs_fullstack_demo.html` + 后端跑通完整闭环。

需要我继续帮你生成 **Next.js 全栈版本** 还是扩展其他功能，随时告诉我！