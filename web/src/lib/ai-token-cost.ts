/**
 * 拿不到上游用量时的 token 估算。纯函数，不碰数据库。
 *
 * 「token 数 → 点数」那一半已经搬去 `llm/pricing.ts`：那里按微点算，
 * 精度到千分之一点。原来这里那个「至少 1 点」的整点口径是成本的几十倍，
 * 随魔法指令归位成技能一并退休了。
 */

/** 中日韩统一表意文字等「一字一 token」的区段 */
const CJK_RANGES: [number, number][] = [
  [0x3000, 0x303f], // CJK 标点
  [0x3040, 0x30ff], // 日文假名
  [0x3400, 0x4dbf], // 扩展 A
  [0x4e00, 0x9fff], // 基本区
  [0xf900, 0xfaff], // 兼容表意
  [0xff00, 0xffef], // 全角
];

function isCjk(cp: number): boolean {
  return CJK_RANGES.some(([a, b]) => cp >= a && cp <= b);
}

/**
 * 拿不到上游用量时的兜底估算。
 *
 * **只在上游没返回 usage 时用。** 估算必然不准，而这里不准的方向是
 * 向上取整、也就是多收用户的钱，所以能拿真实值就绝不估。
 *
 * 中日韩按一字一 token，其余按 4 字符一 token——通用 BPE 分词器的粗略
 * 经验值，不精确但不会离谱。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isCjk(cp)) cjk += 1;
  }
  const rest = [...text].length - cjk;
  return Math.ceil(cjk + rest / 4);
}
