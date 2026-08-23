/**
 * 提示词的文档模型：doc 与 canonical 之间的两个纯函数。
 *
 * 三层文本模型里这里只管前两层（第三层 target 由 model-ref-syntax.ts 在
 * 提交前那一刻生成，本文件不碰）：
 *
 *   doc        编辑态权威，只活在内存里
 *   canonical  持久化与对外的唯一权威，@Image1 这套规范引用
 *
 * 铁律：**凡是离开编辑器的文本一律是 canonical**。存库、草稿、模板、分享、
 * AI 请求，无例外。所以 serializePrompt 必须是纯函数——同一个 doc 永远
 * 得到同一个字符串，不依赖时间、随机数、当前模型、当前语言。
 *
 * 为什么可以放心让编辑器显示的和提交的不一样：renderPromptRefs 早就在
 * 提交前改写 @Image1 了，「所见即所提交」这条约束在这个代码库里从来没成立过，
 * 而且当初是刻意这么设计的。本文件是在同一个模式上再加一层，不是开新口子。
 *
 * 本文件**不引入任何 React / Lexical 依赖**，纯 TS。这样它能被单测直接跑，
 * 也能被服务端复用（提交前体检、分享剔除注释都在服务端做）。
 */

import { canonicalRefRegex } from "./model-ref-syntax";

/* ------------------------------------------------------------------ *
 * schema（封闭）
 *
 * 真 WYSIWYG 的全部风险来自「doc 能表达 canonical 装不下的东西」。
 * 所以这张表是封闭的，加节点类型必须同时想清楚它序列化成什么。
 * 没有加粗 / 斜体：上游没有一个认识 **，加粗只有三种结局——
 * 污染提示词、静默失效、欺骗用户。
 * ------------------------------------------------------------------ */

export type InlineNode =
  /** 普通文字 */
  | { type: "text"; text: string }
  /** 软换行（Shift+Enter）。段内保留单个换行，不升格成新段落 */
  | { type: "br" }
  /** 素材引用胶囊。存 token 字符串不存索引，见下面 parseRefToken 的说明 */
  | { type: "ref"; token: string }
  /** 模板槽位。序列化输出当前填充值；未填则输出空并触发提交前拦截 */
  | { type: "slot"; name: string; value: string }
  /** 行内注释：**整段剔除**，一个字符都不上行 */
  | { type: "note"; text: string }
  /** 字面量：原样输出。存在的意义是保护 a*b 这类写法不被当成标记 */
  | { type: "literal"; text: string };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  /** 分节标题：序列化成**纯文本行**，# 符号丢弃 */
  | { type: "heading"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  /** 注释块：整段剔除 */
  | { type: "note"; children: InlineNode[] }
  /** 分隔线：纯视觉，不产出任何字符 */
  | { type: "divider" };

export type PromptDoc = { blocks: BlockNode[] };

export const EMPTY_DOC: PromptDoc = { blocks: [] };

/* ------------------------------------------------------------------ *
 * 素材引用 token
 * ------------------------------------------------------------------ */

export type RefKind = "image" | "video" | "audio";

/** 与 PromptMentionBox 的 KIND_WORD 一致；改这里必须同时改那边 */
const KIND_WORD: Record<RefKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

/**
 * Image1 解析成 { kind:"image", index:1 }。认不出返回 null。
 *
 * chip 里存的是 token 字符串而**不是**素材 URL 或数组下标，这是刻意的：
 * @Image1 的含义永远是「我发给上游的第 1 张图」，拖动缩略图换顺序就等于
 * 在不动提示词的前提下换掉引用。PromptMentionBox 顶上那段注释解释了
 * 为什么这条延迟绑定不能改成插入时绑死，这里沿用同一套语义。
 */
export function parseRefToken(token: string): { kind: RefKind; index: number } | null {
  const hit = /^(image|video|audio)(\d+)$/i.exec(token);
  if (!hit) return null;
  const kind = hit[1].toLowerCase() as RefKind;
  const index = Number(hit[2]);
  return Number.isSafeInteger(index) && index > 0 ? { kind, index } : null;
}

/** 规范写法：Image1 / Video2。大小写在这里定死，parse 出来的一律走这条 */
export function formatRefToken(kind: RefKind, index: number): string {
  return `${KIND_WORD[kind]}${index}`;
}

/**
 * 紧接在 before 后面写一个 @引用，还认不认得出来？认不出就得先垫个分隔符。
 *
 * 识别式要求引用前面是行首或分隔符，于是 `@Image3@Image1` 这种连着写的
 * **只有第一个算引用**，第二个会原样上行，变成模型读不懂的字面文字。
 * 用户在编辑器里看到的是两颗好端端的胶囊，出片却不对——正是这套改造要
 * 消灭的那类静默错误。PromptMentionBox 的 insertToken 早就在垫空格了，
 * 这里是同一条规矩的复用。
 *
 * 判定直接拿真正的识别式去试，不另写一份「什么算分隔符」的清单：
 * 那种清单必然和识别式慢慢长歪。
 */
export function refNeedsSeparator(before: string): boolean {
  if (!before) return false; // 行首/文首本来就认
  const probe = before.slice(-1) + "@Image1";
  const hit = canonicalRefRegex().exec(probe);
  return !(hit && hit.index === 0 && hit[0] === probe);
}

/* ------------------------------------------------------------------ *
 * 序列化 doc -> canonical
 * ------------------------------------------------------------------ */

function serializeInline(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
      case "literal":
        out += n.text;
        break;
      case "br":
        out += "\n";
        break;
      case "ref":
        /* 兜底：不管 doc 是怎么变成这样的（粘贴、撤销、拖动），
         * 两颗胶囊贴在一起时必须垫一个空格，否则序列化出来的文本
         * 再 parse 回来会少一个引用——存进草稿再打开就凭空少一颗。
         * 插入时的 refNeedsSeparator 是体验，这里这条是**不变式**。 */
        if (refNeedsSeparator(out)) out += " ";
        out += `@${n.token}`;
        break;
      case "slot":
        // 未填的槽位输出空串；拦不拦交给 unfilledSlots()，序列化本身不抛错
        out += n.value;
        break;
      case "note":
        break; // 剔除
    }
  }
  return out;
}

