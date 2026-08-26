# AI 技能系统 · 工程规格

> 状态：**S0 / S1 / S2 / S3 已实现**（见 9.1–9.4），待确认项已全部收敛为第十节的决定。
> 前置：`PROMPT_EDITOR_PLAN.md` 的 P0/P1 已上线（真 WYSIWYG、`prompt-doc.ts`、素材胶囊）。
> 关系：本文取代该文档的 **P3（选区级 AI）**，把「五个写死的动作」扩成可配置技能系统。

---

## 决策摘要

> 文档已经很长，且 S0 / S1 已上线。这一节是**承重决策的索引**：
> 每条都是改起来会牵动别处的东西。细节在正文，这里只放结论和它成立的理由。

### 已上线（S0 + S1，代码位置见 9.1 / 9.2）

| 决策 | 结论 | 为什么不能反过来 |
| --- | --- | --- |
| **计费粒度** | **微点结算**：内部按 μ点（千分之一点）累计，满 1 点才动 `balance` | 基础档单次 0.039 点。按整点 `ceil` 收费是成本的 **25 倍**（换 Qwen 后是 125 倍），标称 130% 的口径当场作废 |
| **余额下限** | LLM **允许把余额扣成负数**；`balance > 0` 才能发起新调用 | 上游已经花的钱必须收。透支天然有界（≤2 点），不需要额外配上限 |
| **扣费判据** | 只看**上游跑了没有**。审查拦截、用户取消、超时 → 扣；入口拦截、凭据缺失、连接失败 → 不扣 | 拦截时成本已经发生。界面必须写明「本次仍消耗 N 点」，否则被拦的用户以为白扣 |
| **并发** | 用户级互斥 + **DB 层带旧值的条件更新** | 进程内的锁在多副本下不成立，并发正确性必须落在结算那一层 |
| **上游** | OpenRouter；S0 阶段可回退站内 HF 凭据 | 见下「为什么不是 WaveSpeed / Atlas」 |
| **档位选择** | 现状是**自动**的：成人模式 → 无限制档，其余 → 基础档 | 基础档模型在成人模式下会拒答，给一句「抱歉我无法协助」比不给这功能更糟 |

### 已定但未实现

| 决策 | 结论 | 关键约束 |
| --- | --- | --- |
| **官方技能** | 出厂值写在代码里，DB 存实例。`isOverridden = false` 的行**每次启动被出厂值覆盖** | 与 `pricing-seed.ts` 的「只补不改」**不同**：价格是运营数据，技能提示词是产品数据，产品数据要随版本走 |
| **用户技能** | 只能 **fork**，不能就地改官方 | 改了就断了升级链路，而且分不清效果变差是谁改的 |
| **技能共享** | **本期不做** | 一旦 A 的技能能跑在 B 的内容上，A 的 systemPrompt 就成了对 B 的注入面。第七节的安全论证全部建立在「只跑自己内容」上 |
| **权限** | 两个维度：`VipTier.rank` 管「能用多贵的模型」，`skillAuthoring` 管「能不能造技能」 | 合成一个的话，要停掉一个滥用者就只能降他的 VIP——那是在罚他付过的钱 |
| **触发时机** | 封闭枚举，用户只能**勾选**不能新造 | 时机要前端实现 |

### 两条容易被后人改坏的界线

1. **`LlmModel.label` 可以含模型名，`GenerationProduct.label` 永远不能。**
   要藏的不是「我们用了哪家」，而是**「哪个模型撑起哪个档位」**——整套档位定价
   建立在这上面。文本模型是用户自己在选，公开它不损失任何东西。
   **即使两者来自同一个渠道账户也不是一回事**，别看着不一致就改成一样。

2. **不要把 OpenRouter 塞进 `ProviderAdapter`。**
   那套抽象是给任务制生成渠道的（`submit` / `poll` / `fetchSchema` / `SubmitContext`），
   OpenRouter 一个都用不上。硬塞会让它长出一堆只有一家用得上的可选方法。

### 为什么不是 WaveSpeed / Atlas（形态否决，与模型目录无关）

| | WaveSpeed / Atlas | OpenRouter |
| --- | --- | --- |
| 调用 | 任务制：`submit` → 轮询。`prompt-optimizer.ts` 最长等 **26.5 秒** | 同步 chat，流式 <1 秒出首 token |
| 计价 | `basePriceUsd` **按次**，目录里没有 token 维度 | **按 token** |
| 文本模型 | 只有 `wavespeed-ai/prompt-optimizer`，**专用优化器不是通用 LLM** | 通用 |

三条任意一条都足够否决。**就算 Atlas 明天上架通用 LLM，前两条依然成立。**
边界：`prompt-optimizer` 继续在玩物专区跑，不并进技能系统。

### 待办里最该先做的两件

1. **实测 8.1 的三件事**：`stream_options` 怎么带出用量、`usage.cost` 是否即时可查
   （**有延迟的话结算就不能同步做**）、查不到时的兜底。9.1 明确标了这是未验证项。
2. **考虑把基础档换成 Qwen**：便宜 4.9 倍，且中文明显更强（6.4）。
   但要留切换时点，否则成本报表的毛利率会出现无法解释的台阶。

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
  tierCode           String            // basic | advanced | unrestricted（已上线取值）
                                       // 见 6.4「档位轴的局限」——S3 前可能要拆
  inputUsdPerMTok    Float             // 仅用于事前估算与前端展示，见 6.3
  outputUsdPerMTok   Float
  priceSyncedAt      DateTime?         // 从上游模型列表同步的时间
  priceMultiplierBps Int     @default(13000)
  contextTokens      Int     @default(8000)
  supportsStreaming  Boolean @default(true)
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

### 2.2b `LlmAccount` —— 上游账户

