/**
 * 导出文件名。单独一个模块，是因为页面只需要它——
 * 和 zod schema 放一起的话，客户端包会把整个校验库一起拖进去。
 */
/** 给下载用的文件名。技能名可能含斜杠、引号、中文标点，全都得洗掉 */
export function portableFileName(name: string): string {
  const safe = name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `skill-${safe || "untitled"}.json`;
}
