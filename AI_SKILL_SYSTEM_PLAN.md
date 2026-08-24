# AI 技能系统 · 工程规格

> 状态：待确认 6 项（第十节）。
> 前置：`PROMPT_EDITOR_PLAN.md` 的 P0/P1 已上线（真 WYSIWYG、`prompt-doc.ts`、素材胶囊）。
> 关系：本文取代该文档的 **P3（选区级 AI）**，把「五个写死的动作」扩成可配置技能系统。

---

## 〇、边界：这一期不做什么

先划掉三样，否则范围会无限膨胀：

| 不做 | 理由 |
| --- | --- |
| **技能市场 / 技能共享给他人** | 一旦 A 的技能能跑在 B 的内容上，A 写的 systemPrompt 就成了对 B 内容的注入面。这是完全不同量级的安全问题，必须单独设计 |
| **BYOK（用户自带 API key）** | 涉及第三方密钥的加密存储、泄漏责任、上游封号连坐。而且它与「按 token 扣点」互斥——自带 key 就不该扣点。是另一个功能 |
| **用户自定义触发时机** | 时机必须由前端实现，是封闭枚举。用户只能给技能**勾选**时机，不能造新时机 |

另外明确：**技能 = 提示词定义 + 模型选择 + 时机绑定**。它不是插件、不能跑代码、不能联网、不能调工具。

---

## 一、触发时机（封闭枚举）

| code | 触发方式 | 上下文 | 典型技能 | 期次 |
| --- | --- | --- | --- | --- |
| `selection` | 选中文字 → 浮条 / 底栏 | 选区 + 前后各 300 字 | 润色、翻译、精简、加重 | S0 |
| `block` | 点块把手 → 菜单 | 整块 | 整段改写、转成镜头脚本 | S4 |
| `slash` | 空处打 `/` | 插入点 + 全文 | 生成一段、插入片段 | S4 |
| `empty` | 编辑器为空 | 无 | 从零起草 | S4 |
| `submit` | 点生成前 | 全文 | 体检、格式修正 | S4 |
| `manual` | 工具栏按钮 | 全文 | 现有「魔法指令」归位于此 | S2 |

技能还带 **`modes` 过滤**（空 = 全模式）。「转成镜头脚本」只在视频类 `formatId` 下出现，
否则文生图模式的菜单会被一堆用不上的技能塞满。

单个时机下技能超过 5 个时折叠成「技能 ▸」子菜单（Notion 的做法），按 `sortOrder` 排。

---

## 二、数据模型

### 2.1 `LlmModel` —— 文本模型注册表

```prisma
model LlmModel {
  id                 Int     @id @default(autoincrement())
  key                String  @unique   // 稳定标识，技能引用它
  label              String            // 面向用户，可含模型名（见 7.2）
  provider           String            // hf | openai | openrouter
  providerModelId    String            // 上游真名，服务端用
  tierCode           String            // basic | advanced | unrestricted
  inputUsdPerMTok    Float             // 上游成本
  outputUsdPerMTok   Float
  priceMultiplierBps Int     @default(13000)
  contextTokens      Int     @default(8000)
  supportsStreaming  Boolean @default(true)
  supportsUsage      Boolean @default(true)   // 见 8.1
  uncensored         Boolean @default(false)
  requiresVipRank    Int     @default(0)
  requiresAdult      Boolean @default(false)  // uncensored 必须为 true
  isActive           Boolean @default(true)
  sortOrder          Int     @default(0)
}
```

### 2.2 `Skill`

```prisma
model Skill {
  id              Int      @id @default(autoincrement())
  scope           String            // official | user
  ownerId         Int?              // scope=user 时非空
  key             String            // official 的稳定标识；user 用 nanoid
  name            String
  nameEn          String   @default("")
  icon            String   @default("")
  description     String   @default("")
  triggers        String            // JSON 数组，见第一节
  modes           String   @default("[]")
  systemPrompt    String
  userTemplate    String            // 变量见 2.4
  modelKey        String            // → LlmModel.key
  outputMode      String   @default("replace")  // replace | insert | append | card
  maxOutputTokens Int      @default(600)
  temperature     Float    @default(0.4)
  requiresVipRank Int      @default(0)
  isActive        Boolean  @default(true)
  sortOrder       Int      @default(0)
  isOverridden    Boolean  @default(false)  // 见第三节
  forkedFromKey   String?                   // 用户从哪个官方技能复制而来
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([scope, ownerId, key])
  @@index([scope, isActive, sortOrder])
}
```