/**
 * 一个块产出的文本，以及它和下一个块之间隔几个换行。
 *
 * 标题只隔一个换行（hug 住下一块）：视频模式下「开场镜头」加上紧随其后的
 * 「人物从左侧走入」本身就是镜头脚本，中间空一行反而读着散。
 * 顺带这条让 round-trip 稳了——标题序列化后没有任何标记，parse 回来会变成
 * 「带软换行的段落」，而那个段落序列化出来与原文逐字节相同。
 */
function serializeBlock(block: BlockNode): { text: string; hugNext: boolean } | null {
  switch (block.type) {
    case "paragraph": {
      const text = serializeInline(block.children);
      return text.trim() ? { text, hugNext: false } : null; // 空段落不产出任何字符
    }
    case "heading": {
      const text = serializeInline(block.children);
      return text.trim() ? { text, hugNext: true } : null;
    }
    case "list": {
      const items = block.items.map((item) => serializeInline(item)).filter((t) => t.trim());
      if (!items.length) return null;
      // 列表项之间恒为单个换行
      const text = items
        .map((t, i) => (block.ordered ? `${i + 1}. ${t}` : `- ${t}`))
        .join("\n");
      return { text, hugNext: false };
    }
    case "note":
      return null; // 整段剔除
    case "divider":
      return null; // 纯视觉：不产字符，相邻两块照常隔一个空行
  }
}

/**
 * doc -> canonical。纯函数。
 *
 * 空白规则在这里定死，因为它是 round-trip 不稳定的头号来源：
 * 段落之间恒为两个换行，列表项之间恒为一个换行，空段落不产出任何字符，
 * 每行 trimEnd，全文首尾 trim。
 */
