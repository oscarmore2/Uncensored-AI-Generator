import type { MediaInputSpec } from "@/lib/client";
import { formatRefToken, type RefKind } from "@/lib/prompt-doc";
import type { UploadedMedia } from "../MediaInputFields";

/**
 * 一份可被 @ 引用的素材。
 *
 * 从已下线的 PromptMentionBox 搬过来的（原名 MentionTarget）。
 * 那个组件整体被 Lexical 编辑器取代了，但这个纯函数与上游的编号约定绑在一起，
 * 与编辑器换不换无关，所以单独留下。
 */
export type RefTarget = {
  /** 插进提示词里的写法（不含 @），如 Image1 */
  token: string;
  kind: RefKind;
  /** 缩略图用 */
  url: string;
  /** 原始文件名，列表里当副标题 */
  name: string;
};

/**
 * 已上传素材 -> 可引用的 @ 名字。
 *
 * 按 specs 的顺序遍历而不是按 value 的键顺序：后者是「用户先传了哪个位」
 * 决定的插入顺序，和表单上看到的排列可能对不上，用户数出来的序号就会错位。
 *
 * 编号是**按位置延迟绑定**的，这是有意的，别改成插入时绑死 URL：
 * 提示词里存的是字面 token（@Image1），提交时才按目标模型改写，
 * 所以 @Image1 的含义始终是「我发给上游的第 1 张图」。
 * 于是拖动缩略图换顺序，就等于在不动提示词的前提下换掉引用——
 * 这是刻意保留的用法，别顺手加「排序后自动重编号提示词」那种贴心功能，
 * 那会把这条路堵死。顺序要不要改，交给人自己判断。
 *
 * 编号写法走 prompt-doc 的 formatRefToken，不在这里另留一份大小写映射：
 * 两处各写一份，早晚会有一处漏改，而症状是胶囊认不出来、引用原样上行。
 */
export function buildMentionTargets(
  specs: MediaInputSpec[],
  value: Record<string, UploadedMedia[]>
): RefTarget[] {
  const seq: Record<RefKind, number> = { image: 0, video: 0, audio: 0 };
  const out: RefTarget[] = [];
  for (const spec of specs) {
    for (const item of value[spec.field] ?? []) {
      const n = (seq[spec.kind] += 1);
      out.push({
        token: formatRefToken(spec.kind, n),
        kind: spec.kind,
        url: item.url,
        name: item.name,
      });
    }
  }
  return out;
}
