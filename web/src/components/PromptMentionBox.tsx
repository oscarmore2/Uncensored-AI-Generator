"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaInputSpec } from "@/lib/client";
import type { UploadedMedia } from "./MediaInputFields";

/**
 * 带 @ 素材引用的提示词输入框。
 *
 * 参考生视频这类模型是「一段提示词 + 一堆素材」，模型靠提示词里的
 * @Image1 / @Video1 / @Audio1 知道每句话说的是哪份素材
 * （Seedance 2.5 的 schema 原话：Cite reference inputs in submission order
 * with @-syntax）。让用户自己数第几张图必然出错，所以按 Atlas 创作台的做法，
 * 输入 @ 就把已上传的素材列出来选。
 *
 * 编号规则与上游一致：按类型各自从 1 开始，顺序即提交顺序
 * （表单里从上到下的位、位内从左到右的顺序）。
 */

export type MentionTarget = {
  /** 插进提示词里的写法（不含 @），如 Image1 */
  token: string;
  kind: MediaInputSpec["kind"];
  /** 缩略图用 */
  url: string;
  /** 原始文件名，列表里当副标题 */
  name: string;
};

const KIND_WORD: Record<MediaInputSpec["kind"], string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

const KIND_ICON: Record<MediaInputSpec["kind"], string> = {
  image: "fa-image",
  video: "fa-film",
  audio: "fa-music",
};

/**
 * 已上传素材 → 可引用的 @ 名字。
 *
 * 按 specs 的顺序遍历而不是按 value 的键顺序：后者是「用户先传了哪个位」
 * 决定的插入顺序，和表单上看到的排列可能对不上，用户数出来的序号就会错位。
 */
export function buildMentionTargets(
  specs: MediaInputSpec[],
  value: Record<string, UploadedMedia[]>
): MentionTarget[] {
  const seq: Record<MediaInputSpec["kind"], number> = { image: 0, video: 0, audio: 0 };
  const out: MentionTarget[] = [];
  for (const spec of specs) {
    for (const item of value[spec.field] ?? []) {
      const n = (seq[spec.kind] += 1);
      out.push({
        token: `${KIND_WORD[spec.kind]}${n}`,
        kind: spec.kind,
        url: item.url,
        name: item.name,
      });
    }
  }
  return out;
}

/**
 * 光标前面刚好是一个还没写完的 @xxx。
 * 要求 @ 前面是行首或分隔符，否则 email 里的 @ 也会把菜单弹出来。
 */