export function serializePrompt(doc: PromptDoc): string {
  const parts: { text: string; hugNext: boolean }[] = [];
  for (const block of doc.blocks) {
    const piece = serializeBlock(block);
    if (piece) parts.push(piece);
  }

  let out = "";
  parts.forEach((p, i) => {
    out += p.text;
    if (i < parts.length - 1) out += p.hugNext ? "\n" : "\n\n";
  });

  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/* ------------------------------------------------------------------ *
 * 反向解析 canonical -> doc
 * ------------------------------------------------------------------ */

/*
 * 列表项识别。
 *
 * `^\s*` 那段不是随手加的宽容：serializePrompt 的最后一步会 trim 全文，
 * 于是首行的缩进在第一次 normalize 之后就没了。若识别式要求顶格，
 * `\t* 猫` 第一次归一成 `* 猫`（仍是段落，缩进被 trim 掉），
 * 第二次才被认成列表项、变成 `- 猫`——normalize 不幂等，
 * 原文视图进出两趟文本自己会变。随机输入测试就是这么逮到的。
 *
 * 缩进本身照旧保留（每行只 trimEnd），这里放宽的只是「算不算列表项」。
 */
/** 无序列表项 */
const UL_RE = /^\s*[-*]\s+(.*)$/;
/** 有序列表项 */
const OL_RE = /^\s*\d+\.\s+(.*)$/;

/**
 * 一行纯文本 -> 行内节点。只认素材引用，其余全是 text。
 *
 * 引用的识别式**直接来自 model-ref-syntax.ts**，不在这里另写一份。
 * 两边但凡差一个字符，就会出现「胶囊序列化成 @Image1、提交时却没被改写」
 * 这种查不出来的 bug——编辑器里看着好好的，出片不对。
 */
function parseInlineText(line: string): InlineNode[] {
  const re = canonicalRefRegex();
  const out: InlineNode[] = [];
  let last = 0;
  let hit: RegExpExecArray | null;

  const pushText = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.type === "text") prev.text += text;
    else out.push({ type: "text", text });
  };

  while ((hit = re.exec(line))) {
    const [whole, lead, kind, num] = hit;
    pushText(line.slice(last, hit.index));
    // 前导分隔符是识别式的一部分，不属于引用，原样留在文本里
    pushText(lead);
    out.push({
      type: "ref",
      token: formatRefToken(kind.toLowerCase() as RefKind, Number(num)),
    });
    last = hit.index + whole.length;
  }
  pushText(line.slice(last));
  return out;
}

/** 若干行拼成一个段落，行之间用软换行连接 */
function paragraphFrom(lines: string[]): BlockNode {
  const children: InlineNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) children.push({ type: "br" });
    children.push(...parseInlineText(line));
  });
  return { type: "paragraph", children };
}

/**
 * canonical -> doc。
 *
 * 注意这个方向**必然丢信息**：标题的符号已经丢了、注释已经剔了、槽位已经
 * 填成死文本了，canonical 里没有任何痕迹能把它们认回来。所以
 * parse(serialize(doc)) === doc 这条**对含标题/注释/槽位的 doc 不成立**，
 * 也不可能成立——那是 schema 设计的直接后果，不是实现偷懒。
 *
 * 真正成立并且被单测钉死的是这两条：
 *   1. serialize(parse(t)) 幂等                          原文视图反复进出不会越改越乱
 *   2. serialize(parse(serialize(d))) === serialize(d)   提交内容是不动点
 *
 * 原文视图改完以**原文为准**、doc 重建，就是按这条来的。代价是注释会没，
 * 所以那个入口必须先提示用户。
 */
export function parsePrompt(text: string): PromptDoc {
  const blocks: BlockNode[] = [];
  const lines = sanitizePromptText(text).split("\n");

  /* 先按空行切块。连续多个空行折叠成一个边界 */
  let group: string[] = [];
  const flushGroup = () => {
    if (!group.length) return;
    const chunk = group;
    group = [];

    /* 块内再按「是不是列表项」切段：一行说明后面跟着几个横杠项，
     * 要切成一个段落 + 一个列表，而不是一个含横杠的怪段落 */
    let buf: string[] = [];
    let list: { ordered: boolean; items: InlineNode[][] } | null = null;

    const flushBuf = () => {
      if (buf.length) blocks.push(paragraphFrom(buf));
      buf = [];
    };
    const flushList = () => {
      if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    };

    for (const line of chunk) {
      const ul = UL_RE.exec(line);
      const ol = ul ? null : OL_RE.exec(line);
      if (ul || ol) {
        flushBuf();
        const ordered = Boolean(ol);
        if (!list || list.ordered !== ordered) {
          flushList();
          list = { ordered, items: [] };
        }
        list.items.push(parseInlineText((ul ?? ol)![1]));
      } else {
        flushList();
        buf.push(line);
      }
    }
    flushBuf();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) flushGroup();
    else group.push(line);
  }
  flushGroup();

  return { blocks };
}

/**
 * 规范化：过一遍 doc 再出来。原文视图落地、入库前都走它。
 *
 * 幂等——normalizePrompt(normalizePrompt(x)) === normalizePrompt(x)
 * 对任意输入成立，单测钉死。
 */