### 2.3 `LlmUsageLog` —— 用量与成本审计

```prisma
model LlmUsageLog {
  id             Int      @id @default(autoincrement())
  userId         Int
  skillKey       String
  modelKey       String
  trigger        String
  promptTokens   Int
  completionTokens Int
  costUsdMicro   Int      // 上游真实成本，μ$（百万分之一美元）
  chargedMicro   Int      // 应扣，μ点（千分之一点）
  settledCredits Int      // 本次实际落到 balance 上的整点
  status         String   // ok | blocked | failed | timeout
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
  @@index([modelKey, createdAt])
}
```

管理员的成本报表全靠这张表。没有它就不知道 AI 功能到底在亏还是在赚。

### 2.4 `User` 新增列

```prisma
skillAuthoring   Boolean @default(false)  // 可自建技能（同 playthingAccess 的模式）
aiDebtMicro      Int     @default(0)      // 未满 1 点的零头，见 6.2
```

`VipTier` 同步加 `skillAuthoring Boolean @default(false)`，判定沿用
`plaything-access.ts` 的写法：**单独授权 或 VIP 有效且该等级开启**。

### 2.5 `userTemplate` 可用变量

| 变量 | 内容 |
| --- | --- |
| `{{selection}}` | 选区文本（canonical 形式，素材引用已换成占位符） |
| `{{context_before}}` / `{{context_after}}` | 选区前后各 300 字 |
| `{{full_text}}` | 全文 canonical |
| `{{mode_rules}}` | `PROMPT_FORMAT_RULES[formatId]` 逐条展开 |
| `{{mode}}` / `{{tier}}` | 当前模式与档位（**不含模型信息**） |
| `{{max_chars}}` | 当前模式的提示词长度上限 |

变量之外的一切由技能作者自由书写。未知变量原样保留（不报错）。

---

## 三、官方技能：出厂值、覆盖、恢复默认

官方技能的**出厂定义写在代码里**（`skill-seed.ts` 的常量数组），DB 行是「实例」。

`pricing-seed.ts` 现在的策略是「只补不改」——绝不覆盖管理端改过的东西。
技能这里要**再进一步**，因为价格是运营数据、技能提示词是**产品数据**，
产品数据应该随版本升级：

| 情况 | seed 行为 |
| --- | --- |
| DB 里没有该 `key` | 按出厂值建行，`isOverridden = false` |
| 有，且 `isOverridden = false` | **用出厂值覆盖**——代码升级了提示词，未被改过的技能自动跟上 |
| 有，且 `isOverridden = true` | 一个字都不动 |

- 管理员在管理端保存任何修改 → `isOverridden = true`
- 点「恢复默认」→ 回填出厂值 + `isOverridden = false`，此后继续跟随版本
- 管理端要显示「已偏离出厂设置」的标记与 diff，否则运营不知道自己改过什么

**官方技能不可删除，只能停用**（`isActive = false`）。删除会让引用它的
`forkedFromKey` 变悬空，也让 seed 每次启动又建回来。

---

## 四、用户技能：只能 fork，不能改官方

用户对官方技能只有两个动作：**用** 和 **复制一份改**。不能直接编辑官方技能。

理由：官方技能随版本升级。允许用户就地修改，等于把这个用户从升级链路上摘下来，
而且分不清「这条技能表现变差」是官方改的还是用户改的。

fork 出来的技能 `scope = user`、`forkedFromKey` 记录来源。官方原版更新时，
在用户的技能列表里给一条提示「来源技能已更新，查看差异」——**不自动合并**。

