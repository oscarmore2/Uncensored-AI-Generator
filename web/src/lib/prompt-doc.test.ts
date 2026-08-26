import { describe, it, expect } from "vitest";
import {
  type PromptDoc,
  normalizePrompt,
  parsePastedText,
  parsePrompt,
  parseRefToken,
  refNeedsSeparator,
  refState,
  refTokensIn,
  refTokensInText,
  sanitizePromptText,
  serializePrompt,
} from "./prompt-doc";
import { renderPromptRefs, type RefSyntaxRule } from "./model-ref-syntax";

/**
 * 黄金样本：真实形状的提示词，不是造出来的边界。
 * 每次改序列化规则都要拿它们过一遍。
 */
const GOLDEN = [
  "一只橘猫坐在窗台上，午后阳光，浅景深",
  "第一段描述主体。\n\n第二段描述环境。",
  "@Image1 里的人物，穿着 @Image2 的那件外套，走进 @Video1 的场景",
  "开场镜头\n人物从左侧走入，镜头缓慢右摇\n\n第二镜\n特写手部动作",
  "分镜如下\n- 甲：推镜\n- 乙：摇镜\n- 丙：升格",
  "步骤\n1. 建立镜头\n2. 中景\n3. 特写",
  "公式写作 a*b 的场合不该被当成斜体标记",
  "联系方式 name@image1.com 不是引用",  // 邮箱：@ 前面是字母，不该识别
  "多位数 @Image10 和 @Image2 要各自认对",
  "行尾有空格   \n下一行",
];

describe("空白规则", () => {
  it("行尾空格一律抹掉", () => {
    expect(normalizePrompt("甲   \n乙  ")).toBe("甲\n乙");
  });

  it("连续空行折叠成一个段落边界", () => {
    expect(normalizePrompt("甲\n\n\n\n\n乙")).toBe("甲\n\n乙");
  });

  it("全文首尾 trim", () => {
    expect(normalizePrompt("\n\n  甲  \n\n")).toBe("甲");
  });

  it("空段落不产出任何字符", () => {
    const doc: PromptDoc = {
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: "甲" }] },
        { type: "paragraph", children: [] },
        { type: "paragraph", children: [{ type: "text", text: "   " }] },
        { type: "paragraph", children: [{ type: "text", text: "乙" }] },
      ],
    };
    expect(serializePrompt(doc)).toBe("甲\n\n乙");
  });

  it("段内软换行保留成单个换行，不升格成段落", () => {
    expect(normalizePrompt("上句\n下句")).toBe("上句\n下句");
  });
});