export function normalizePrompt(text: string): string {
  return serializePrompt(parsePrompt(text));
}

/* ------------------------------------------------------------------ *
 * 清洗
 * ------------------------------------------------------------------ */

/**
 * 要清除的不可见字符，**按码点列出**。
 *
 * 故意不写成正则字面量：这些字符的字面量在编辑器里根本看不见，
 * 源码本身会变成一串「[-]」，改的人无从判断里面到底装了什么。
 * 一个专门清理不可见字符的函数，自己的源码不该也是不可见的。
 */
const STRIP_RANGES: [number, number][] = [
  [0x0000, 0x0008], // C0 控制符，保留 \t(09) 和 \n(0a)
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x007f, 0x007f], // DEL
  [0x180e, 0x180e], // 蒙文元音分隔符
  [0x200b, 0x200d], // 零宽空格 / 非连接符 / 连接符
  [0x2060, 0x2060], // word joiner
  [0x202a, 0x202e], // 双向控制符：显示顺序能和字节顺序相反，绝不能留
  [0x2066, 0x2069],
  [0xfeff, 0xfeff], // BOM
];

/** 统一成普通空格的各种「也是空格」：NBSP、窄空格、全角空格…… */
const SPACE_RANGES: [number, number][] = [
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

function charClass(ranges: [number, number][]): RegExp {
  const esc = (cp: number) => "\\u" + cp.toString(16).padStart(4, "0");
  const body = ranges.map(([a, b]) => (a === b ? esc(a) : `${esc(a)}-${esc(b)}`)).join("");
  return new RegExp(`[${body}]`, "g");
}

const STRIP_RE = charClass(STRIP_RANGES);
const SPACE_RE = charClass(SPACE_RANGES);

/**
 * 不可见字符必须清除。
 *
 * 这些东西进了提示词肉眼一点都查不出来，而模型看到的和用户以为的不是
 * 一回事：零宽字符会把一个词切成两半，NBSP 不是空格所以分词器另做处理，
 * 双向控制符更是能让整行显示顺序和实际字节顺序相反。
 * 全都是从别处复制粘贴带进来的。
 */
export function sanitizePromptText(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(STRIP_RE, "").replace(SPACE_RE, " ");
}

/**
 * 富文本粘贴的白名单降级：schema 外的一切丢弃。
 *
 * 走白名单不走黑名单——黑名单永远漏，而这里漏一个就是把用户不知道存在的
 * 字符送进了模型。
 */
export function parsePastedText(raw: string): PromptDoc {
  return parsePrompt(sanitizePromptText(raw));
}

/* ------------------------------------------------------------------ *
 * 查询：给孤儿引用告警和提交前拦截用
 * ------------------------------------------------------------------ */

function walkInline(doc: PromptDoc, visit: (n: InlineNode) => void) {
  for (const block of doc.blocks) {
    if (block.type === "divider") continue;
    if (block.type === "list") {
      for (const item of block.items) item.forEach(visit);
    } else {
      block.children.forEach(visit);
    }
  }
}

/** doc 里出现的所有素材引用，按出现顺序，含重复 */
export function refTokensIn(doc: PromptDoc): string[] {
  const out: string[] = [];
  walkInline(doc, (n) => {
    if (n.type === "ref") out.push(n.token);
  });
  return out;
}

/** 纯文本里出现的所有素材引用。没有 doc 的老路径（草稿、模板）用它 */
export function refTokensInText(text: string): string[] {
  return refTokensIn(parsePrompt(text));
}

/** 未填的槽位名，提交前拦一次 */
export function unfilledSlots(doc: PromptDoc): string[] {
  const out: string[] = [];
  walkInline(doc, (n) => {
    if (n.type === "slot" && !n.value.trim()) out.push(n.name);
  });
  return out;
}

/**
 * 引用的三态判定。
 *
 * available 是「当前一共传了几份该类型素材」，也就是 buildMentionTargets
 * 数出来的数量。超出范围就是孤儿——换模式/换档位时 pruneMediaToSpecs
 * 把媒体丢掉了，而提示词里的 @Image3 至今无人处理，这正是它要治的病。
 */
export type RefState = "ok" | "orphan" | "malformed";

export function refState(token: string, available: Record<RefKind, number>): RefState {
  const parsed = parseRefToken(token);
  if (!parsed) return "malformed";
  return parsed.index <= (available[parsed.kind] ?? 0) ? "ok" : "orphan";
}
