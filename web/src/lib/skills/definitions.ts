/**
 * 官方技能的**出厂定义**。
 *
 * 库里的 `Skill` 行是「实例」，这里是「出厂值」。为什么不像
 * `pricing-seed.ts` 那样只补不改：价格是运营数据，提示词是**产品数据**。
 * 提示词随版本升级——我们改好了一版润色提示词，没被管理端改过的技能
 * 应该自动跟上，否则老站点永远停在第一版。改过的（`isOverridden`）
 * 一个字都不动。规则见 store.ts。
 *
 * 纯数据，不带 server-only：管理端要显示「与出厂值的差异」。
 */

/** 触发时机是**封闭枚举**——它必须由前端实现，用户只能勾选，不能造新的 */
export const SKILL_TRIGGERS = [
  /** 选中文字 → 浮条 / 底栏 */
  "selection",
  /** 工具栏按钮，整段 */
  "manual",
  /** 点章节标题 → 以整章为范围 */
  "section",
  /** 点块把手 → 菜单（S4） */
  "block",
  /** 空处打 `/`（S4） */
  "slash",
  /** 编辑器为空（S4） */
  "empty",
  /** 点生成前（S4） */
  "submit",
] as const;
export type SkillTrigger = (typeof SKILL_TRIGGERS)[number];

/**
 * 结果怎么落地。
 *
 * 原来还有 `insert` / `append` 两个值，删掉了：**「插入下方」本来就是预览卡上
 * 一颗按钮**，再用技能配置表达一遍是多此一举，而且会出现「技能说 append、
 * 按钮说替换」这种自相矛盾的状态。
 *
 * 真正需要区分的只有一件事：**这次的输出是不是用来顶替原文的**。
 * 「检查这段有什么问题」回的是一段评语，用户顺手点「替换」就会把评语写进
 * 提示词里——看起来还挺像回事，可能到出片不对才发现。`card` 就是为它存在的：
 * 只读，不给任何落地按钮。
 *
 * 字段仍是 String，以后真要加值不用迁移。
 */
export const SKILL_OUTPUT_MODES = ["replace", "card"] as const;
export type SkillOutputMode = (typeof SKILL_OUTPUT_MODES)[number];

/** 与 `prompt-targets.ts` 的 PromptFormatId 一致。空数组 = 全模式 */
export const SKILL_MODE_IDS = [
  "image_t2i",
  "image_i2i",
  "image_edit",
  "video_t2v",
  "video_i2v",
] as const;

const IMAGE_MODES = ["image_t2i", "image_i2i", "image_edit"];
const VIDEO_MODES = ["video_t2v", "video_i2v"];

/** 标题层级，与 prompt-doc 的 HeadingLevel 一致 */
export const SKILL_SECTION_LEVELS = [1, 2, 3] as const;

export type SkillDefinition = {
  key: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  triggers: SkillTrigger[];
  modes: string[];
  /** 空 = 所有层级。只对 section 时机有意义 */
  sectionLevels?: number[];
  systemPrompt: string;
  userTemplate: string;
  modelKey: string;
  outputMode: SkillOutputMode;
  maxOutputTokens: number;
  temperature: number;
  requiresVipRank: number;
  sortOrder: number;
};

/**
 * 选区类技能共用的用户消息模板。
 *
 * 前后文用条件段包着，因为选区经常就在开头或结尾——那时留一个
 * 「【前文，仅供理解】」加一片空白，模型会以为前文真的是空白。
 */
const SELECTION_TEMPLATE = `{{#context_before}}【前文，仅供理解，不要改写也不要复述】
{{context_before}}

{{/context_before}}【需要改写的片段】
{{selection}}
{{#context_after}}
【后文，仅供理解，不要改写也不要复述】
{{context_after}}{{/context_after}}`;

const SELECTION_BASE = {
  triggers: ["selection"] as SkillTrigger[],
  userTemplate: SELECTION_TEMPLATE,
  /** "auto" = 按成人模式自动选档。写死某个模型会让成人模式撞上会拒答的那一个 */
  modelKey: "auto",
  outputMode: "replace" as SkillOutputMode,
  maxOutputTokens: 600,
  requiresVipRank: 0,
};