const MENTION_RE = /(?:^|[\s([{（【「，,。.:：;；!！?？、])@([A-Za-z0-9_]*)$/;

/**
 * 复制到镜像层上的样式。少一条都会让量出来的光标位置漂掉，
 * 尤其是 width / padding / font 这几条。
 */
const MIRROR_PROPS = [
  "box-sizing",
  "width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "font-style",
  "font-variant",
  "font-weight",
  "font-stretch",
  "font-size",
  "font-family",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "text-indent",
  "text-align",
  "white-space",
  "word-break",
  "overflow-wrap",
  "tab-size",
] as const;

/**
 * 量出第 index 个字符在 textarea 里的像素位置。
 *
 * textarea 没有任何 API 能问出光标坐标，通行做法是拿一个同样式的隐藏 div
 * 把前半段文字铺一遍，再看紧随其后的标记元素落在哪。
 */
function caretOffset(
  el: HTMLTextAreaElement,
  index: number
): { top: number; left: number; lineHeight: number } | null {
  const doc = el.ownerDocument;
  if (!doc?.body) return null;
  const computed = getComputedStyle(el);
  const mirror = doc.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  for (const prop of MIRROR_PROPS) {
    mirror.style.setProperty(prop, computed.getPropertyValue(prop));
  }

  mirror.textContent = el.value.slice(0, index);
  const marker = doc.createElement("span");
  // 空 span 没有盒子量不到位置；用后半段文字撑开，没有就放个占位字符
  marker.textContent = el.value.slice(index) || ".";
  mirror.appendChild(marker);

  doc.body.appendChild(mirror);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  mirror.remove();

  // line-height 可能是 "normal"，取不到数就按字号估一行
  const parsed = Number.parseFloat(computed.lineHeight);
  const lineHeight = Number.isFinite(parsed)
    ? parsed
    : Number.parseFloat(computed.fontSize) * 1.4 || 20;

  return { top: top - el.scrollTop, left: left - el.scrollLeft, lineHeight };
}

/** 菜单宽度，与下面的 w-64 保持一致；用来把菜单夹在输入框里 */
const MENU_WIDTH = 256;

export function PromptMentionBox({
  value,
  onChange,
  targets,
  placeholder,
  className,
  disabled,
  labels,
}: {
  value: string;
  onChange: (next: string) => void;
  /** 可引用的素材；为空时组件退化成普通 textarea */
  targets: MentionTarget[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  labels: {
    /** 列表标题 */
    header: string;
    navigate: string;
    select: string;
    close: string;
    /** 输入了 @ 但没有匹配项 */
    empty: string;
  };
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return q ? targets.filter((t) => t.token.toLowerCase().startsWith(q)) : targets;
  }, [query, targets]);

  const open = query !== null && targets.length > 0;

  const close = useCallback(() => {
    setQuery(null);
    setAnchor(null);
    setActive(0);
  }, []);

  /** 光标位置变了就重新判断该不该弹菜单 */
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el || disabled || targets.length === 0) return close();
    const caret = el.selectionStart ?? 0;
    // 选区不是一个点时不弹：那是在选文字，不是在打 @
    if ((el.selectionEnd ?? caret) !== caret) return close();
    const hit = MENTION_RE.exec(el.value.slice(0, caret));
    if (!hit) return close();
    setQuery(hit[1]);
    setActive(0);
    const pos = caretOffset(el, caret - hit[1].length - 1);
    setAnchor(
      pos
        ? {
            top: pos.top + pos.lineHeight,
            // 夹在输入框宽度内，免得靠右打 @ 时菜单探到框外面去
            left: Math.max(0, Math.min(pos.left, el.clientWidth - MENU_WIDTH)),
          }
        : null
    );
  }, [close, disabled, targets.length]);

  // 素材被删光后菜单要跟着收起来，否则会留一个选不中任何东西的空框
  useEffect(() => {
    if (targets.length === 0) close();
  }, [targets.length, close]);

  useEffect(() => {
    if (active >= matches.length) setActive(0);
  }, [active, matches.length]);

  function insert(target: MentionTarget) {
    const el = ref.current;
    if (!el || query === null) return;
    const caret = el.selectionStart ?? 0;
    const start = caret - query.length - 1; // 连同 @ 一起替换
    const next = `${value.slice(0, start)}@${target.token} ${value.slice(caret)}`;
    onChange(next);
    close();
    // onChange 触发的重渲染会把光标冲到末尾，等这一帧过去再摆回插入点之后
    const cursor = start + target.token.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(matches[active]);
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          // onChange 里读到的还是这一帧的 selectionStart，够用
          sync();
        }}
        onKeyUp={(e) => {
          // 这几个键在菜单开着时被菜单吃掉了，光标根本没动；
          // Escape 更是刚把菜单关掉，这里再 sync 一次会立刻把它弹回来
          if (["Escape", "ArrowUp", "ArrowDown", "Enter", "Tab"].includes(e.key)) return;
          sync();
        }}
        onClick={sync}
        onBlur={close}
        onKeyDown={onKeyDown}
        className={className}
        placeholder={placeholder}
        aria-expanded={open}
        aria-controls={open ? "prompt-mention-list" : undefined}
      />

      {open && (
        <div
          id="prompt-mention-list"
          role="listbox"
          aria-label={labels.header}
          // 菜单里的点击不能让 textarea 失焦，否则 onBlur 先关掉菜单，点击就落空了
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 w-64 max-w-[calc(100%-1rem)] overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
          style={{ top: anchor?.top ?? 0, left: anchor?.left ?? 0 }}
        >
          <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            {labels.header}
          </div>

          {matches.length === 0 ? (
            <div className="px-3 pb-3 text-xs text-ink-subtle">{labels.empty}</div>
          ) : (
            <div className="max-h-56 overflow-y-auto overscroll-contain pb-1">
              {matches.map((t, i) => (
                <button
                  key={`${t.token}-${t.url}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  /*
                   * 在 mousedown 上就落地，而不是等 click。
                   * 点击的默认行为会把焦点从 textarea 挪走，触发 onBlur → 菜单卸载，
                   * 于是 click 事件根本没有落点，鼠标选择会静默失败
                   * （键盘选择不受影响，所以很容易漏测）。mousedown 早于失焦，稳。
                   */
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insert(t);
                  }}
                  className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left ${
                    i === active ? "bg-orange-600/15" : "hover:bg-black/[0.04]"
                  }`}
                >
                  <MentionThumb target={t} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block rounded px-1.5 py-px font-mono text-[11px] font-semibold ${
                        i === active ? "bg-orange-600/25 text-orange-800" : "text-ink"
                      }`}
                    >
                      {t.token.toUpperCase()}
                    </span>
                    <span className="mt-0.5 block truncate px-1.5 text-[10px] text-ink-subtle">
                      {t.name}
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
        </div>
      )}
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-black/[0.04] px-1 font-sans text-[10px] leading-4 text-ink-muted">
      {children}
    </kbd>
  );
}

function MentionThumb({ target }: { target: MentionTarget }) {
  const box = "h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-line bg-stage";
  if (target.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={target.url} alt="" className={`${box} object-cover`} />;
  }
  if (target.kind === "video") {
    return (
      <video
        src={`${target.url}#t=0.1`}
        className={`${box} object-cover`}
        preload="metadata"
        muted
        playsInline
      />
    );
  }
  return (
    <span className={`${box} flex items-center justify-center text-ink-subtle`}>
      <i className={`fas ${KIND_ICON.audio} text-xs`} />
    </span>
  );
}
