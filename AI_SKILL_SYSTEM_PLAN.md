# AI 技能系统 · 工程规格

> 状态：**S0 已实现**（见 9.1），待确认项已全部收敛为第十节的决定。
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
（6.5）决定了单次最大成本，基础档不到 1 点、进阶档约 2–3 点。
所以最大负值就是一次调用的成本，不需要再配一个透支上限。

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
| **S1** | `LlmModel` 表 + `LlmUsageLog` + 微点结算 + 管理端定价页 | 把 S0 的常量搬进 DB 并可运营。成本报表在这一期出来 |
| **S2** | `Skill` 表 + `skill-seed.ts` + 管理端技能 CRUD + 出厂值/覆盖/恢复默认 | 官方技能变成可配置。`manual` 时机接入，现有「魔法指令」归位成一个官方技能 |
| **S3** | 用户自建技能：fork / 从零 / JSON 导入导出 + `skillAuthoring` 权限位 | |
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

**S0 明确没做、留给 S1 的**

- **微点结算（6.2）与「拦截也扣费」（决定 #2）是一对，必须一起上。**
  现在的扣费仍是整点、下限 1 点，一次基础档改写的真实成本约 0.039 点——
  按整点收就是成本的 25 倍。在这个精度下单独实施「审查拦截也扣费」，
  被拦一次就扣满 1 点，用户的观感会非常差。等 `aiDebtMicro` 落地后一并改。
- **取消 / 客户端断开时不扣费。** 上游的 token 确实花了，但流式下取消就拿不到
  `usage`，没有 `LlmUsageLog` 也没地方挂这笔待结算的账。透支面很小
  （单次成本有界），S1 补。
- 成本可见性目前只有服务端一行日志（`[prompt-rewrite] … cost=… charged=…`），
  报表要等 `LlmUsageLog`。

**已验证 / 未验证**

- 已验证（假上游 + 路由编排单测，共 33 条）：chunk 从占位符中间断开不会闪出
  `[[RE`、usage 落在末尾空 `choices` 的 chunk 上能读到、上游中途发 error 事件
  会抛而不是当正常结束、出口审查拦截时**不扣钱**且走 error 事件、
  同一用户并发第二个请求被 429 挡住且第一个跑完会还锁。
- **未验证**：真实上游的 `stream_options` / `usage.cost` 到底怎么回
  （8.1 的第 1、2 条要求以实测为准）。假上游是照 OpenAI 规范写的，
  真机对不上时改动只会落在 `readUsage()` 一处。

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