创建途径三种：**从零建** / **fork 官方** / **JSON 导入**。
导入格式就是 `Skill` 的公开字段子集（不含 id / ownerId / isOverridden），
带 schema 版本号，用 zod 校验。导出同理——这就是用户说的「导入自己的 skill」。

---

## 五、权限矩阵

| 能力 | 条件 |
| --- | --- |
| 使用官方技能 | 登录 + 余额 > 0 + 满足该技能 `requiresVipRank` |
| 使用 `advanced` 档模型 | VIP 有效且 rank ≥ 模型的 `requiresVipRank` |
| 使用 `unrestricted`（uncensored）模型 | **成人验证通过**（`hasAdultAccess`）+ VIP rank 达标 |
| 自建 / fork / 导入技能 | `skillAuthoring`（用户位 或 VIP 等级位） |
| 管理官方技能、模型、定价 | `role = admin` |

**两个维度是刻意分开的**：`VipTier.rank` 管「能用多贵的模型」，
`skillAuthoring` 管「能不能自己造技能」。合成一个的话，管理员想单独关停一个
滥用技能编辑的用户，就只能降他的 VIP——那是在惩罚他付过的钱。

管理端所有改动进 `AdminAuditLog`（已有），`action` 取
`skill_edit` / `skill_restore` / `llm_model_price` / `user_skill_authoring`。

---

## 六、计费

### 6.1 为什么不能沿用生成端的做法

生成端是**事前定价**：档位选定，`creditCost` 就是确定的整数，扣完再跑。
LLM 是**事后才知道用了多少 token**。这是结构性差异，不能套用。

### 6.2 微点结算（核心机制）

站内 1 点 ≈ $0.01（`ZC_STARTER_USD_PER_CREDIT = 19.99/200/10`）。
一次基础档润色的真实成本约 **$0.0003**，乘 130% 后是 **0.039 点**。

如果按整点 `ceil`，实际收费是成本的 **25 倍**，而不是标称的 130%。
标价体系会立刻失真，而且用户点两下就掉 2 点，观感极差。

**方案：内部按微点（μ点 = 千分之一点）累计，满 1 点才动 `balance`。**

```
每次调用：
  chargedMicro = 本次应扣微点
  user.aiDebtMicro += chargedMicro
  if (user.aiDebtMicro >= 1000) {
    credits = floor(user.aiDebtMicro / 1000)
    balance -= credits
    user.aiDebtMicro %= 1000
    → 写一条 Transaction(type="ai_skill", amount=-credits)
  }
```

- 真按 token 计费，精度到 0.001 点
- `Transaction` 流水不爆（约每 25 次基础档调用才产生一条）
- 用户看到的余额始终是整数

**代价**：单次调用后余额可能不变。UI 必须显示「本次消耗 0.04 点 · 累计 0.72 点」，
否则用户会以为是免费的，等某次突然掉 1 点时会来投诉。

`aiDebtMicro` 在充值时不清零、在扣费时不进位到负数——余额不足直接拒绝调用。

### 6.3 定价公式

```
usd      = (in_tok × inputUsdPerMTok + out_tok × outputUsdPerMTok) / 1_000_000
micro    = round( usd / USD_PER_CREDIT × 1000 × multiplierBps / 10000 )
micro    = max(micro, minChargeMicro)                       // 见 6.4
micro    = round( micro × (10000 - vipDiscountBps) / 10000 ) // VIP 折扣照旧适用
```

`multiplierBps` 沿用生成端口径：**普通 13000（130%）、无限制档 15000（150%）**，
与 `NORMAL_MULTIPLIER_BPS` / `SPICY_MULTIPLIER_BPS` 一致。
两条业务线共用同一个 USD/点锚点，否则同样 10 点买到的东西价值会差两个数量级。

### 6.4 默认定价表

三档对齐已有的 low/mid/high 心智：

