# 草稿 · 模板 · 提示词编辑器 · 引用格式 —— 工程规格

> 状态：待确认两处后开工。
> 对应需求：编号 1–11。

## 一、11 条归并成 4 个子系统

| 子系统 | 覆盖需求 | 独立性 |
| --- | --- | --- |
| A. 提示词编辑器（放大弹窗 + 素材轨 + Markdown） | 1, 2, 12 | 完全独立，可先做 |
| B. 媒体引用的规范形式与按模型渲染 | 3 | 独立，但需要你提供各家语法 |
| C. 草稿实体与生命周期 | 4, 5, 6, 7, 8, 9 | 地基，其他都压在它上面 |
| D. 模板与兼容性 | 10, 11 | 依赖 C |

**动工顺序：C → D → A → B**。C 是地基；A 虽然独立但价值密度低，可以插空做；
B 卡在外部信息上，不该挡住前面三个。

---

## 二、决策一：草稿用**新表**，不复用 Generation（回答需求 9）

你让我选「哪个更省工作量以及数据更安全」。两个答案指向同一边。

### 不选的方案：给 Generation 加一个 `status = "draft"`

看起来省事——草稿本来就是「未完成的生成记录」，字段几乎一样。但：

`Generation` 被大量查询读取：`/api/generations`、`/explore` 公开画廊、
管理端统计、媒体保留与清理任务、成本核算。加一个 draft 状态意味着
**这些地方每一处都要补上排除条件**。漏掉任何一处的后果按严重性排序：

1. 草稿泄漏进 `/explore` —— 未完成的私人内容公开可见
2. 草稿被媒体清理任务当成过期作品，删掉用户还在编辑的上传件
3. 草稿混进成本报表和管理端统计

而且 `Generation` 上 `cost` 是 NOT NULL、`prompt` 是 NOT NULL，草稿两样都可能没有。
要么放宽约束（削弱现有数据的完整性保证），要么塞假值。

### 选定：新建 `Draft` 表

- **更安全**：草稿不可能出现在任何现有查询里——这是结构上的不可能，
  而不是「记得加过滤条件」的自觉。上面三种事故被物理排除。
- **更省工**：不必审计二十来处 Generation 查询。新增表是纯加法，
  对线上数据零风险（Railway 部署时是建表，不是改表）。
- 两者生命周期本就不同：草稿可变、用户自有；生成记录不可变、
  带成本、带审核状态与媒体保留策略。

### 指针方向：`Draft.generationId`，不是 `Generation.draftId`

需求 9 的字面是「生成记录引用草稿」，但需求 8 要的是**从草稿查任务单**
（打开草稿页 → 查它的 task 跑完没 → 跑完就删）。指针挂在 Draft 上：

- 直接服务需求 6、7、8
- 草稿删除后不会在 Generation 上留下悬空引用

概念上「生成记录是完成了的草稿」这层关系仍然成立，只是不需要物理外键来表达。

---

## 三、决策二：模板**独立成表**，不做 `Draft.isTemplate`

共用一张表加个布尔位更省字段，但草稿有一条**自动删除**规则（需求 6），
模板绝不能被它扫到。把「必须记得跳过 isTemplate」放进删除逻辑，
是迟早会踩的雷——而代价是用户攒了几个月的模板一次性消失。

两张表，但**共用同一套快照编解码**（见 §五），套用与恢复只有一份实现。

---

## 四、决策三：媒体引用的规范形式（需求 3）

### 现状

`PromptMentionBox` 插入的是字面 token（`@Image1`），提交时
`buildProviderInputs` 里 `inputs.prompt = args.prompt.trim()`——
**原样上行，不做任何处理**。今天恰好对 Seedance 有效，因为它就认这个格式。

### 设计

提示词里存**规范形式**，提交时按目标模型渲染：

```
存储（草稿/模板/生成记录）    @image1  @video1  @audio1
        │
        ▼  渲染器按 modelId 查语法表
提交上游    Seedance → @image1        （原样）
           某家     → [image_1]
           某家     → 图1
           某家     → 整体抹掉，仅靠数组顺序
```

**语法表数据驱动，不写死在代码里**——照 `ModeParamMapping` 的先例做一张
`ModelRefSyntax`，管理端可编辑。理由：模型换得比发版快，写死意味着
每次上新模型都要改代码发布。

默认值是**原样透传**，所以接进去的那一刻行为不变，不会回归。

### 已确认的两家

| 模型族 | 语法 | 出处 |
| --- | --- | --- |
| Seedance | `@image1` / `@video1` / `@audio1` | schema 原话：Cite reference inputs in submission order with @-syntax |
| Wan 2.7（参考生视频） | `character1` / `character2` | Atlas 文档：Use labels like "character1" and "character2" to map reference materials to characters |

**Wan 这条格外说明问题**：它不带 `@`，而且语义是「把参考素材映射到角色」，
不是泛指的第 N 份素材。这正是不能靠猜的理由——两家的写法和语义都不一样。

### 其余各家：兜底表

不逐个去猜。`ModelRefSyntax` 表带一条**兜底规则**（默认原样透传），
新模型接进来先走兜底，确认了语法再补一行。语法用模板串表达，如
`@image{n}` / `character{n}`，`{n}` 是该类型内的序号。

---

## 五、决策四：兼容性用**读取时校验**，不用写入时冻结（需求 11）

草稿和模板都会遇到：存的时候是模型 A，用的时候模式已经换成模型 B，
媒体位数量对不上、参数字段不存在了。