/**
 * 魔法指令，归位成一个 `manual` 技能。
 *
 * 它在这套系统里之所以特殊，只有一件事：**支持反向提示词的档位要回 JSON**。
 * 那条输出格式由平台包在外面（见 envelope.ts），技能本身照样只写任务。
 *
 * 本地规则兜底（`enhancePromptLocal`）没有搬进来，也不该搬：那不是提示词，
 * 是一段写死的拼接逻辑，用来在上游挂掉时保证按钮还有反应。
 */
const MAGIC_PROMPT: SkillDefinition = {
  key: "magic-prompt",
  name: "魔法指令",
  nameEn: "Magic prompt",
  icon: "fa-hat-wizard",
  description: "把整段草稿优化成当前模式可直接用的提示词",
  triggers: ["manual"],
  modes: [],
  systemPrompt: `任务：把用户的草稿优化成「下游生成模型」可直接使用的 prompt，而不是普通聊天回复。

该模式的格式规则：
{{mode_rules}}

通用要求：
1. 保留用户的原始创作意图，不主动增删设定
2. 严格按上述格式规则写，不要混用其它模式的写法
3. 控制在约 60-220 字（视频可略短、偏动作）`,
  userTemplate: `## Task Metadata (do not ignore)
\`\`\`json
{{task_metadata}}
\`\`\`

## Format Rules
{{mode_rules}}

## Current User Selections
- style: {{style}}
- ratio: {{ratio}}
{{#existing_negative}}- existing_negative_prompt: {{existing_negative}}
{{/existing_negative}}
## User Draft Prompt
{{full_text}}`,
  modelKey: "auto",
  outputMode: "replace",
  maxOutputTokens: 500,
  temperature: 0.15,
  requiresVipRank: 0,
  sortOrder: 5,
};

/**
 * 章节级技能的用户消息模板。
 *
 * `{{selection}}` 在这个时机下装的是**整节的 canonical 文本，带着井号**，
 * 所以模型看得到层级，回来的东西也应该带着标题——否则一次「整节润色」
 * 会把标题吃掉。
 */
const SECTION_TEMPLATE = `{{#context_before}}【前文，仅供理解，不要改写也不要复述】
{{context_before}}

{{/context_before}}【需要改写的整节】
{{selection}}
{{#context_after}}
【后文，仅供理解，不要改写也不要复述】
{{context_after}}{{/context_after}}`;

const SECTION_BASE = {
  triggers: ["section"] as SkillTrigger[],
  userTemplate: SECTION_TEMPLATE,
  modelKey: "auto",
  modes: [] as string[],
  /** 空 = 所有层级。运营可以按需改成只在 # 或只在 ## 上出现 */
  sectionLevels: [] as number[],
  maxOutputTokens: 1200,
  requiresVipRank: 0,
};

