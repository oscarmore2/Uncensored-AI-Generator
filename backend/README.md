# AVClubs Backend

完整后端服务，完美搭配前端原型 `avclubs_clone.html`。

## 快速启动

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# 编辑 .env 填入你的 Zen Creator API Key 和 Stripe 测试密钥

uvicorn main:app --reload
```

访问 http://localhost:8000/docs 查看 Swagger UI。

## 默认 Demo 账号

- 用户名：`demo_user`
- 密码：`demo123`
- 初始点数：128

## 核心接口

### 认证
- `POST /auth/register`
- `POST /auth/login` → 返回 JWT
- `GET /users/me` → 当前用户信息 + 余额

### 生成
- `POST /generations/start` → 启动生成（自动扣点数）
- `GET /generations/{id}/status`
- `GET /history`

### 支付
- `POST /payments/create-checkout` → 创建 Stripe Checkout（Demo 模式直接加点数）
- `POST /payments/webhook` → Stripe Webhook（生产必须配置）
- `POST /payments/subscribe-vip`

## Zen Creator 集成

已在 `main.py` 中实现完整代理：
- 自动根据 mode 选择对应 tool（`by_prompt` / `image_editor` / `text_to_video` / `videogen`）
- 后台异步轮询状态
- 失败自动退款
- Demo 模式下使用占位图，真实模式调用你的 Zen API Key

**注意**：完整 NSFW 模型需要 Zen 账号完成首次充值成为 Trusted。

## 生产部署建议

1. **数据库**：换成 PostgreSQL（Supabase / Neon / Railway 免费额度足够）
2. **认证**：接入 Supabase Auth 或 Auth0（更安全）
3. **图片上传**：不要用 base64，改用 Cloudinary / S3 / Supabase Storage
4. **支付**：
   - 国际：Stripe（已实现）
   - 中国：接入支付宝 / 微信支付（可扩展 `payments` 路由）
5. **部署**：Render.com、Railway.app 或 Fly.io 一键部署

## 与前端联调

当前前端是纯静态 HTML（localStorage）。你可以：

1. 在 HTML 中加入 `fetch` 调用后端接口（推荐）
2. 或告诉我，我帮你生成一个 **Next.js 全栈版本**（前端 + API Routes + 数据库）

需要我继续生成前端联调版本或扩展其他功能（社区、模板库、管理员后台等），随时说！