**不要在存储时算一个 `compatible` 标志位**——模型随时可能在管理端被换掉，
标志位从写下的那一刻就开始腐烂，而且没有任何东西会去刷新它。

改为列出草稿/模板时按当前 specs 现算，结果分三档：

| 判定 | 含义 | 表现 |
| --- | --- | --- |
| `ok` | 媒体位与参数都对得上 | 正常显示 |
| `degraded` | 有多余媒体或未知参数会被丢弃 | 黄标，套用时列出将丢什么 |
| `broken` | 必填媒体位缺失，套用后不能直接生成 | 红标，套用后停在编辑态并指明缺什么 |

现算的成本是一次 specs 查询，而且**永远正确**。

---

## 六、数据模型

```prisma
/// 草稿：尚未生成的编辑状态。刻意与 Generation 分表，理由见 §二。
model Draft {
  id              Int      @id @default(autoincrement())
  userId          Int
  mode            String
  tier            String   @default("low")
  spicy           Boolean  @default(false)

  /// 编辑时命中的档位与上游模型，用于事后判定兼容性（§五）
  productId       Int?
  providerModelId String?

  title           String?  /// 用户可命名；空则取 prompt 前若干字
  prompt          String   @default("")
  negativePrompt  String?
  /// 表单快照 JSON，与 PromptTemplate 共用编解码
  snapshot        String   @default("{}")

  /// 点击生成后挂上的任务单，供需求 8 的对账使用
  generationId    Int?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])

  @@index([userId, updatedAt])
  @@index([userId, mode, updatedAt])
  @@index([generationId])
}

/// 模板：命名保存、可重复套用。独立于 Draft，免于自动删除规则（§三）。
model PromptTemplate {
  id                 Int      @id @default(autoincrement())
  userId             Int
  mode               String
  tier               String?
  spicy              Boolean  @default(false)
  productId          Int?
  providerModelId    String?

  name               String
  prompt             String   @default("")
  negativePrompt     String?
  snapshot           String   @default("{}")

  /// 来源留痕：从哪个草稿或哪件作品存下来的
  sourceDraftId      Int?
  sourceGenerationId Int?
  useCount           Int      @default(0)

  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])

  @@index([userId, mode, updatedAt])
}
```

两张都是**新增表**，不动任何现有表结构，Railway 部署是建表不是改表。

`snapshot` 存的就是现在 `MakeDraft` 那个形状（ratio / batch / duration /
extraParams / media 等），复用现成的类型。

---

## 七、生命周期（需求 6、7、8）

```
编辑中 ──防抖回写──> Draft（每个模式一条「活动草稿」）
   │
   │ 点击生成
   ▼
Draft.generationId = 新任务 id
   │
   ├─ 任务 succeeded ──> 删除 Draft（主路径，在任务收尾处删）
   │
   └─ 收尾没删掉（进程重启、异常退出）
            │
            ▼
      打开「我的草稿」页时对账：
      有 generationId 的草稿 → 查任务状态 → 已 succeeded 则删
      （需求 8 的备案方案）
```

失败或取消的任务**不删草稿**——那正是用户要改了重试的场景。

现有的 IndexedDB 草稿（`lib/draft-store.ts`）保留，作为断网与崩溃的即时层；
服务端 Draft 是可列出、可长期保存的那一层。两者不冲突：本地是"这一秒的编辑"，
服务端是"这条草稿"。

---

## 八、提示词编辑器（需求 1、2）

- 放大按钮 → 全屏弹窗，同一个受控 state，不复制一份
- 弹窗内保留 @ 引用菜单与媒体缩略图，否则放大反而更难用

### Markdown 的语义：已确认为「仅编辑辅助」

编辑器提供分段、列表、预览，**上行的仍是原始文本**，与编辑器内容逐字节一致。
提示词是原样送进模型的，任何渲染都会改变模型实际读到的字符串。

### 素材轨（需求 12）

放大后的弹窗底部列出已上传素材。桌面端悬停出两个按钮：
眼睛看大图（大图弹窗里也有「引用」），箭头直接引用。触屏没有 hover，两个常显。
引用一律插到光标处。

---

## 九、分阶段

| 阶段 | 内容 | 完成标准 |
| --- | --- | --- |
| **C1** | Draft 表 + 快照编解码 + 活动草稿自动回写 | 刷新/换设备后草稿还在 |
| **C2** | 「我的草稿 / 我的作品」分栏 + 点击草稿跳回对应模式 | 与套用走同一条恢复路径 |
| **C3** | 生成后删除 + 打开草稿页对账 | 造一次「收尾没删」验证备案生效 |
| **D1** | PromptTemplate 表 + 从草稿/作品存为模板 | 两个入口都能存 |
| **D2** | 模式内列出模板 + 套用确认弹窗 | 套用前能看到将丢弃什么 |
| **D3** | 兼容性三档判定与标记 | 换掉某模式的模型后，标记立刻正确 |
| **A1** | 放大弹窗 + 素材轨 + 引用插入 | ✅ 已完成 |
| **A2** | Markdown 编辑辅助 | 上行文本与编辑器内容逐字节一致 |
| **B1** | ModelRefSyntax 表 + 渲染器 + 管理端 | 默认透传，行为不变 |
| **B2** | 填各家语法 | Seedance / Wan 已确认，其余走兜底 |

---

## 十、已确认

1. **Markdown 语义**：仅编辑辅助，原始文本上行。
2. **引用语法**：Seedance 与 Wan 2.7 已确认（见 §四），其余各家走管理端兜底表，
   不猜。

下一步：**C1**（Draft 表 + 快照编解码 + 活动草稿自动回写）。