export const OFFICIAL_SKILLS: SkillDefinition[] = [
  MAGIC_PROMPT,
  {
    ...SECTION_BASE,
    key: "section-polish",
    name: "整节润色",
    nameEn: "Polish section",
    icon: "fa-feather",
    description: "按当前模式的写作规则润色整节，保留标题与结构",
    systemPrompt: `任务：按下列写作规则润色这一整节，保持原意与信息量，不新增设定。
**保留原有的标题行与它的井号层级**，不要把标题删掉或改级。
{{mode_rules}}`,
    outputMode: "replace" as SkillOutputMode,
    temperature: 0.3,
    sortOrder: 60,
  },
  {
    ...SECTION_BASE,
    key: "section-check",
    name: "检查本节",
    nameEn: "Check section",
    icon: "fa-circle-question",
    description: "逐条指出这一节的问题，不改动正文",
    systemPrompt: `任务：检查这一节有什么问题，逐条列出。只诊断，**不要输出改写后的正文**。
看这几件事：有没有缺主体；前后有没有自相矛盾；引用的素材占位符在这一节里说不说得通；
有没有违反下列写作规则。
{{mode_rules}}`,
    /* 回的是评语不是正文——给「替换」按钮的话，用户顺手一点评语就进提示词了 */
    outputMode: "card" as SkillOutputMode,
    temperature: 0.2,
    sortOrder: 61,
  },
  {
    ...SELECTION_BASE,
    key: "polish",
    name: "润色",
    nameEn: "Polish",
    icon: "fa-wand-magic-sparkles",
    description: "按当前模式的写作规则润色，不新增设定",
    modes: [],
    systemPrompt: `任务：按下列写作规则润色这个片段，保持原意与信息量，不新增设定。
{{mode_rules}}`,
    temperature: 0.3,
    sortOrder: 10,
  },
  {
    ...SELECTION_BASE,
    key: "localize",
    name: "中英互转",
    nameEn: "EN / 中文",
    icon: "fa-language",
    description: "按选区内容判断方向，本地化而不是直译",
    modes: [],
    /*
     * 方向由 {{target_language}} 在运行时按**选区内容**决定，不按界面语言：
     * 中文界面的用户完全可能在写英文提示词（上游对英文理解更好，是常见做法），
     * 按界面语言判会把他刚写好的英文又译回中文。
     */
    systemPrompt: `任务：把片段改写成{{target_language}}。
这是本地化不是直译——要用生成模型认得的说法（例如「电影感光影」写成 cinematic lighting），
不要逐字硬译，保持它作为生成提示词的准确含义。`,
    temperature: 0.1,
    sortOrder: 20,
  },
  /*
   * 「补充细节」拆成两条按 modes 过滤，而不是在一条里写「如果是视频就……」。
   * 图像要的是把已有的东西描述得更具体，视频要的是接下一个动作——
   * 这是两个不同的任务，塞进一条提示词只会让模型在两者之间摇摆。
   */
  {
    ...SELECTION_BASE,
    key: "expand",
    name: "补充细节",
    nameEn: "Add detail",
    icon: "fa-arrows-left-right-to-line",
    description: "补材质、光影、质感、镜头语言（图像模式）",
    modes: IMAGE_MODES,
    systemPrompt: `任务：为这个片段补充细节——材质、光影、质感、镜头语言。
**不要新增主体**，只把已有的东西描述得更具体。`,
    temperature: 0.3,
    sortOrder: 30,
  },
  {
    ...SELECTION_BASE,
    key: "expand-video",
    name: "延展镜头",
    nameEn: "Extend shot",
    icon: "fa-arrows-left-right-to-line",
    description: "接上下一个动作并补运镜（视频模式）",
    modes: VIDEO_MODES,
    systemPrompt: `任务：延展这个片段——接上它之后自然发生的下一个动作，并补上运镜描述。
不要新增与上下文冲突的人物或场景。`,
    temperature: 0.3,
    sortOrder: 30,
  },
  {
    ...SELECTION_BASE,
    key: "shorten",
    name: "精简",
    nameEn: "Shorten",
    icon: "fa-compress",
    description: "压到指定字数以内，先删形容词堆砌",
    modes: [],
    systemPrompt: `任务：把片段精简到 {{shorten_limit}} 字以内，保留最关键的视觉信息，
优先删掉形容词堆砌与重复表达。`,
    temperature: 0.3,
    sortOrder: 40,
  },
  {
    ...SELECTION_BASE,
    key: "emphasize",
    name: "加重语气",
    nameEn: "Emphasize",
    icon: "fa-bolt",
    description: "换更强的措辞、关键信息提前",
    modes: [],
    systemPrompt: `任务：加重这个片段的语气——换用更强的措辞、把最关键的信息提到句首、
必要时适度重复关键词。这是给生成模型看的强调，不要使用任何标记符号。`,
    temperature: 0.3,
    sortOrder: 50,
  },
];

export const OFFICIAL_SKILL_BY_KEY = new Map(OFFICIAL_SKILLS.map((s) => [s.key, s]));