| 档 | `tierCode` | 定位 | 参考上游价（in/out per Mtok） | 单次成本估算¹ | **单次扣点** | 门槛 |
| --- | --- | --- | --- | --- | --- | --- |
| 基础 | `basic` | 快、够用，默认档 | $0.15 / $0.60 | $0.00030 | **0.039 点** | 无 |
| 进阶 | `advanced` | 质量明显更好 | $2.50 / $10.00 | $0.00500 | **0.650 点** | VIP1+ |
| 无限制 | `unrestricted` | uncensored | 按实际接入填 | — | ×150% | 成人验证 + VIP |

¹ 按典型一次润色估：输入 800 token（选区 + 前后文 + system + 模式规则），输出 300 token。

几个刻意的设定：

- **基础档比进阶档便宜约 17 倍**，这是分层的全部意义。默认技能一律绑基础档，
  用户嫌效果不好再自己换成进阶档——把成本决定权交给用户。
- **`minChargeMicro = 5`**（0.005 点）。防止「输出 3 个字」这类调用扣成 0，
  同时不至于让基础档失去价格优势。
- **不设免费额度。** 基础档一次 0.039 点，一天点 100 次是 3.9 点——低到不需要
  再叠一套每日配额系统。少一套系统就少一处出错。
- **失败不扣费**，但**审查拦截扣费**：上游已经跑过了，成本已经发生。
  这一条要在 UI 上写明，否则被拦的用户会觉得是白扣。

### 6.5 并发透支被交互层堵死了

先检查余额、后扣真实用量，理论上可以并发发起多个调用来透支。
但 `PROMPT_EDITOR_PLAN.md` 第六节已经定了「**同一时刻只允许一个 AI 动作在跑**」
（原因是避免多张结果卡片满天飞）。这条交互规则顺带封死了并发透支。

服务端仍要有一道用户级互斥（`rate-limit.ts` 同款内存锁即可，
Railway 单实例场景下够用），不能只靠前端。

---

## 七、安全

### 7.1 用户自定义 systemPrompt 的四类风险

| 风险 | 处理 |
| --- | --- |
| **越狱内容审查** | 技能定义**不能影响审查参数**。`allow_sensitive` 只取决于用户的 `hasAdultAccess`，与技能里写什么无关。输出仍走 `reviewPrompt` 出口复查，与现有 `magic-prompt` 一致 |
| **拿站点当免费 LLM 代理** | 按 token 真实计费之后，这不再是滥用而是消费。再加 `maxOutputTokens` 硬顶（默认 600）与 `contextTokens` 截断，单次成本有界 |
| **注入面** | 用户的技能只跑在**自己的**内容上，自注入无害。**技能一旦可共享，这条立刻失效**——这正是第〇节把共享划出去的原因 |
| **提示词泄漏官方技能** | 用户 fork 得到的是官方技能的完整 systemPrompt。这**是有意的**（fork 的意义就在于此），所以官方技能的提示词不应包含任何机密 |

### 7.2 「模型信息不下发」这条铁律要在这里开一个口

`prompt-targets.ts` 与 `GenerationProduct.providerModelId` 都写死了
「模型信息绝不下发到生成端」。但技能要让用户选模型，就必须显示模型名。

**这个口可以开，因为两类模型是两个池子：**

| | 生成模型（图/视频/3D） | 文本 LLM |
| --- | --- | --- |
| 存在于 | `ProviderAccount` / `ProviderCatalogModel` | `HfAccount` / `OpenAiAccount` / `LlmModel` |
| 为什么要藏 | 档位定价建立在用户不知道底层模型之上 | 无此依赖 |
| 本期 | **继续藏，一个字不改** | **公开**，用户自选即功能本身 |

现状已有先例：`magic-prompt.ts` 的响应里就带 `source: "dolphin"`。

**但界线要写进代码注释**：`LlmModel.label` 可以含模型名，
`GenerationProduct.label` 永远不能——两者不是一回事，日后别被人顺手改成一致。

### 7.3 uncensored 的门

`uncensored = true` 的模型必须同时 `requiresAdult = true`，在管理端保存时强制校验。
判定复用 `hasAdultAccess`，与 Spicy 档同一条逻辑，不新建一套。

---

## 八、工程坑

### 8.1 流式响应拿不到 usage

