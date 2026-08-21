# 模型能力档案（Model Capability）设计

> 目标：把「一个上游模型能收什么、能产出什么」从**运行期猜**改成**入库前声明一次**。
> 范围：现有两家上游（WaveSpeed / Atlas Cloud）的存量模型，不引入新上游。

---

## 一、先说结论：不需要你去填 API 链接

`syncProviderCatalog` 已经把两家的原始 schema 全部抓进库了：

- **Atlas**：模型列表带 `schema` 字段（指向 `static.atlascloud.ai/model/schema/*.json`），
  同步时按 `schemaUrl` 变化增量抓取，落在 `ProviderCatalogModel.apiSchema`
- **WaveSpeed**：schema 内联在 `/models` 响应的 `api_schemas[].request_schema` 里，
  同步时直接落库

也就是说 **1278 个模型的原始 schema 已经在你的数据库里**。缺的不是数据，是**解释**。

需要人工介入的不是 1278 行，而是配置里真正用到的 **68 个模型**（见附录），
而且只需要复核派生结果对不对，不需要抄任何东西。

---

## 二、现在乱在哪：四层互不相识的猜测

| 层 | 位置 | 做法 | 失效方式 |
|---|---|---|---|
| 输入是不是媒体 | `mediaKindOfField` | 按**字段名**正则猜 image/video/audio | 靠 `NON_MEDIA_FIELD` 反向排除 `num_images`/`image_size` 之类误伤；新模型起个新名字就漏 |
| 输入必填性 | `resolveMediaInputs` | 从 schema 推 | 曾把 `minItems` 当成 `required`（已修） |
| 输出是什么 | `detectMediaKindFromUrl` | 按结果 **URL 扩展名**猜 | CDN 直链没有扩展名时按 mode 兜底赌一把 |
| 模式↔模型 | `VIDEO_MODEL_CANDIDATES` | 硬编码 id 表 + 正则兜底 | id 写错/上游下架时静默落到 pattern，绑到计价口径不同的模型上 |

四层都是**事后猜**，没有一处是**声明**。加一个模型要在四个地方同时对上，
而且哪一层猜错了都只在用户点生成时才暴露。

三个已经发生过的实例：

- `seedance-2.5/reference-to-video` 只有 Atlas 有、WaveSpeed 没有，
  但候选表把两家混在一起，看不出某个 id 属于谁
- 同一个 `seedance-2.5`，Atlas $0.134/秒、WaveSpeed $0.36/秒，
  候选表的排序决定了毛利是 2.7 倍还是 1%，而这件事没有任何地方记录
- `kling-video-o3-std` 的 `multi_prompt` 声明 `minItems:1` 却不在 `required` 里，
  正是 `minItems ≠ required` 这个坑的形态

---

## 三、提议：一张能力表，运行期只读它

### 3.1 数据模型

```prisma
model ModelCapability {
  id         Int      @id @default(autoincrement())
  provider   String   // wavespeed | atlas
  modelId    String

  /// 归一化输入位（JSON，见 3.2）
  inputs     String   @default("[]")
  /// 声明产出（JSON，见 3.3）
  outputs    String   @default("[]")
  /// 提示词里怎么引用素材；沿用现有 ModelRefSyntax 的语义
  refSyntax  String?

  /// derived = 由 schema 自动派生；manual = 人工覆盖过，派生不再动它
  source     String   @default("derived")
  /// 派生时所用 schema 的哈希。schema 变了就重新派生（manual 的只标记待复核）
  schemaHash String?
  /// 待复核队列用
  reviewedAt DateTime?
  note       String?

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([provider, modelId])
  @@index([source, reviewedAt])
}
```

### 3.2 输入位归一化

```jsonc
{
  "field": "reference_images",   // 上游真实字段名，提交时原样用
  "kind":  "image",              // image | video | audio | model3d | text
  "role":  "reference",          // 见下表
  "min": 0, "max": 30,           // 数量区间，min>0 才是必填
  "label": "参考图"               // 站内展示名（i18n key 或直接文案）
}
```

`role` 是这套体系的核心 —— 它把「上游各叫各的」收敛成站内固定的几种语义：