```prisma
model LlmAccount {
  id        Int      @id @default(autoincrement())
  provider  String   @default("openrouter")
  label     String
  apiKeyEnc String            // AES-256-GCM，与 HfAccount 同款
  baseUrl   String?           // 空则用 env 默认
  isActive  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

与 `HfAccount` / `OpenAiAccount` 同构。**不复用 `ProviderAccount` 与
`ProviderAdapter`**，理由是**接口形态不兼容**，不是「渠道不同」：

| | `ProviderAdapter`（WaveSpeed / Atlas） | OpenRouter |
| --- | --- | --- |
| 调用 | `submit()` → 轮询 `poll()` | 同步 chat-completions，可流式 |
| 还需要 | `fetchSchema()` / `SubmitContext` / `listRemoteModels()` | 一个都用不上 |
| 计价 | `basePriceUsd` 按次 | 按 token |

硬塞进 `ProviderAdapter` 会让那套抽象长出一堆只有一家用得上的可选方法。
现在这套抽象是干净的（加新上游只需加一个适配器），值得保住。

`OpenAiAccount` 不动，它是内容审查专用（moderations 免费），是另一条链路。

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
| —— S0/S1 现状 | **档位是自动选的**：成人模式 → 无限制档，其余 → 基础档。用户可见的模型选择要等 S2（见 9.1 第 2 条） |
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

### 6.2b 允许透支（已定）

`balance` **允许被 LLM 扣成负数**，`aiDebtMicro` **永不归零**（跨充值累计）。
规则只有两条：

1. **发起新调用要求 `balance > 0`。** 等于 0 就是没钱了，拦在入口。
2. **已经跑起来的调用一律结算到底**，哪怕把余额打成负数——上游的钱已经花了。

这比原设计的「预估上限 + 余额校验」更简单，也更准：预估本来就不可能准，
而透支额度**天然有界**——`maxOutputTokens` 硬顶 + 「同一时刻只允许一个 AI 动作」
（6.5）决定了单次最大成本。按现役档位算最坏情况（输入撑满 2000 token、
输出打满 600）：基础档 0.09 点、进阶档 1.43 点、无限制档 0.13 点。
**所以最大负值不超过 2 点**，不需要再配一个透支上限。

充值时负余额自然被填平（`balance += credits`），不需要特殊处理。

**生成端（图 / 视频 / 3D）不受此影响**：它现有的 `balance >= cost` 校验
在负余额下自动为假，照旧拦住。透支这条口子只对 LLM 开，因为两者的单次成本
差两个数量级——让人用负余额跑一次视频是另一回事。

### 6.3 定价公式

**`usd` 取上游返回的实际成本**，不用本地单价表算（见 8.1）。
`LlmModel` 上的单价只用于两件事：调用前给用户看的预估、以及管理端的价格监控。

```
usd      = 上游返回的本次实际成本（拿不到时才回退到本地单价 × token 数）
micro    = round( usd / USD_PER_CREDIT × 1000 × multiplierBps / 10000 )
micro    = max(micro, minChargeMicro)                       // 见 6.4
micro    = round( micro × (10000 - vipDiscountBps) / 10000 ) // VIP 折扣照旧适用
```

`multiplierBps` 沿用生成端口径：**普通 13000（130%）、无限制档 15000（150%）**，
与 `NORMAL_MULTIPLIER_BPS` / `SPICY_MULTIPLIER_BPS` 一致。
两条业务线共用同一个 USD/点锚点，否则同样 10 点买到的东西价值会差两个数量级。

### 6.4 默认定价表

> 上游单价快照取自 OpenRouter 公开模型列表，**2026-08-25 实拉 417 个模型**。
> 价格会变，以 8.1b 的同步机制为准，别把这张表当事实来源。
> 单次 = 输入 800 token（选区 + 前后文 + system + 模式规则）+ 输出 300 token。
> 普通档倍率 130%，无限制档 150%。

#### 已上线的配置（`lib/llm/models.ts`，S0 钉死 / S1 播种进 `LlmModel`）

| 档 | 模型 | in / out $·Mtok | 单次点 | 每点次数 |
| --- | --- | --- | --- | --- |
| `basic` | `openai/gpt-4o-mini` | 0.15 / 0.60 | 0.039 | ~26 次 |
| `advanced` | `openai/gpt-4o` | 2.50 / 10.00 | 0.650 | ~1.5 次 |
| `unrestricted` | Dolphin-Mistral-24B-Venice | 0.20 / 0.90 | 0.065 | ~15 次 |

这三个是按规划早期的**估算价**选的。实拉数据之后发现有明显更优解。

#### 实测更优候选（建议换）

| 档 | 建议模型 | in / out $·Mtok | 单次点 | 每点次数 | 相对现役 |
| --- | --- | --- | --- | --- | --- |
| `basic` | `qwen/qwen3.7-flash` | 0.030 / 0.130 | **0.008** | ~125 次 | **便宜 4.9 倍** |
| `advanced` | `openai/gpt-5.6-luna` | 0.20 / 1.20 | **0.068** | ~15 次 | **便宜 9.6 倍** |
| `unrestricted` | `thedrummer/cydonia-24b-v4.1` | 0.30 / 0.50 | 0.059 | ~17 次 | 略便宜 |

换基础档的理由不只是价格：**中文是本站主场景**，Qwen 系在同价位上的中文明显强于
gpt-4o-mini，上下文也从 128K 涨到 1M。备选 `deepseek/deepseek-v4-flash`
（0.016 点）、`z-ai/glm-4.7-flash`（0.022 点）、
`qwen/qwen3-30b-a3b-instruct-2507`（0.013 点）。

无限制档现役的 Dolphin **不建议动**——成人模式的提示词是照它调过的，
换模型要重新验一轮拒答行为，省下的钱不值这个风险。

其它可选：旗舰级 `anthropic/claude-sonnet-5`（0.598 点）、
`openai/gpt-5.1`（0.520 点）；uncensored 里更强的
`sao10k/l3.3-euryale-70b`（0.112 点）、
`nousresearch/hermes-3-llama-3.1-70b`（0.116 点）。

**怎么换**：S1 的播种是「只补不改」，改常量不会动已有 DB 行。
换档位要么在 `/admin/llm` 手改单价与 model id，要么写一次性迁移。
两条路都要在 `LlmUsageLog` 上留下切换时点，否则成本报表的毛利率会出现
一个无法解释的台阶。

#### 档位轴的局限（S3 前要处理）

现在 `tierCode` 的三个取值里，`unrestricted` 混了两件事：**质量档**和**内容尺度**。
实测数据显示 uncensored 模型本身横跨 0.059 到 0.546 点，质量差异很大。

S0/S1 这样写没问题——只有一个 uncensored 模型，档位即模型。
但到 S3 用户能自选模型时，「我要一个便宜的 uncensored」和「我要一个强的 uncensored」
就没法表达了。届时把 `tierCode` 收敛成纯质量轴（`basic | advanced | flagship`），
内容尺度全部交给已经存在的 `uncensored` 布尔字段。

**现在不用改。** 记在这里是因为改的时候会动到已播种的数据，要提前知道。

#### 一条被真实数据确认的事

微点结算（6.2）在换成 Qwen 之后**更加必要**：单次 0.008 点，
按整点 `ceil` 的溢价是 **125 倍**，而不是现役配置下的 25 倍。
`minChargeMicro = 5`（0.005 点）在新价下很贴边但仍成立——基础档单次 8 μ点，
再调高就抹平了它相对进阶档的优势。**维持 5。**

#### 两个坑

- **不要用 `~` 前缀的别名**（`~anthropic/claude-sonnet-latest`、
  `~deepseek/deepseek-v4-flash-latest`）。模型会在脚下换、价格跟着变，
  而成本核算与 8.1b 的价格同步都建立在稳定 model id 上。**钉死版本号。**
- **不要被 `:batch` 变体的价格误导**。它便宜约一半，但那是异步批处理，
  几分钟到几小时才返回——编辑器里用不了。

#### 参数支持（已核对）

`temperature` / `max_tokens` / `response_format`（JSON 模式）在上述所有候选上都支持，
上下文长度全部远超需要。uncensored 那几个是按模型描述里的关键词扫出来的，
**不是权威清单**——上游不保证标注，实际拒答行为必须拿成人模式的真实提示词实测。

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

**这个口可以开，但理由不是「两个池子」——池子是重叠的**：WaveSpeed 同时供
生成模型和文本模型（`wavespeed-ai/prompt-optimizer` 就在同一个渠道账户下）。

真正的理由是**要藏的是哪一件事**：

| | 生成模型（图/视频/3D） | 文本 LLM |
| --- | --- | --- |
| 要藏的秘密 | **哪个模型撑起哪个档位**——档位定价整个建立在这上面 | 无此依赖，用户自选模型就是功能本身 |
| 公开它会怎样 | 用户能算出终极档的成本价，定价体系失效 | 无影响 |
| 本期 | **继续藏，一个字不改** | **公开** |

**即使两者来自同一个渠道账户，也不能混为一谈。** 公开
`qwen/qwen-2.5-72b-instruct` 是某个技能在用的文本模型，
不等于泄漏了终极档背后是哪个视频模型——前者是用户在选，后者是商业机密。

现状已有先例：`magic-prompt.ts` 的响应里就带 `source: "dolphin"`。

**但界线要写进代码注释**：`LlmModel.label` 可以含模型名，
`GenerationProduct.label` 永远不能——两者不是一回事，日后别被人顺手改成一致。

### 7.3 uncensored 的门

`uncensored = true` 的模型必须同时 `requiresAdult = true`，在管理端保存时强制校验。
判定复用 `hasAdultAccess`，与 Spicy 档同一条逻辑，不新建一套。

---

## 八、工程坑

### 8.1 成本可得性（OpenRouter 下已解决）

选 OpenRouter 之后，原来「流式响应拿不到 usage 就只能按字符估算」这个问题消失了：
它提供**按次的实际成本**，计费用真账而不是估算，`supportsUsage` 字段与
整套估算兜底逻辑都不需要了。

接入时要验证的三件事（**以实测为准，不要照抄文档**）：

1. **流式请求怎么带出用量。** OpenRouter 支持在请求体里要求返回用量统计，
   但字段名与生效条件要实测——尤其是流式下它落在哪个 chunk。
2. **按次成本查询的调用时机。** 它有一个凭响应 id 查实际成本的接口。
   要确认成本是否立即可查，还是有延迟——**有延迟的话结算就不能同步做**，
   得落一条 `LlmUsageLog` 待结算行，异步补齐。这会改变 6.2 的结算时序，
   是接入阶段第一个要测的东西。
3. **拿不到成本时的兜底。** 任何一次查询失败都必须能退回本地单价 × token 数，
   并在 `LlmUsageLog` 标记为估算值。**不能因为查不到成本就不扣费。**

### 8.1b 价格同步

OpenRouter 有模型列表接口，带每个模型的单价。可以做成定时同步进 `LlmModel`，
配一个「上游价格已变动」的差异报告页——这与你已有的
`ProviderCatalogModel` 同步 + 能力差异报告是同一套模式，直接照搬。

意义在于：上游涨价时**你的毛利率会被悄悄吃掉**，而 `priceMultiplierBps` 是按
接入时的单价算的。没有这个同步，涨价你不会知道。

### 8.2 其余

- **超时与取消。** LLM 可能 30s+，编辑器里等不了。硬超时 15s，用户可随时取消；
  取消后**已产生的 token 照扣**（成本已发生），扣到负数也照扣（6.2b）。
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
| **S0** ✅ | 五个官方技能硬编码 + `selection` 时机 + 完整 AI 管线 | 打通端到端：浮条/底栏、流式 SSE、素材胶囊占位保护、审查、并发锁、预览卡（替换/插入/重试/放弃）。**模型与价格先写常量**，不进 DB |
| **S1** ✅ | `LlmModel` 表 + `LlmUsageLog` + 微点结算 + 管理端定价页 | 把 S0 的常量搬进 DB 并可运营。成本报表在这一期出来 |
| **S2** ✅ | `Skill` 表 + `skill-seed.ts` + 管理端技能 CRUD + 出厂值/覆盖/恢复默认 | 官方技能变成可配置。`manual` 时机接入，现有「魔法指令」归位成一个官方技能 |
| **S3** ✅ | 用户自建技能：fork / 从零 / JSON 导入导出 + `skillAuthoring` 权限位 | |
| **S4** | 其余四个时机：`block` / `slash` / `empty` / `submit` | 每个时机都是一份独立的前端交互，不要和 S0 混做 |

**强烈建议不要跳过 S0 直接做技能系统。** S0 要解决的是管线本身的问题——
流式、锚点、审查、并发、计费精度，每一条都会单独出错。
把它们和「技能配置从哪来」混在一期，出问题时分不清是管线坏了还是配置错了。

S1 排在 S2 之前是因为：S0 一上线就在花钱，成本可见性比技能可配置性更紧急。

### 9.1 S0 实际落地情况

**代码位置**

| 关注点 | 在哪 |
| --- | --- |
| 档位 / 模型 / 单价常量 | `lib/llm/models.ts` |
| 凭据解析 + 流式调用 + 15s 硬超时 | `lib/llm/chat.ts` |
| SSE 解析 + 半截占位符扣留 | `lib/llm/sse.ts`（纯函数，两端共用） |
| 用户级互斥 | `lib/user-lock.ts` |
| 流式改写 | `lib/prompt-rewrite.ts` 的 `streamRewriteSelection` |
| 路由（SSE / JSON 双形态） | `api/prompts/rewrite/route.ts` |
| 浮条 / 底栏 / 预览卡 | `prompt-editor/SelectionAiPlugin.tsx` |

**三处与本文原定方案不同的地方，都是实现时发现原方案不成立**

1. **上游先不绑死 OpenRouter。** `getLlmCredentials()` 的顺序是
   `OPENROUTER_API_KEY` → 站内已有的 HF 凭据。两家都是 OpenAI 兼容的
   chat-completions，代码一份就够。这样在拿到 OpenRouter key 之前，
   整条管线已经能用真实上游端到端验证——否则「先接账户、再验管线」，
   出了问题分不清是账户配错了还是管线本身有毛病。
   `LlmAccount` 表连同管理端留到 S1，与 `LlmModel` 一起进 DB。

2. **档位是自动选的，不是一律基础档**（6.4 原写「默认技能一律绑基础档」）。
   成人模式走无限制档，其余走基础档。原因是基础档挂的模型会拒答，
   成人模式下让它改写只会得到一句「抱歉我无法协助」——那比不给这个功能更糟，
   用户会以为站点坏了。无限制档挂的就是站内现在这个
   Dolphin-Mistral-24B-Venice，所以成人模式的行为与改造前一致。

3. **入口审查没有对短选区跳过**（8.2 原写「考虑选区 < 20 字时跳过」）。
   那条优化的前提是「短片段信息量不足以判定」，但我们审的本来就是
   **拼回上下文之后的整段**，跟选区多长没关系。跳过只会白白留一个洞。

**S0 明确没做、留给 S1 的**（均已在 S1 落地，见 9.2）

- 微点结算（6.2）与「拦截也扣费」（决定 #2）——这两条是一对，必须一起上。
- 取消 / 客户端断开时的结账。
- 成本报表（S0 只有服务端一行日志）。

**已验证 / 未验证**

- 已验证（假上游 + 路由编排单测，共 33 条）：chunk 从占位符中间断开不会闪出
  `[[RE`、usage 落在末尾空 `choices` 的 chunk 上能读到、上游中途发 error 事件
  会抛而不是当正常结束、出口审查拦截时**不扣钱**且走 error 事件、
  同一用户并发第二个请求被 429 挡住且第一个跑完会还锁。
- **未验证**：真实上游的 `stream_options` / `usage.cost` 到底怎么回
  （8.1 的第 1、2 条要求以实测为准）。假上游是照 OpenAI 规范写的，
  真机对不上时改动只会落在 `readUsage()` 一处。

> 注：S0 那一版「出口审查拦截时不扣钱」已被 S1 按决定 #2 改成**拦截照扣**，
> 对应的单测也一起改了。原因见 9.2。

### 9.2 S1 实际落地情况

**代码位置**

| 关注点 | 在哪 |
| --- | --- |
| 计费算术（纯函数） | `lib/llm/pricing.ts` |
| 结算 + 台账落库 | `lib/llm/billing.ts` |
| 模型注册表读写 + 出厂播种 | `lib/llm/model-store.ts` |
| 上游账户 | `lib/llm/account.ts`、`lib/llm/account-serialize.ts` |
| 管理端 | `/admin/llm`（账户 / 定价 / 成本报表三块一页） |
| 表 | `LlmModel`、`LlmAccount`、`LlmUsageLog`、`User.aiDebtMicro` |

**微点结算怎么实现的**

不是「读一次再写回去」，而是**带旧值的条件更新 + 有限重试**
（`updateMany({ where: { id, aiDebtMicro: 旧值 } })`）。两个请求同时读到
同一个零头再各自写回，后写的会把前一笔账整个吞掉。上层虽然有用户级互斥，
但那把锁是进程内的，多副本时不成立，所以并发正确性必须落在这一层。

抢四次都没抢到就放弃这一笔并打 error 日志——宁可漏收，也不能在结算里
死循环拖住用户的请求。

**扣费口径（决定 #2）已按原样实施**

判据只有一条：**上游跑了没有**。

| 情况 | 扣费 | `status` |
| --- | --- | --- |
| 正常出结果 | 扣 | `ok` |
| 出口审查拦截 | **扣**（上游已经跑过了，成本已经发生） | `blocked` |
| 用户中途取消 / 断开 | **扣**，用已收到的文字估 token | `canceled` |
| 硬超时 | 扣（同上） | `timeout` |
| 入口审查拦截、凭据缺失、连接就失败 | 不扣 | `failed` |

「拦截也扣费」在界面上写明了：错误文案后面会跟一句
「本次仍消耗 N 点：内容已经送到模型跑过了」。不写的话被拦的用户会觉得是白扣。

**三处实现时的补充决定**

1. **`status` 加了 `canceled`**（规划原枚举是 `ok | blocked | failed | timeout`）。
   「用户自己取消」和「上游炸了」对成本分析是完全不同的两件事：前者说明结果
   来得太慢或不合用，后者是故障。混在 `failed` 里报表就白做了。

2. **最低收费在 VIP 折扣之前生效。** 反过来的话，小额调用先打折再兜到下限，
   会员的折扣完全失效。有单测钉住这个顺序。

3. **`LlmModel` 播种「只补不改」**，与 `pricing-seed.ts` 同一条规矩：
   价格是运营数据，绝不能被一次部署重置回出厂值。库里查不到时退回
   `models.ts` 的常量——迁移没跑完或运营手滑把一个档位全停用了，
   改写功能都不该整个消失。

**报表看什么**

`/admin/llm` 顶部五个数：调用次数、上游成本、向用户收取、**毛利率**、
**成本靠估算的占比**。后两个是预警指标：

- 毛利率会在上游涨价时先掉下来，比盯着单价表更早。
- 估算占比居高不下，说明上游根本没回 `usage.cost`，那时报表里的「毛利」
  其实是拿我们自己的单价表在自证——要去查 8.1 的那三件事。

### 9.3 S2 落地情况

选区那五个动作和魔法指令**都已经从写死的代码变成库里的行**。管理端能改提示词、
改名称图标、限定模式、停用、恢复默认。

**代码位置**

| 关注点 | 在哪 |
| --- | --- |
| 出厂定义（六条官方技能） | `lib/skills/definitions.ts` |
| 模板渲染（纯函数） | `lib/skills/template.ts` |
| 播种 / 查询 / 差异 | `lib/skills/store.ts` |
| 创作端清单 | `/api/skills` |
| 管理端 | `/admin/skills` + `/api/admin/skills[/:id[/restore]]` |

**播种规则按第三节实施，与 `pricing-seed` 刻意不同**

没被改过的技能会**随版本升级覆盖**（我们改进了一版提示词，它自动跟上）；
改过的一个字不动。「停用」也算改过——否则运营有意关掉的技能会在下次部署
被重新启用。「恢复默认」两件事一起做：回填出厂值 **且** 清掉 `isOverridden`，
只做前者的话它会永远停在恢复的那一刻。

**四处与本文原定方案不同**

1. **`key` 改成全局唯一**，不是 `@@unique([scope, ownerId, key])`。
   ownerId 为 NULL 时那个复合约束在 SQL 里根本不去重（NULL != NULL），
   官方技能反而没有保护。官方用固定 slug、用户技能用 nanoid，全局唯一
   既不会误伤，也让播种的 upsert 有一个真能 upsert 的键。

2. **模板加了条件段 `{{#name}}…{{/name}}`**（2.5 原本只有变量替换）。
   不加不行：选区经常就在开头或结尾，那时「【前文，仅供理解】」下面跟着
   一片空白会照发给模型——模型会以为前文真的是空白，而不是「这次没有前文」。
   未知变量仍然原样保留，那是故意的失败方式。

3. **「补充细节」拆成两条技能**（`expand` 限图像、`expand-video` 限视频），
   而不是在一条提示词里写「如果是视频就……」。图像要的是把已有的东西描述得
   更具体，视频要的是接下一个动作——两个不同的任务塞进一条，模型会在两者之间摇摆。
   这正好用上了第一节设计的 `modes` 过滤。

4. **`modelKey` 支持 `"auto"`**，且所有出厂技能都用它。写死某个模型会让
   成人模式撞上会拒答的那一个（S1 的 `pickTier` 就是为此存在）。
   等 S2 后半把模型选择开放给用户时，`auto` 仍是默认值。

**两条不下发的边界**

- `/api/skills` **只回展示字段**，`systemPrompt` / `userTemplate` 一个字都不下发。
  官方提示词是产品资产，下发即公开。用户要它可以 fork（S3），那是有记录的路径。
- 技能作者只写「任务是什么」。**平台在 system prompt 前后各包一层**：
  前面是审查口径（只取决于用户有没有成人权限），后面是输出格式硬要求
  （一旦被改掉，返回的东西就没法安全放回选区）。这两层技能改不了，
  对应 7.1 的第一条。

**`manual` 时机与魔法指令归位**

魔法指令现在是官方技能 `magic-prompt`（`triggers: ["manual"]`），跑的是同一条上游、
同一套档位选择、同一套微点计费与用量台账。提示词管理端可改。

它在这套系统里唯一的特殊之处：**支持反向提示词的档位要求模型回一个 JSON**。
那条输出格式由平台包在外面（`skills/envelope.ts`），技能作者照样只写任务——
和选区级完全一致。`outputMode` 没有为它新增枚举值。

**本地规则兜底（`enhancePromptLocal`）没有搬进技能，也不该搬。** 那不是提示词，
是一段写死的拼接逻辑，用来在上游挂掉时保证按钮还有反应。它走这条路时
**一分钱不收**（一个 token 都没烧），界面会明说「上游未响应，已用本地规则扩写」——
不说的话用户会以为模型就这个水平。

**两条链路合并带来的三个后果**

1. **共用同一把用户级锁。** 「同一时刻只允许一个 AI 动作」是针对用户的，不是针对
   某个功能的——魔法指令正在重写整段的时候，选区级动作改的是一份马上就要被
   覆盖掉的文本。
2. **`/api/features` 只剩一个开关 `ai_text`。** 具体某个时机下有没有按钮，
   由 `/api/skills` 的技能清单决定；管理端把技能全停用了，开关是开的但菜单是空的。
3. **旧的 `ai_credits_per_1k_tokens` 已退休并删除**（设置项、管理端卡片、
   `ai-token-billing.ts`、`creditsForTokens` 一并删掉）。它那个「至少 1 点」的
   整点口径是真实成本的几十倍，现在两条链路都走微点。
   审计动作 `system_ai_token_rate` 保留在枚举里，因为库里的历史记录还要能显示。

**创作端的按钮也由技能驱动**：整段级按钮的名称、图标、说明都来自库。
第一个技能沿用魔法指令那身皮，之后再加的排在它后面。

### 9.4 S3 落地情况

**代码位置**

| 关注点 | 在哪 |
| --- | --- |
| 权限位判定 + 条数上限 | `lib/skills/access.ts` |
| 导入导出格式（zod） | `lib/skills/portable.ts` |
| 归属查询、fork、来源比对 | `lib/skills/store.ts` |
| 用户 API | `/api/skills/mine[/:id]` |
| 用户页面 | `/skills`（双语） |
| 管理端开关 | 用户详情页 + VIP 等级卡片 |

**最要紧的一条：执行时的归属校验**

`getSkillForRun(key, userId)` 取代了原来的 `getSkill(key)`，两个执行入口
（选区级、整段级）都换了过来。判据只有一条：**官方技能人人可用，用户技能
只有作者本人能跑**。

放开这条，A 写的 systemPrompt 就会跑在 B 的内容上——那正是第〇节把
「技能共享」整个划出去的原因，是完全不同量级的安全问题。也别因为
「反正 key 猜不到」就省掉它：key 会出现在导出文件里。这一条有专门的单测。

**四处规划之外的补充**

1. **每人最多 50 条技能。** 规划没提，但不设上限是明摆着的洞：技能是一行带
   两段长文本的记录，脚本刷几万条就能把库撑起来。官方总共才六条，50 条
   对真实用法绰绰有余。

2. **用户只能绑 `selection` / `manual` 两个时机。** 其余四个前端还没实现
   （S4），让用户勾只会造出一条永远不触发的技能，然后他会来问
   「为什么我的技能不工作」。

3. **用户技能的 `modelKey` 一律是 `"auto"`**，前端不给填。让用户自己指定
   模型就等于绕开 VIP 档位门槛直接点名贵模型。

4. **用户技能可以删，官方技能只能停用。** 官方的删了会让 `forkedFromKey`
   悬空、也会被下次播种建回来；用户自己的没有这两个问题，而「只能停用」
   会让列表越攒越长。删除只要求登录 + 归属，**不要求 `skillAuthoring`**——
   权限被收回的用户仍然应该能清理掉自己的东西。

**fork 的两种状态：跟随中 / 已独立**

> 这一节是上线后按实际使用反馈改的。第一版是「fork 当场拷一份快照，此后各走
> 各的」，用起来不对：刚复制出来还没动过的那份，跟官方一模一样，却收不到官方的
> 改进，还占着一个「已 fork」的名额。

现在：

| 状态 | 含义 | 怎么变过去 |
| --- | --- | --- |
| **跟随中** | 这只是一个**引用**。官方那条一变，它跟着变 | 点「复制官方技能」 |
| **已独立** | 一份真正属于用户的技能，不再跟随 | 用户把提示词改成与官方**当前内容**不同并保存 |

复用的就是官方技能自己那套 `isOverridden`，只是层级不同：官方跟随代码里的
出厂值，用户副本跟随库里的官方行。不必再造第二套状态机。

- **有一份跟随中的副本时，那条官方技能的「复制」按钮是灰的**——两份内容完全
  一样、又都会自动跟着官方变，留着只会让列表变乱。那份改过之后按钮重新亮起来。
- **判定「改没改」只看提示词相关字段**（systemPrompt / userTemplate / triggers /
  modes / outputMode / maxOutputTokens / temperature）。名称、图标、说明、启用与否
  是用户自己的东西：给副本改个名不该让它掉出升级链路，官方改了名也不该把用户
  起的名字冲掉。
- **传播时机**：管理端编辑官方技能、恢复出厂、以及播种升级官方提示词时，各推一次。
- **「来源已更新」的提示只对已独立的副本出现**。跟随中的本来就一直是最新的，
  对它提示只会让人困惑。判据仍是 fork/落地那一刻记下的 `forkedFromAt` 与官方
  当前 `updatedAt` 相比。**只提示，不自动合并**——用户已经改过自己那份，
  合并只能靠猜。点「知道了」只是把时间戳对齐，不动任何内容。

**一个差点造成静默数据丢失的迁移**

第一版写进库的 fork 行是 `isOverridden = false`（当时这个字段对用户技能没有
含义）。新规则下这个值意味着「跟随中」——语义整个反过来了。如果用户已经改过
其中一条，下一次管理端编辑官方技能就会把他的改动**静默冲掉**。

`scripts/migrate-skill-fork-link.mjs` 把存量用户技能一律标记为「已独立」。
代价是「复制了但还没改」的那几条不会自动跟随（删掉重新复制一次即可），
换来的是没有任何人的改动会被悄悄覆盖。这个方向的取舍不需要犹豫。

**顺带被单测按住的一个死锁**

`propagateToLinkedForks` 最初通过 `getOfficialSkill` 读官方内容，而那个函数会
先确保播种完成；播种本身在升级一条官方技能之后又会调到传播——内层等外层的
`seeding` 标志放开，外层等内层返回，整个进程卡死。改成直接读库。

**导入导出**

格式是 `Skill` 的公开字段子集，带 `version`。不含 id / ownerId /
isOverridden / isActive / sortOrder——那些是「这条记录在这个库里的位置」，
不是技能本身，跟着 JSON 走只会让导入方接管一份别人的内部状态。
没有版本号或版本号对不上的文件一律拒绝，而不是当成 v1 读。

`forked_from_key` 指向不存在的官方技能时**丢掉而不报错**：它只是一条来源提示。

**一个顺带发现的问题**

`/skills` 页面最初 17.9 kB，因为它从 `portable.ts` 里 import 了一个纯字符串
工具函数，把整个 zod 一起打进了客户端包。把那个函数挪到 `portable-file.ts`
之后降到 **3.05 kB**。类型是 `import type`，本来就不进包。

### 9.5 技能绑模型 / outputMode 收敛

**按技能绑模型（原来「进阶档够不着」的那个洞补上了）**

`Skill.modelKey` 从只写 `"auto"` 变成真的可选：管理端与用户的技能编辑器各有一个
下拉。`resolveSkillModel()` 取代了原来直接调 `resolveLlmModel(pickTier(...))`。

三条规则：

1. **用不了绑定模型的用户，看不到这条技能**——整条从菜单里消失，而不是
   显示了点下去再报错。判的是「技能配成了哪个模型」而不是「这次实际会跑哪个」：
   后者在成人模式下会自动切档，拿它判会让绑了进阶档的技能对非会员也亮起来。
2. **用户的模型下拉只列他用得上的**。列一排点不动的选项，除了让人猜「我要充到
   什么档」没有别的作用。服务端 PATCH 里再判一次——那份清单是给人看的，
   这里才拦得住脚本。
3. **成人模式下遇到会拒答的模型，仍然自动改用无限制档**，即使技能绑死了别的。
   基础 / 进阶档挂的都是会拒答的模型，不换只会得到一句「抱歉我无法协助」——
   那比不给这个功能更糟。这条在两个编辑器上都写明了。

`modelKey` 也进了镜像字段：跟随中的副本换了模型就算「改过」，落地成独立技能。
界线是**凡是影响它怎么跑的都算改，只有纯装饰（名称 / 图标 / 说明 / 启停）不算**。

**`outputMode` 从四个值收敛到两个**

原来的 `replace | insert | append | card` 里，`insert` 与 `append` 删掉了：
**「插入下方」本来就是预览卡上一颗按钮**，用技能配置再表达一遍是多此一举，
而且会出现「技能说 append、按钮说替换」这种自相矛盾的状态。

真正需要区分的只有一件事：**这次的输出是不是用来顶替原文的**。

| 值 | 预览卡 |
| --- | --- |
| `replace`（默认） | 替换 / 插入下方 / 重试 / 放弃 |
| `card` | **只读**，只有重试与「知道了」 |

`card` 是为「检查这段有什么问题」那类技能存在的：它回的是一段评语，用户顺手点
「替换」就会把评语写进提示词里——看起来还挺像回事，可能到出片不对才发现。
整段级（`manual`）的只读结果显示在提示词框下方的面板里，同样不碰正文。

字段仍是 String，以后真要加值不用迁移；导入老文件时遇到已删掉的 `insert` /
`append` 按 `replace` 收下，而不是整份拒绝。

### 9.6 提示词引用参考图时，把图一起发给模型

提示词里写了 `@Image1`，模型原本只看得到 `[[REF1]]` 这个占位符，**完全不知道那张图
长什么样**。于是「补充细节」只能凭空编材质与光影，编出来的和参考图对不上——
而用户之所以传这张图，要的正是「照着它写」。

现在引用到的参考图会随请求一起发上去（OpenAI 那套多模态数组写法）。

**视频与音频不带。** 视频要抽帧、还要决定抽哪几帧，成本和不确定性都高一个量级，
是独立的一件事；音频更是另一条路（得先转写）。

**四条约束**

1. **URL 只放行落在自家对象存储上的**（`skills/vision.ts`）。前端传什么就发什么，
   等于开了个「让我们的 LLM 账户去取任意地址」的口子——取图的是上游而不是我们，
   所以不是经典 SSRF，但拿我们的账户去拉外部内容，被判滥用是连坐所有用户的。
   剩下的风险有界：桶里的对象键按内容哈希生成，猜得到 key 就说明手里本来就有那个文件。
2. **一次最多 4 张**，按 `[[REF]]` 顺序取，同一张只带一次。
3. **`detail: "low"`**。约 512px 的视图足够认出主体、色调、光线与构图——写提示词要的
   就是这些。开高精度一张图能顶两三千 token，比整次改写的其余部分加起来还贵，
   而多出来的那点材质细节对提示词帮助有限。
4. **用户消息末尾会说明这几张图分别对应哪个占位符**。不说的话模型只知道「有几张图」，
   两张参考图时它会张冠李戴——那正是用户最容易发现、也最恼火的错。

**模型读不了图就一张都不带**

`LlmModel` 新增 `supportsVision`。发给纯文本模型只会报错或**被无声忽略**，
而无声忽略更糟：用户以为模型看过图了。

⚠️ **成人模式下目前带不了图**：无限制档挂的 Dolphin-Venice 是纯文本模型
（2026-08 在 OpenRouter 的 `input_modalities` 上核对过），而那一批社区
uncensored 模型里**没有一个带视觉**。想要的话，同族里最接近的是
`mistralai/mistral-small-3.2-24b-instruct`（Dolphin 的底模，$0.075/$0.20，
比现在这个还便宜），在 `/admin/llm` 改 `providerModelId` + 打开读图开关即可，
不用发版。但那是产品决定——它比 Dolphin 保守，不该由代码替运营做。

**界面会说这次带了几张图**（预览卡上一条蓝色横幅）。模型是照着图写的还是全凭
文字猜的，两种结果的读法完全不同，不说的话用户没法判断。

**部署顺序**：`migrate-llm-vision.mjs` 必须跑在 `prisma db push` **之后**——
这一列是新加的，push 之前不存在。其余前置脚本都在 push 之前，只有它在后面。
需要它是因为 `LlmModel` 播种「只补不改」，已存在的行拿不到新字段的正确值，
会停在 false，表现是「引用了参考图但模型好像没看见」且没有任何报错。

**S1 没做的**

- **8.1b 的价格自动同步**（从 OpenRouter 模型列表拉单价 + 差异报告）。
  不在 S1 的范围里，而且它的价值依赖于先有一段真实用量。
- **进阶档对用户可见的模型选择**。S1 只是把三档写进了库，档位仍由
  「成人模式与否」自动决定，没有选择界面——那要等 S2 的技能配置。
- **旧的 `ai_credits_per_1k_tokens` 设置没有删**：魔法指令还在用它。
  它会在 S2 魔法指令归位成官方技能时一并退休，管理端已写明这一点。

---

## 十、已确认的决定

| # | 事项 | 结论 |
| --- | --- | --- |
| 1 | 基础档怎么接 | **不新开 provider 账户类型**。`HF_INFERENCE_BASE_URL` 默认就是 `https://router.huggingface.co/v1`——HuggingFace Router 本身是 OpenAI 兼容的多模型网关，`testHfToken` 已经在直接打 `/chat/completions` 传任意 `model`。改法见 10.1 |
| 2 | 失败 / 取消 / 被拦的扣费口径 | **上游已跑 = 扣；上游没跑 = 不扣。** 必须写进用户可见文案，尤其是「审查拦截也扣费」这条 |
| 3 | `aiDebtMicro` 归零与负余额 | **永不归零；LLM 允许把余额扣成负数。** 详见 6.2b |
| 4 | 官方技能初始清单 | 就是编辑器规划里那五个：按模式润色 / 译成英中 / 补充细节 / 精简到上限 / 加重这一句 |
| 5 | `minChargeMicro` | **5**（0.005 点） |
| 6 | 进阶档对非 VIP | **不开放。** 它是 VIP 的实感权益，且成本高 17 倍 |

### 10.1 上游选型：**OpenRouter**（已定）

`HfAccount` 这条线不用了。候选只在 WaveSpeed / Atlas / OpenRouter 三家之内。

**先说为什么 WaveSpeed 与 Atlas 出局——是接口形态否决的，与它们的模型目录无关：**

| | WaveSpeed / Atlas | OpenRouter |
| --- | --- | --- |
| 调用方式 | **任务制**：`submit` → 轮询 `/predictions/{id}/result` | 同步 chat-completions |
| 首字延迟 | 全部跑完才有字。`prompt-optimizer.ts` 的轮询循环最长 **26.5 秒** | 流式，通常 <1 秒出首 token |
| 计价单位 | `basePriceUsd` **按次**，目录里没有 token 概念 | **按 token** |
| 自身定位 | `providers/meta.ts` 开头即写「**生成渠道**的静态元信息」 | 文本 LLM 聚合层 |
| 现有文本模型 | 只有 `wavespeed-ai/prompt-optimizer`，**提示词优化专用**，不是通用 LLM | 通用 |

三条否决，任意一条都够：

1. **任务制拿不到流式。** 选中一句话点润色要空等数秒到半分钟，屏幕上一个字没有。
   而「补充细节 / 延展镜头」这类技能的用法就是边看边停——在任务制下根本做不出来。
2. **按次计价撑不起「按 token 扣费」。** 这是明确的产品需求，那两家的目录里
   压根没有 token 这个维度。
3. **没有通用 LLM。** 技能系统的核心是用户自写 systemPrompt 跑任意任务，
   拿一个提示词优化器去跑「译成英文」或用户自定义技能，它不是干这个的。

**这个论证不依赖那两家的目录内容**——就算 Atlas 明天上架通用 LLM，
前两条依然成立。

**边界**：WaveSpeed 的 `prompt-optimizer` **不并进技能系统**，继续在玩物专区跑。
这与 `prompt-optimizer.ts` 里已有的注释一致——「与创作中心的魔法指令是两条独立链路，
互不替代」。两条链路保持独立，别为了「统一」去合并两种不兼容的语义。

剩下的选项与它们各自的连带后果：

| 方案 | 三档能否一个账户覆盖 | `unrestricted` 档 | 8.1（usage 可得性） | 中文质量 | 风险 |
| --- | --- | --- | --- | --- | --- |
| **OpenRouter** | ✅ 一个 key 通所有模型 | ✅ 有社区 uncensored 模型 | ✅ 有按次成本查询接口，**8.1 直接消失** | 可挑 Qwen / DeepSeek 系 | 多一层转发，延迟略高 |
| **OpenAI 直连** | ❌ | ❌ 会被拒答 | 需 `stream_options.include_usage` | 一般 | uncensored 档无解，要再接第二家 |
| **国内厂商**（DeepSeek / 百炼 / 智谱） | ❌ | ❌ | 各家不一 | ✅ 最强 | **成人向内容大概率封号**，与本站核心场景冲突 |
| **自建 / 第三方 uncensored 网关** | ✅ | ✅ | 取决于实现 | 取决于模型 | 稳定性与合规责任全自担 |

选定 **OpenRouter**，三条理由：

1. **一个账户覆盖三档。** 基础档挑便宜的中文模型、进阶档挂 GPT-4o / Claude、
   无限制档用社区 uncensored 模型，全在同一个 key 下。省掉「接第二家」的整套账户体系。
2. **8.1 直接消失。** 它提供按次的实际成本查询，不必再赌流式响应给不给 `usage`，
   也不必按字符估算。`LlmModel.supportsUsage` 这个字段连同它的估算兜底逻辑都可以删掉，
   而且成本报表是**真账**而不是估算。
3. **定价维护成本低。** `inputUsdPerMTok` / `outputUsdPerMTok` 可以从它的模型列表接口
   同步，不用人工逐个填——这和你已有的 `ProviderCatalogModel` 同步模式是同一套思路。

代价两条：

- **多一层转发的延迟**，首 token 比直连 OpenAI 高一些。但对比任务制的秒级轮询，
  仍然快一个数量级，「润色一句话」这种场景完全可以接受。
- **依赖集中**：OpenRouter 账户级故障 = AI 技能全挂。它本身是聚合层，
  单个模型故障会路由到别家，但账户层面没有兜底。
  降级路径用现成的 `enhancePromptLocal`（本地规则扩写，已在跑）。

**国内厂商这条要特别说清**：中文质量确实最好、价格也最低，但本站有成人模式与
Spicy 档，把这类内容送进国内厂商的接口是**封号级风险**，而且是连坐整个账户。
除非只用它跑非成人模式的基础档，那又变成两家账户，省下的钱抵不过复杂度。

选定后要落的改动（与 provider 无关，接口都是 OpenAI 兼容）：

| 项 | 改动 |
| --- | --- |
| 账户模型 | 新增 `LlmAccount`，与 `HfAccount` / `OpenAiAccount` 同构。不复用 `ProviderAccount` / `ProviderAdapter`，理由见 2.2b（接口形态不兼容） |
| `HfAccount` | 保留但不再服务技能系统。现有「魔法指令」在 S2 归位成官方技能时一并迁走，之后可下线 |
| `OpenAiAccount` | **不动。** 它是内容审查专用（moderations 免费），与技能系统是两条链路 |
| `LlmModel.provider` | 取值改为 `openrouter`（或选定的那家），保留字段以便日后多家并存 |