describe("schema 的序列化约定", () => {
  it("标题带着井号出去，且只跟下一块隔一个换行", () => {
    const doc: PromptDoc = {
      blocks: [
        { type: "heading", level: 1, children: [{ type: "text", text: "开场镜头" }] },
        { type: "paragraph", children: [{ type: "text", text: "人物从左侧走入" }] },
      ],
    };
    expect(serializePrompt(doc)).toBe("# 开场镜头\n人物从左侧走入");
  });

  it("层级用井号个数表示，且能原样认回来", () => {
    const doc: PromptDoc = {
      blocks: [
        { type: "heading", level: 1, children: [{ type: "text", text: "第一幕" }] },
        { type: "heading", level: 2, children: [{ type: "text", text: "镜头一" }] },
        { type: "heading", level: 3, children: [{ type: "text", text: "细节" }] },
      ],
    };
    const text = serializePrompt(doc);
    expect(text).toBe("# 第一幕\n## 镜头一\n### 细节");
    /* 标题活不过一次保存的话，用户敲的分镜下次打开就分不出章节了 */
    expect(parsePrompt(text).blocks).toEqual(doc.blocks);
  });

  it("四个以上井号不当标题，原样留成正文", () => {
    const blocks = parsePrompt("#### 不是标题").blocks;
    expect(blocks[0].type).toBe("paragraph");
    expect(normalizePrompt("#### 不是标题")).toBe("#### 不是标题");
  });

  it("井号后面没空格不算标题", () => {
    expect(parsePrompt("#标签").blocks[0].type).toBe("paragraph");
    expect(normalizePrompt("#标签")).toBe("#标签");
  });

  it("标题把前后切开，不会被并进相邻段落", () => {
    const blocks = parsePrompt("上一句\n# 标题\n下一句").blocks;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph"]);
  });

  it("**粘贴进来的 markdown 标题也认**——用户报的就是这个", () => {
    /*
     * 以前 markdown 快捷输入只在「敲」的时候生效，粘贴走的是 parsePastedText，
     * 而它认不出井号。于是从别处贴一份分镜稿进来，# 全部原样留在正文里，
     * 而自己敲的那几行却变成了标题——同一份文档里两种样子。
     */
    const doc = parsePastedText("# SHOT 01\n## 00:00—00:14\n\n【画面】\nB城，血红色太阳。");
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "heading", "paragraph"]);
    expect(doc.blocks[0]).toMatchObject({ level: 1 });
    expect(doc.blocks[1]).toMatchObject({ level: 2 });
  });

  it("标题里的素材引用照常识别", () => {
    const blocks = parsePrompt("# 参考 @Image1 的镜头").blocks;
    expect(blocks[0]).toEqual({
      type: "heading",
      level: 1,
      children: [
        { type: "text", text: "参考 " },
        { type: "ref", token: "Image1" },
        { type: "text", text: " 的镜头" },
      ],
    });
  });

  it("注释块整段剔除，行内注释一个字符都不上行", () => {
    const doc: PromptDoc = {
      blocks: [
        { type: "note", children: [{ type: "text", text: "上次这版太暗了" }] },
        {
          type: "paragraph",
          children: [
            { type: "text", text: "暖色调" },
            { type: "note", text: "别忘了加颗粒" },
          ],
        },
      ],
    };
    expect(serializePrompt(doc)).toBe("暖色调");
  });

  it("分隔线是纯视觉，不产字符也不制造多余空行", () => {
    const doc: PromptDoc = {
      blocks: [
        { type: "paragraph", children: [{ type: "text", text: "甲" }] },
        { type: "divider" },
        { type: "paragraph", children: [{ type: "text", text: "乙" }] },
      ],
    };
    expect(serializePrompt(doc)).toBe("甲\n\n乙");
  });

  it("槽位输出当前填充值", () => {
    const doc: PromptDoc = {
      blocks: [
        {
          type: "paragraph",
          children: [
            { type: "text", text: "一位 " },
            { type: "slot", name: "主体", value: "宇航员" },
            { type: "text", text: " 站在 " },
            { type: "slot", name: "场景", value: "" },
            { type: "text", text: " 中" },
          ],
        },
      ],
    };
    // 未填的输出空串；拦截交给 unfilledSlots，序列化不抛错
    expect(serializePrompt(doc)).toBe("一位 宇航员 站在  中");
  });

  it("有序列表重新编号，不沿用用户写的数字", () => {
    expect(normalizePrompt("3. 甲\n7. 乙")).toBe("1. 甲\n2. 乙");
  });

  it("说明行后面跟列表，切成一个段落 + 一个列表", () => {
    const doc = parsePrompt("分镜如下\n- 甲\n- 乙");
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "list"]);
  });
});

describe("素材引用", () => {
  it("认出规范引用并归一大小写", () => {
    expect(refTokensInText("@image1 和 @VIDEO2")).toEqual(["Image1", "Video2"]);
    expect(normalizePrompt("@image1 好")).toBe("@Image1 好");
  });

  it("邮箱里的 @ 不是引用", () => {
    expect(refTokensInText("name@image1.com")).toEqual([]);
  });

  it("多位数序号完整认出", () => {
    expect(refTokensInText("@Image10")).toEqual(["Image10"]);
  });

  it("紧邻的两个引用只认出前一个（与提交期改写规则一致）", () => {
    // @Image1@Image2 中间没有分隔符，renderPromptRefs 也只会改写第一个。
    // 两边行为必须一致，否则编辑器显示两颗胶囊、提交却只改一个。
    expect(refTokensInText("@Image1@Image2")).toEqual(["Image1"]);
  });

  it("引用后面紧跟汉字仍然认得出（中文写作的常态）", () => {
    // @Image1弹窗… 中间没有空格。\b 在数字与汉字之间成立，所以引用照样成立。
    // 这条很容易在收紧识别式时被误伤，钉住。
    expect(refTokensInText("参考 @Image1弹窗里加的一句")).toEqual(["Image1"]);
    expect(refTokensInText("参考 @Image1的光线")).toEqual(["Image1"]);
    // 但后面紧跟字母数字就不是引用了，那是别的词
    expect(refTokensInText("参考 @Image1x")).toEqual([]);
  });

  it("token 解析", () => {
    expect(parseRefToken("Image1")).toEqual({ kind: "image", index: 1 });
    expect(parseRefToken("Image0")).toBeNull();
    expect(parseRefToken("Imagex")).toBeNull();
    expect(parseRefToken("Mesh1")).toBeNull();
  });

  it("三态判定：超出已传数量就是孤儿", () => {
    const have = { image: 2, video: 0, audio: 0 } as const;
    expect(refState("Image1", have)).toBe("ok");
    expect(refState("Image3", have)).toBe("orphan");
    expect(refState("Video1", have)).toBe("orphan");
    expect(refState("Mesh1", have)).toBe("malformed");
  });
});