OpenAI 需要显式 `stream_options: { include_usage: true }` 才在最后一个 chunk 给 usage；
HF 的兼容端点**未必实现**。拿不到 usage 就没法计费。

处理：`LlmModel.supportsUsage` 声明。为 false 时按字符估算
（中文约 1.5 字/token，英文约 4 字符/token），并在 `LlmUsageLog` 里标记为估算值——
管理员看成本报表时要知道哪些数字是估的。

**这一条要在接入每个新模型时实测，不能信文档。**

### 8.2 其余

- **超时与取消。** LLM 可能 30s+，编辑器里等不了。硬超时 15s，用户可随时取消；
  取消后**已产生的 token 照扣**（成本已发生）。
- **锚点失效。** 等结果期间用户改了别处会让选区偏移。沿用编辑器规划里的方案：
  position mapping 跟随，或 pending 期间锁住该段。
- **模型能力不匹配。** 技能选了不支持 streaming 的模型，`outputMode` 又要求流式插入。
  管理端保存技能时校验，前端降级为非流式。
- **技能的 i18n。** 官方技能要 `name` / `nameEn` 双语（站点有 `en.json` / `zh-CN.json`）。
  用户技能单语即可。
- **审查的双向成本。** 每次技能调用都要跑 `reviewPrompt` 入口 + 出口两次。
  OpenAI moderations 免费，但延迟叠加。考虑入口审查对短选区跳过（选区 < 20 字时
  信息量不足以判定，出口审查兜底）。

---

## 九、分期

| 期 | 内容 | 说明 |
| --- | --- | --- |
| **S0** | 五个官方技能硬编码 + `selection` 时机 + 完整 AI 管线 | 打通端到端：浮条/底栏、流式 SSE、素材胶囊占位保护、审查、并发锁、预览卡（替换/插入/重试/放弃）。**模型与价格先写常量**，不进 DB |
| **S1** | `LlmModel` 表 + `LlmUsageLog` + 微点结算 + 管理端定价页 | 把 S0 的常量搬进 DB 并可运营。成本报表在这一期出来 |
| **S2** | `Skill` 表 + `skill-seed.ts` + 管理端技能 CRUD + 出厂值/覆盖/恢复默认 | 官方技能变成可配置。`manual` 时机接入，现有「魔法指令」归位成一个官方技能 |
| **S3** | 用户自建技能：fork / 从零 / JSON 导入导出 + `skillAuthoring` 权限位 | |
| **S4** | 其余四个时机：`block` / `slash` / `empty` / `submit` | 每个时机都是一份独立的前端交互，不要和 S0 混做 |

**强烈建议不要跳过 S0 直接做技能系统。** S0 要解决的是管线本身的问题——
流式、锚点、审查、并发、计费精度，每一条都会单独出错。
把它们和「技能配置从哪来」混在一期，出问题时分不清是管线坏了还是配置错了。

S1 排在 S2 之前是因为：S0 一上线就在花钱，成本可见性比技能可配置性更紧急。

---

## 十、待确认

| # | 事项 | 建议 |
| --- | --- | --- |
| 1 | **基础档接哪个模型** | 现有 `HfAccount` 走的是 Dolphin（uncensored）。基础档需要一个便宜稳定的通用模型，可能要新开一个 provider 账户类型 |
| 2 | **失败/取消/被拦的扣费口径** | 建议：上游已跑 = 扣；上游没跑（余额不足、参数错） = 不扣。**要写进用户可见的文案** |
| 3 | **`aiDebtMicro` 的归零时机** | 建议永不归零（跨充值累计）。若要在充值时抹掉零头当作福利，是产品决定 |
| 4 | **官方技能初始清单** | 建议就是编辑器规划里那五个：按模式润色 / 译成英中 / 补充细节 / 精简到上限 / 加重这一句 |
| 5 | **`minChargeMicro` 取值** | 建议 5（0.005 点）。取太大会抹平基础档的价格优势 |
| 6 | **进阶档是否对非 VIP 开放** | 建议不开放。它是 VIP 的一个实感权益，且成本高 17 倍 |
