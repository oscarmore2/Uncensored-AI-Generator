/**
 * token 与点数之间的换算。纯函数，不碰数据库、不 server-only——
 * 这样它能被单测直接跑，也能在界面上预估「这次大概花几点」。
 */

/**
 * token 数 -> 扣多少点。
 *
 * 向上取整且至少 1 点（费率配成 0 时例外，那是「本功能不收费」的显式意图）。
 * 不设下限的话，短句改写会算出 0 点，等于免费无限调用大模型。
 */
export function creditsForTokens(totalTokens: number, per1kCredits: number): number {
  if (per1kCredits <= 0) return 0;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 0;
  return Math.max(1, Math.ceil((totalTokens / 1000) * per1kCredits));
}

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