/**
 * 这一组是整套设计的安全带。
 *
 * 胶囊序列化出来的 @Image1 必须**恰好**能被提交期的 renderPromptRefs 改写。
 * 少认一个，用户在编辑器里看到的胶囊会原样上行变成模型读不懂的记号；
 * 多认一个，用户写的正文会被改掉。两种都只表现为「出片不对」，没有报错。
 */
describe("与提交期改写的一致性", () => {
  const RULE: RefSyntaxRule = {
    matchModelId: "",
    provider: null,
    imageFormat: "<IMG{n}>",
    videoFormat: "<VID{n}>",
    audioFormat: "<AUD{n}>",
  };

  for (const sample of GOLDEN) {
    it(`认出的引用数 = 改写数：${JSON.stringify(sample.slice(0, 24))}`, () => {
      const canonical = normalizePrompt(sample);
      const found = refTokensInText(canonical).length;
      const rewritten = renderPromptRefs(canonical, RULE);
      const applied = (rewritten.match(/<(IMG|VID|AUD)\d+>/g) ?? []).length;
      expect(applied).toBe(found);
    });
  }
});

/**
 * 紧邻胶囊是这套东西最阴的一个坑：编辑器里两颗胶囊好端端并排，
 * 序列化出来是 @Image3@Image1，而识别式只认第一个——
 * 存进草稿再打开就凭空少一颗，用户只看得到出片不对。
 */
describe("紧邻的两颗胶囊", () => {
  const twoRefs: PromptDoc = {
    blocks: [
      {
        type: "paragraph",
        children: [
          { type: "ref", token: "Image3" },
          { type: "ref", token: "Image1" },
        ],
      },
    ],
  };

  it("序列化时自动垫空格", () => {
    expect(serializePrompt(twoRefs)).toBe("@Image3 @Image1");
  });

  it("垫完之后两个引用都还认得出来", () => {
    expect(refTokensInText(serializePrompt(twoRefs))).toEqual(["Image3", "Image1"]);
  });

  it("refNeedsSeparator：分隔符后面不垫，其余都垫", () => {
    expect(refNeedsSeparator("")).toBe(false); // 文首
    expect(refNeedsSeparator("走进 ")).toBe(false); // 空格
    expect(refNeedsSeparator("场景，")).toBe(false); // 中文逗号
    expect(refNeedsSeparator("参考")).toBe(true); // 汉字
    expect(refNeedsSeparator("@Image1")).toBe(true); // 上一颗胶囊的文本形式
    expect(refNeedsSeparator("abc")).toBe(true);
  });

  it("不变式：序列化再解析，一颗胶囊都不能少", () => {
    const docs: PromptDoc[] = [
      twoRefs,
      {
        blocks: [
          {
            type: "list",
            ordered: false,
            items: [[{ type: "ref", token: "Image1" }, { type: "ref", token: "Video1" }]],
          },
        ],
      },
      {
        blocks: [
          {
            type: "paragraph",
            children: [
              { type: "text", text: "参考" },
              { type: "ref", token: "Image1" }, // 紧贴汉字
            ],
          },
        ],
      },
    ];
    for (const doc of docs) {
      expect(refTokensIn(parsePrompt(serializePrompt(doc)))).toEqual(refTokensIn(doc));
    }
  });
});

describe("清洗", () => {
  it("零宽字符被清掉", () => {
    const zwsp = String.fromCharCode(0x200b);
    expect(sanitizePromptText(`橘${zwsp}猫`)).toBe("橘猫");
  });

  it("双向控制符被清掉", () => {
    const rlo = String.fromCharCode(0x202e);
    expect(sanitizePromptText(`甲${rlo}乙`)).toBe("甲乙");
  });

  it("各种空格归一成普通空格", () => {
    const nbsp = String.fromCharCode(0x00a0);
    const ideographic = String.fromCharCode(0x3000);
    expect(sanitizePromptText(`甲${nbsp}乙${ideographic}丙`)).toBe("甲 乙 丙");
  });

  it("CRLF 归一", () => {
    expect(sanitizePromptText("甲\r\n乙\r丙")).toBe("甲\n乙\n丙");
  });

  it("制表符和换行保住", () => {
    expect(sanitizePromptText("甲\t乙\n丙")).toBe("甲\t乙\n丙");
  });
});