| role | 含义 | 上游常见字段名 |
|---|---|---|
| `subject` | 主体图/首帧 | `image`, `start_image`, `input_image` |
| `end_frame` | 尾帧 | `last_image`, `end_image` |
| `reference` | 参考素材（可多份） | `reference_images`, `images`, `sref` |
| `mask` | 蒙版 | `mask`, `mask_image` |
| `face` | 人脸 | `face_image`, `swap_image` |
| `source_video` | 待处理视频 | `video`, `input_video` |
| `audio` | 音轨/语音 | `audio`, `voice`, `reference_audios` |
| `model3d` | 3D 模型入参 | `mesh`, `model_file` |

有了 role，前端就不必再看字段名：「这个模式要一张主体图 + 若干参考图」
是稳定的产品语义，与上游叫什么无关。

### 3.3 输出声明

```jsonc
{ "kind": "video", "min": 1, "max": 1, "formats": ["mp4", "mov"] }
{ "kind": "image", "min": 1, "max": 4 }        // 多图模式
{ "kind": "model3d", "min": 1, "max": 1, "formats": ["glb"] }
```

一旦声明，`detectMediaKindFromUrl` 的扩展名嗅探就退化成**兜底**而不是主路径，
CDN 无扩展名直链也不必再赌。

### 3.4 派生管线

```
原始 apiSchema
   │
   ├─ 派生器（复用现有启发式，但只在同步时跑一次并落库）
   │     · 字段名 → kind/role
   │     · required[] → min（不再看 minItems）
   │     · maxItems → max
   │     · 输出：暂时按 mode 推，逐步补充上游 output schema
   │
   ├─ schemaHash 变了 → 重新派生；source=manual 的不覆盖，只标「待复核」
   │
   └─ 运行期：只读 ModelCapability，读不到才回落到现有启发式
```

关键点：**派生器不再在每个请求里跑**。现在 `resolveMediaInputs` 是每次
组 catalog 响应时现算的，同一份 schema 一天要解析几千遍。

---

## 四、管理端

1. **模型库列表**：provider / modelId / 能力摘要（`2图+1视频 → 1视频`）/ 状态
   （`已派生` `待复核` `已覆盖`）/ 是否被产品绑定
2. **详情页**：左栏原始 schema（只读），右栏归一化能力（可改）。
   逐字段可调 kind / role / min / max / label，改完 `source` 自动置 `manual`
3. **待复核队列**：新同步进来的、以及 schema 变过的 manual 记录
4. **重新派生**按钮：丢弃人工覆盖，回到派生结果

---

## 五、迁移路径（每一阶段都可独立上线）

| 阶段 | 内容 | 风险 |
|---|---|---|
| 1 | 建表 + 派生器 + 同步时落库。**运行期完全不读它** | 无。纯新增 |
| 2 | 加一个 diff 报告页：派生结果 vs 现有 `resolveMediaInputs`，列出不一致的模型 | 无。只读 |
| 3 | 人工复核 68 个在用模型（重点看 diff 报告标出的） | 无 |
| 4 | 运行期改读 ModelCapability，读不到回落现有启发式 | 中。回落保证不会更差 |
| 5 | 观察一段时间后删掉启发式主路径 | 低 |

阶段 1~3 不影响线上任何行为，可以先做。

---

## 六、这套体系顺带解决的几件事

- **计价口径**：能力表上可以挂 `provider` 维度的实测单价，
  候选表选型时不再只凭注释里的一句话
- **模板兼容性**：`template-compat` 现在靠 `MediaInputSpec` 判断，
  改读 role 之后「参考图换成主体图」这类不兼容能说得更准
- **@ 引用语法**：`ModelRefSyntax` 可以并进来，一个模型一条记录
- **玩物专区**：`plaything-param-policy` 里那套 minItems 也能统一到同一处

---

## 附录：配置在用的 68 个模型

按 vendor 分布：bytedance 24 · wavespeed-ai 19 · tencent 5 · google 4 ·
alibaba 3 · atlascloud 3 · pixverse 2 · tripo 2 · 其余各 1。

完整清单由 `scripts/dump-model-inventory.mjs` 从 `generation-catalog.ts`
与库里的 `ProviderCatalogModel` 交叉生成，包含：
provider / modelId / 是否已同步 schema / 是否被产品绑定 / 派生出的能力摘要。

**不需要人工填任何 URL** —— schema 已在库中，脚本直接读。
