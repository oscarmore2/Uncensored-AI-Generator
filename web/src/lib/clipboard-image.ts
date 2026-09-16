/**
 * 从粘贴事件里把图片挑出来。
 *
 * 为什么不用 `navigator.clipboard.read()`：那个要权限弹窗，Safari 还只在用户
 * 手势里给。而 paste 事件**本身就是用户手势**，`clipboardData` 直接可读——
 * 用户按下 ⌘V 这个动作就是授权，不必再问一次。
 *
 * 这里全部写成鸭子类型而不是 `DataTransfer`/`HTMLElement`：
 * 单测跑在 node 环境里，没有 DOM。真实的 DataTransfer 结构上是兼容的。
 */

type ClipboardLike =
  | {
      files?: ArrayLike<File> | null;
      items?: ArrayLike<{ kind: string; getAsFile: () => File | null }> | null;
      getData?: (type: string) => string;
    }
  | null
  | undefined;

/**
 * 剪贴板里的图片。非图片一律不要——这里只服务「照片输入栏」。
 *
 * files 与 items 两条路都要走：从文件管理器复制的走 files，
 * 截图工具和网页复制的走 items（kind === "file"）。两边可能指向同一份数据，
 * 按「名字+大小+类型」去重，否则一次粘贴会传两份。
 */
export function imageFilesFrom(dt: ClipboardLike): File[] {
  if (!dt) return [];
  const out: File[] = [];
  const seen = new Set<string>();

  const push = (f: File | null | undefined) => {
    if (!f || typeof f.type !== "string" || !f.type.startsWith("image/")) return;
    const sig = `${f.name}|${f.size}|${f.type}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(f);
  };

  for (let i = 0; i < (dt.files?.length ?? 0); i++) push(dt.files?.[i]);
  for (let i = 0; i < (dt.items?.length ?? 0); i++) {
    const item = dt.items?.[i];
    if (item?.kind === "file") push(item.getAsFile());
  }
  return out;
}

/** 剪贴板里有没有正经文本（空白不算） */
export function hasPlainText(dt: ClipboardLike): boolean {
  try {
    return Boolean(dt?.getData?.("text/plain")?.trim());
  } catch {
    return false;
  }
}

/** 光标是不是正停在能输入文字的地方 */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { isContentEditable?: unknown; tagName?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * 这次粘贴该不该让给文本。
 *
 * **唯一让路的情况**：剪贴板里同时有文本，而光标正停在输入框里——那时用户要的
 * 显然是文本。反过来，从网页复制的图片常常只带 text/html 不带 text/plain，
 * 那种仍然按贴图处理（贴进提示词编辑器本来也什么都不会发生，见
 * PromptEditor 的 PastePlugin：拿不到 text/plain 就原样交回默认行为）。
 */
export function yieldsToText(dt: ClipboardLike, target: unknown): boolean {
  return hasPlainText(dt) && isEditableTarget(target);
}

/**
 * 粘贴来的图片常常叫 image.png 或者干脆没名字，连贴几张就全同名。
 * 给个带时刻的名字，列表里才分得出谁是谁。
 */
export function clipboardImageName(file: File, index = 0): string {
  const generic = !file.name || /^image\.\w+$/i.test(file.name);
  if (!generic) return file.name;
  const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
  return `粘贴-${stamp}${index > 0 ? `-${index + 1}` : ""}.${ext}`;
}

/**
 * ⌘V 该贴到哪个位上：**按 specs 顺序，第一个还有空位的图片位**。
 *
 * 只认图片——视频和音频不走剪贴板。
 *
 * 为什么不按「最近点过的位」：点位这个动作会打开文件选择框，没法同时兼作
 * 「选中目标」。按顺序填反而是可预期的：首帧图满了自然轮到尾帧图，
 * 而且目标位上会挂提示，用户看得见下一张贴到哪去。
 *
 * 参数写成结构类型而不是 MediaInputSpec，是为了让这个纯函数留在 lib 里可单测，
 * 不把整个组件（连同 React）拖进 node 环境的测试。
 */
export function pasteTargetField(
  specs: ReadonlyArray<{ field: string; kind: string; maxItems: number }>,
  value: Readonly<Record<string, ReadonlyArray<unknown>>>
): string | null {
  const spec = specs.find((s) => s.kind === "image" && (value[s.field]?.length ?? 0) < s.maxItems);
  return spec?.field ?? null;
}
