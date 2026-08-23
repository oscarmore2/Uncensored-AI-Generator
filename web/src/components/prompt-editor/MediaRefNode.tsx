"use client";

import {
  DecoratorNode,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import type { RefKind } from "@/lib/prompt-doc";

/**
 * 素材引用胶囊：Lexical 的**原子节点**。
 *
 * 这是整套改造最先要拿到的东西。textarea 里 @Image1 只是七个普通字符，
 * 退格能把它删成 @Imag（还是合法文本，只是不再是引用了），
 * 也没有任何办法给它上色、挂状态、点击定位。原子节点一次性解决这些：
 * 光标跨不进去，退格整颗删掉，渲染完全由我们说了算。
 *
 * 节点里存的是 **token 字符串**（Image1），不是 URL、不是数组下标。
 * 序列化时原样吐 @Image1，语义永远是「我发给上游的第 1 张图」——
 * 拖动缩略图换顺序即换引用，这条延迟绑定是 PromptMentionBox 刻意保留的，
 * 这里必须继承。
 */

/**
 * 插入那一刻它指向谁。**仅供漂移告警**，绝不参与序列化。
 *
 * 看起来和上面「不存 URL」矛盾，其实不是：token 是权威，hint 是线索。
 * 少了它，「编号所指已变」这个状态在原理上就测不出来——
 * 用户删掉第 1 张图之后 @Image2 静默改指另一张，提示词一字未改、含义全变，
 * 而系统能看到的只有一个仍然合法的 Image2。
 * 存了它就能说一句「这颗胶囊现在指向的不是你当初选的那张」。
 *
 * 它可以过期、可以对不上、可以是 null，任何时候都不影响提交内容。
 */
export type SerializedMediaRefNode = Spread<
  { token: string; hint: string | null },
  SerializedLexicalNode
>;

/** 胶囊要展示什么，由编辑器从当前素材列表算出来后灌进来 */
export type ResolvedRef = { url: string; kind: RefKind; name: string };

export type MediaRefState = "ok" | "drifted" | "orphan";

export type RebindOption = { token: string; kind: RefKind; url: string; name: string };

export type MediaRefContextValue = {
  /** 当前 token 实际指向哪份素材；指不到（孤儿）返回 null */
  resolve(token: string): ResolvedRef | null;
  /** 换绑候选：当前可引用的全部素材 */
  options(): RebindOption[];
  /** 点胶囊主体：正常态滚到素材栏对应项，孤儿态跳到上传位 */
  onActivate?(token: string, state: MediaRefState): void;
  /** 文案由外面给，本文件不碰 i18n */
  labels: { orphan: string; drifted: string; rebind: string };
};

/**
 * 用 context 而不是把状态塞进节点。
 *
 * 塞进节点意味着每次用户增删一张图都要遍历并重写整个 editorState——
 * 那会把撤销栈搅烂（每次媒体变动都成为一步可撤销操作），
 * 而且和「token 是唯一权威」直接打架。
 * context 变了 React 重渲染胶囊，editorState 一个字节没动。
 */
const MediaRefContext = createContext<MediaRefContextValue | null>(null);
export const MediaRefProvider = MediaRefContext.Provider;

export class MediaRefNode extends DecoratorNode<React.ReactNode> {
  __token: string;
  __hint: string | null;

  static getType(): string {
    return "media-ref";
  }

  static clone(node: MediaRefNode): MediaRefNode {
    return new MediaRefNode(node.__token, node.__hint, node.__key);
  }

  constructor(token: string, hint: string | null = null, key?: NodeKey) {
    super(key);
    this.__token = token;
    this.__hint = hint;
  }

  getToken(): string {
    return this.__token;
  }

  getHint(): string | null {
    return this.__hint;
  }

  /**
   * 换绑到别的素材。
   *
   * hint 跟着一起换：换完这颗胶囊指向的就是用户**刚刚亲自选的**那份，
   * 再报「所指已变」就成了误报。
   */
  setToken(token: string, hint: string | null): this {
    const self = this.getWritable();
    self.__token = token;
    self.__hint = hint;
    return self;
  }

  /**
   * Lexical 自己的 getTextContent()。
   *
   * 复制粘贴、纯文本导出这些内建路径会走它，所以必须吐规范形式——
   * 否则用户从编辑器里复制一段带胶囊的文字贴到别处，胶囊会凭空消失。
   * 正式的序列化仍然走 lexical-bridge，不依赖这里。
   */
  getTextContent(): string {
    return `@${this.__token}`;
  }

  isInline(): boolean {
    return true;
  }

  /** 能用键盘选中，否则纯键盘用户没法删掉它 */
  isKeyboardSelectable(): boolean {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    span.className = "inline-block align-baseline";
    return span;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    // 拖到外部应用时留下规范文本，不留一个空 span
    const el = document.createElement("span");
    el.textContent = this.getTextContent();
    return { element: el };
  }

  exportJSON(): SerializedMediaRefNode {
    return { ...super.exportJSON(), token: this.__token, hint: this.__hint };
  }

  static importJSON(serialized: SerializedMediaRefNode): MediaRefNode {
    return $createMediaRefNode(serialized.token, serialized.hint ?? null);
  }

  decorate(): React.ReactNode {
    // 把 key 传下去，胶囊才改得动自己（换绑）
    return <MediaRefChip nodeKey={this.getKey()} token={this.__token} hint={this.__hint} />;
  }
}

export function $createMediaRefNode(token: string, hint: string | null = null): MediaRefNode {
  return new MediaRefNode(token, hint);
}

export function $isMediaRefNode(node: LexicalNode | null | undefined): node is MediaRefNode {
  return node instanceof MediaRefNode;
}

/* ------------------------------------------------------------------ *
 * 胶囊本体
 * ------------------------------------------------------------------ */

const STATE_STYLE: Record<MediaRefState, string> = {
  ok: "border-orange-500/40 bg-orange-500/15 text-orange-900",
  // 漂移：还能用，但多半不是用户以为的那张。黄色 + 问号，不划掉
  drifted: "border-amber-500/60 bg-amber-400/20 text-amber-900",
  // 孤儿：指不到任何素材，提交上去就是一句模型读不懂的记号
  orphan: "border-red-500/50 bg-red-500/15 text-red-900 line-through decoration-red-500/70",
};

function MediaRefChip({
  nodeKey,
  token,
  hint,
}: {
  nodeKey: string;
  token: string;
  hint: string | null;
}) {
  const [editor] = useLexicalComposerContext();
  const ctx = useContext(MediaRefContext);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const target = ctx?.resolve(token) ?? null;

  const state: MediaRefState = !target
    ? "orphan"
    : hint && hint !== target.url
      ? "drifted"
      : "ok";

  const title =
    state === "orphan" ? ctx?.labels.orphan : state === "drifted" ? ctx?.labels.drifted : target?.name;

  const rebind = (option: RebindOption) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isMediaRefNode(node)) node.setToken(option.token, option.url);
    });
    setMenu(null);
  };

  /* 菜单走 portal 挂到 body 上、用 fixed 定位。
   * 编辑区是 overflow-y-auto 的滚动容器，菜单要是留在胶囊里面，
   * 一旦胶囊靠近容器边缘，菜单就会被裁掉半截。 */
  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // 捕获阶段关掉：菜单项自己的 mousedown 会 stopPropagation，不受影响
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  return (
    <span
      ref={ref}
      /* contentEditable=false 是原子性的关键：少了它光标能走进胶囊内部，
       * 退格就又能把它删成半截了 */
      contentEditable={false}
      className={`mx-px inline-flex select-none items-center gap-1 rounded-full border px-1.5 py-px align-baseline text-[0.9em] leading-snug ${STATE_STYLE[state]}`}
    >
      <span
        role="button"
        tabIndex={-1}
        title={title}
        onClick={() => ctx?.onActivate?.(token, state)}
        className="inline-flex items-center gap-1"
      >
        {target?.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={target.url} alt="" className="h-[1.1em] w-[1.1em] rounded-full object-cover" />
        ) : target?.kind === "video" ? (
          <i className="fas fa-film text-[0.8em] opacity-70" />
        ) : target?.kind === "audio" ? (
          <i className="fas fa-music text-[0.8em] opacity-70" />
        ) : (
          <i className="fas fa-link-slash text-[0.8em] opacity-70" />
        )}
        <span className="font-mono text-[0.85em] font-semibold">{token}</span>
      </span>

      <button
        type="button"
        aria-label={ctx?.labels.rebind}
        title={ctx?.labels.rebind}
        /* 不能让点击把编辑器的选区抢走，否则关掉菜单后光标不知道去哪了 */
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          menu ? setMenu(null) : openMenu();
        }}
        className="-mr-0.5 flex items-center opacity-60 hover:opacity-100"
      >
        <i className="fas fa-chevron-down text-[0.62em]" />
      </button>

      {menu &&
        createPortal(
          <div
            role="listbox"
            aria-label={ctx?.labels.rebind}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ left: menu.x, top: menu.y }}
            className="fixed z-[240] max-h-56 w-52 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface py-1 shadow-xl"
          >
            {(ctx?.options() ?? []).map((option) => (
              <button
                key={option.token}
                type="button"
                role="option"
                aria-selected={option.token === token}
                onMouseDown={(e) => {
                  e.preventDefault();
                  rebind(option);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                  option.token === token ? "bg-orange-600/15" : "hover:bg-black/[0.04]"
                }`}
              >
                {option.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={option.url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-stage text-ink-subtle">
                    <i className={`fas ${option.kind === "video" ? "fa-film" : "fa-music"} text-[10px]`} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[11px] font-semibold">{option.token}</span>
                  <span className="block truncate text-[10px] text-ink-subtle">{option.name}</span>
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </span>
  );
}
