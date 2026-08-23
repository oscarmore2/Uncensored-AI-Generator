"use client";

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type TriggerFn,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode } from "lexical";
import { $createMediaRefNode } from "./MediaRefNode";
import type { RefKind } from "@/lib/prompt-doc";

/**
 * 打 @ 弹出素材列表。
 *
 * 这是从 PromptMentionBox 搬过来的能力，**行为必须一比一对齐**——
 * 换掉 textarea 的同时把菜单弄丢或者弄得不一样，对用户就是功能退化，
 * 而且是那种「以前能用现在不能用」的退化，比没做还糟。
 */

export type RefTarget = {
  /** 插进提示词里的写法（不含 @），如 Image1 */
  token: string;
  kind: RefKind;
  url: string;
  name: string;
};

/**
 * 触发条件与 PromptMentionBox 的 MENTION_RE **逐字符相同**。
 *
 * 不用库里的 useBasicTypeaheadTriggerMatch：它只认 @ 前面是空白或行首，
 * 而中文写作里 `场景，@` 这种太常见了——那条路一断，用户会以为 @ 引用坏了。
 * 这条正则允许中英文标点，是原组件里已经验证过的。
 */
const MENTION_RE = /(?:^|[\s([{（【「，,。.:：;；!！?？、])@([A-Za-z0-9_]*)$/;

class RefOption extends MenuOption {
  constructor(public target: RefTarget) {
    super(target.token);
  }
}

const KIND_ICON: Record<RefKind, string> = {
  image: "fa-image",
  video: "fa-film",
  audio: "fa-music",
};

export function MentionPlugin({
  targets,
  labels,
}: {
  targets: RefTarget[];
  labels: { header: string; empty: string; navigate: string; select: string; close: string };
}) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);

  const triggerFn: TriggerFn = useCallback((text) => {
    const hit = MENTION_RE.exec(text);
    if (!hit) return null;
    const matchingString = hit[1];
    // 只替换 @ 和它后面那截，**前导分隔符原样留着**——它是用户写的标点，
    // 而且正好让插进去的引用满足「前面必须是分隔符」这条识别式
    const replaceableString = `@${matchingString}`;
    return {
      leadOffset: text.length - replaceableString.length,
      matchingString,
      replaceableString,
    };
  }, []);

  const options = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    const hit = q ? targets.filter((t) => t.token.toLowerCase().startsWith(q)) : targets;
    return hit.map((t) => new RefOption(t));
  }, [query, targets]);

  const onSelect = useCallback(
    (option: RefOption, nodeToReplace: import("lexical").TextNode | null, closeMenu: () => void) => {
      editor.update(() => {
        /* hint 存插入那一刻指向谁，只用于日后的漂移告警，不参与序列化 */
        const chip = $createMediaRefNode(option.target.token, option.target.url);
        if (nodeToReplace) nodeToReplace.replace(chip);
        // 补一个尾随空格，和 PromptMentionBox 的 insert 一致：
        // 不补的话紧接着再打一个 @ 引用会贴在一起，第二个就不算引用了
        const space = $createTextNode(" ");
        chip.insertAfter(space);
        space.select();
        closeMenu();
      });
    },
    [editor]
  );

  // 一份素材都没有时不挂菜单，免得弹出一个选不中任何东西的空框
  if (targets.length === 0) return null;

  return (
    <LexicalTypeaheadMenuPlugin<RefOption>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelect}
      triggerFn={triggerFn}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) =>
        anchorRef.current
          ? createPortal(
              <div
                role="listbox"
                aria-label={labels.header}
                className="w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
              >
                <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {labels.header}
                </div>

                {options.length === 0 ? (
                  <div className="px-3 pb-3 text-xs text-ink-subtle">{labels.empty}</div>
                ) : (
                  <div className="max-h-56 overflow-y-auto overscroll-contain pb-1">
                    {options.map((option, i) => (
                      <button
                        key={option.key}
                        type="button"
                        role="option"
                        aria-selected={i === selectedIndex}
                        ref={(el) => option.setRefElement(el)}
                        onMouseEnter={() => setHighlightedIndex(i)}
                        /* 在 mousedown 上就落地。点击的默认行为会让编辑器失焦，
                         * 菜单随之卸载，click 根本没有落点——鼠标选择会静默失败，
                         * 而键盘选择不受影响，所以极容易漏测。原组件踩过这个坑。 */
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectOptionAndCleanUp(option);
                        }}
                        className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${
                          i === selectedIndex ? "bg-orange-600/15" : "hover:bg-black/[0.04]"
                        }`}
                      >
                        <Thumb target={option.target} />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block rounded px-1.5 py-px font-mono text-[11px] font-semibold ${
                              i === selectedIndex ? "bg-orange-600/25 text-orange-800" : "text-ink"
                            }`}
                          >
                            {option.target.token.toUpperCase()}
                          </span>
                          <span className="mt-0.5 block truncate px-1.5 text-[10px] text-ink-subtle">
                            {option.target.name}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[10px] text-ink-subtle">
                  <Key>↑</Key>
                  <Key>↓</Key>
                  <span>{labels.navigate}</span>
                  <Key>↵</Key>
                  <span>{labels.select}</span>
                  <Key>esc</Key>
                  <span>{labels.close}</span>
                </div>
              </div>,
              anchorRef.current
            )
          : null
      }
    />
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-black/[0.04] px-1 font-sans text-[10px] leading-4 text-ink-muted">
      {children}
    </kbd>
  );
}

function Thumb({ target }: { target: RefTarget }) {
  const box = "h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line bg-stage";
  if (target.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={target.url} alt="" className={`${box} object-cover`} />;
  }
  if (target.kind === "video") {
    return (
      <video src={`${target.url}#t=0.1`} className={`${box} object-cover`} preload="metadata" muted playsInline />
    );
  }
  return (
    <span className={`${box} flex items-center justify-center text-ink-subtle`}>
      <i className={`fas ${KIND_ICON.audio} text-xs`} />
    </span>
  );
}