/**
 * 不变式。
 *
 * 注意**不测** parse(serialize(doc)) === doc：标题的符号已经丢了、
 * 注释已经剔了、槽位已经填成死文本，canonical 里没有痕迹能认回来。
 * 那条对含这些节点的 doc 不可能成立，是 schema 设计的直接后果。
 * 下面两条才是真正保证「反复进出不会越改越乱」的东西。
 */
describe("不变式", () => {
  const CORPUS = [
    ...GOLDEN,
    "",
    "   ",
    "\n\n\n",
    "- 只有一个列表项",
    "1. 只有一个有序项",
    "-没有空格的横杠不算列表项",
    "@Image1",
    "@Image1 ",
    " @Image1",
    "*星号开头",
    "* 星号加空格是列表项",
    "a*b*c",
    "混排 @Image1\n- 列表里也有 @Video2\n\n结尾段",
    "# 标题",
    "#### 四个井号不是标题",
    "#没有空格",
    "# 标题\n正文",
    "# 标题\n## 二级\n### 三级",
    "  # 缩进的标题",
    "# ",
    "#",
    "# @Image1",
    // 随机输入逮到的回归：缩进的列表项若要求顶格识别，normalize 会不幂等
    "\t* 缩进的列表项",
    "   - 空格缩进的列表项",
    "  3. 缩进的有序项",
  ];

  for (const text of CORPUS) {
    it(`normalize 幂等：${JSON.stringify(text.slice(0, 28))}`, () => {
      const once = normalizePrompt(text);
      expect(normalizePrompt(once)).toBe(once);
    });
  }

  it("normalize 对随机输入也幂等", () => {
    // 字母表刻意塞满会触发规则的字符：@ 引用、横杠、点号、换行、星号
    const ALPHABET = [
      "@", "I", "m", "a", "g", "e", "V", "i", "d", "o", "A", "u",
      "1", "2", "0", " ", "\n", "-", "*", ".", "\t", "猫", "，", "(", "`",
      // 井号必须在里面：标题现在带着符号序列化，是最容易破坏幂等的一条规则
      "#",
    ];
    let seed = 20260823;
    const rand = () => {
      // xorshift，固定种子——失败必须能原样复现
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >> 17;
      seed ^= seed << 5;  seed >>>= 0;
      return seed / 0x100000000;
    };
    // 默认跑得快；要压就 FUZZ=200000 npm test
    const rounds = Number(process.env.FUZZ ?? 3000);
    for (let i = 0; i < rounds; i++) {
      const len = 1 + Math.floor(rand() * 40);
      let s = "";
      for (let j = 0; j < len; j++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
      const once = normalizePrompt(s);
      const twice = normalizePrompt(once);
      if (twice !== once) {
        throw new Error(
          `不幂等\n输入 ${JSON.stringify(s)}\n一次 ${JSON.stringify(once)}\n两次 ${JSON.stringify(twice)}`
        );
      }
    }
  });

  it("提交内容是不动点：serialize(parse(serialize(d))) === serialize(d)", () => {
    const docs: PromptDoc[] = [
      {
        blocks: [
          { type: "heading", level: 1, children: [{ type: "text", text: "开场镜头" }] },
          {
            type: "paragraph",
            children: [
              { type: "text", text: "人物走入 " },
              { type: "ref", token: "Image1" },
              { type: "note", text: "这句待定" },
            ],
          },
          { type: "divider" },
          {
            type: "list",
            ordered: true,
            items: [
              [{ type: "text", text: "推镜" }],
              [{ type: "text", text: "摇镜 " }, { type: "ref", token: "Video1" }],
            ],
          },
          { type: "note", children: [{ type: "text", text: "整段草稿备注" }] },
        ],
      },
      { blocks: [] },
      { blocks: [{ type: "divider" }] },
    ];
    for (const doc of docs) {
      const canonical = serializePrompt(doc);
      expect(serializePrompt(parsePrompt(canonical))).toBe(canonical);
    }
  });

  it("安全子集上 parse(serialize(doc)) 确实回到原 doc", () => {
    // 段落 / 列表 / 引用 / 软换行——没有标题、注释、槽位、分隔线
    const doc: PromptDoc = {
      blocks: [
        {
          type: "paragraph",
          children: [
            { type: "text", text: "一只猫在 " },
            { type: "ref", token: "Image1" },
            { type: "br" },
            { type: "text", text: "第二行" },
          ],
        },
        {
          type: "list",
          ordered: false,
          items: [[{ type: "text", text: "甲" }], [{ type: "text", text: "乙" }]],
        },
      ],
    };
    expect(parsePrompt(serializePrompt(doc))).toEqual(doc);
  });
});
