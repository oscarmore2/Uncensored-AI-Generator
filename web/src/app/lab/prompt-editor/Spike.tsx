"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptEditorHandle } from "@/components/prompt-editor/PromptEditor";
import type { MediaRefContextValue, ResolvedRef } from "@/components/prompt-editor/MediaRefNode";
import { refTokensInText } from "@/lib/prompt-doc";

/*
 * contenteditable 必须 ssr:false。
 * Lexical 在服务端渲染出来的是一个空壳，hydrate 时再把内容填进去，
 * 首屏会明显跳一下；而且 P0 要量的是真实输入延迟，
 * 混进 hydration 的时间就不是我们要的数了。
 */
const PromptEditor = dynamic(
  () => import("@/components/prompt-editor/PromptEditor").then((m) => m.PromptEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[9rem] animate-pulse rounded-2xl bg-black/[0.04]" />
    ),
  }
);

/* ------------------------------------------------------------------ *
 * 假素材：不依赖网络，data URI 直接画出来
 * ------------------------------------------------------------------ */

function swatch(hex: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="12" fill="${hex}"/><text x="32" y="42" font-size="30" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

type Asset = { kind: ResolvedRef["kind"]; url: string; name: string };

const ALL_ASSETS: Asset[] = [
  { kind: "image", url: swatch("#ea580c", "1"), name: "橘猫.jpg" },
  { kind: "image", url: swatch("#0284c7", "2"), name: "窗台.jpg" },
  { kind: "image", url: swatch("#16a34a", "3"), name: "外套.png" },
  { kind: "video", url: swatch("#7c3aed", "V"), name: "运镜参考.mp4" },
  { kind: "audio", url: swatch("#db2777", "A"), name: "环境音.wav" },
];

const SEED = `一只橘猫坐在窗台上，参考 @Image1 的毛色和 @Image2 的光线。

分镜
- 开场：中景，镜头缓慢推近
- 第二镜：特写爪部，参考 @Video1 的运镜

背景音按 @Audio1 的氛围来。`;

/** 2000 字压测文本：真实形状的长提示词，中间散着胶囊 */
function longText(): string {
  const para = [
    "画面整体呈现暖调的午后氛围，空气中有细微的浮尘在光柱里缓慢移动，",
    "背景是虚化的木质窗框与半开的纱帘，纱帘随着微风轻轻起伏。",
    "主体的毛发边缘被逆光勾出一圈金色轮廓，细节清晰但不锐利过头。",
    "镜头保持轻微的手持感，呼吸般的起伏，避免完全静止带来的呆板。",
  ].join("");
  const blocks: string[] = [];
  for (let i = 0; i < 14; i++) {
    blocks.push(
      i % 3 === 0
        ? `第${i + 1}段 参考 @Image${(i % 3) + 1} 的处理方式。${para}`
        : `${para}整体参考 @Image${(i % 3) + 1} 与 @Video1。`
    );
  }
  return blocks.join("\n\n");
}

/* ------------------------------------------------------------------ *
 * 延迟统计
 * ------------------------------------------------------------------ */

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[i];
}

type Metrics = {
  /** 收到多少次输入事件（同步计数，一定准） */
  events: number;
  /** 其中量到帧的有多少次（要靠 rAF，页面不可见时会是 0） */
  samples: number;
  p50: number;
  p95: number;
  max: number;
  compositions: number;
  longestComposition: number;
};

const ZERO: Metrics = {
  events: 0,
  samples: 0,
  p50: 0,
  p95: 0,
  max: 0,
  compositions: 0,
  longestComposition: 0,
};

/* ------------------------------------------------------------------ *
 * 检查项
 * ------------------------------------------------------------------ */

const CHECKS = [
  {
    id: "cjk",
    title: "中文连续输入、候选词上屏",
    how: "用拼音连打一整句不停顿，中途翻页选词。看有没有漏字、重字、光标乱跳、拼音突然消失。",
  },
  {
    id: "backspace",
    title: "退格跨胶囊边界",
    how: "把光标放到某颗胶囊右边，连按退格。胶囊必须**整颗**消失，不能删成半截文字。再试试选中一段含胶囊的文字后直接打字覆盖。",
  },
  {
    id: "adjacent",
    title: "紧贴胶囊起输",
    how: "在胶囊正后方、正前方分别开始打中文。字要落在胶囊外面，不能被吸进胶囊里，也不能把胶囊挤没。",
  },
  {
    id: "long",
    title: "长文本 + 实时装饰下的输入延迟",
    how: "点下面的「灌 2000 字」，然后在**文档中间**（不是末尾）连续打字。低端机上重点看 p95。",
  },
] as const;

type Verdict = "untested" | "pass" | "fail";

const VERDICT_LABEL: Record<Verdict, string> = {
  untested: "未测",
  pass: "通过",
  fail: "有问题",
};

/* ------------------------------------------------------------------ *
 * 页面
 * ------------------------------------------------------------------ */

export function Spike() {
  const [text, setText] = useState(SEED);
  const [reloadKey, setReloadKey] = useState(0);
  const [seedText, setSeedText] = useState(SEED);
  /** 拔掉第 1 张图，制造孤儿与漂移——就是 make 页换档位时真实发生的事 */
  const [pruned, setPruned] = useState(false);
  const [metrics, setMetrics] = useState<Metrics>(ZERO);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [notes, setNotes] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const handle = useRef<PromptEditorHandle | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const samplesRef = useRef<number[]>([]);
  const eventsRef = useRef(0);
  const compRef = useRef({ count: 0, startedAt: 0, longest: 0 });

  const assets = useMemo(() => (pruned ? ALL_ASSETS.slice(1) : ALL_ASSETS), [pruned]);

  /** token -> 素材。编号按类型各自从 1 开始，与 buildMentionTargets 同一套规则 */
  const byToken = useMemo(() => {
    const seq: Record<string, number> = { image: 0, video: 0, audio: 0 };
    const map = new Map<string, ResolvedRef>();
    for (const a of assets) {
      const n = (seq[a.kind] += 1);
      const word = a.kind === "image" ? "Image" : a.kind === "video" ? "Video" : "Audio";
      map.set(`${word}${n}`, { url: a.url, kind: a.kind, name: a.name });
    }
    return map;
  }, [assets]);

  const refContext: MediaRefContextValue = useMemo(
    () => ({
      resolve: (token) => byToken.get(token) ?? null,
      options: () => [...byToken.entries()].map(([token, r]) => ({ token, ...r })),
      /* 点击日志单独存。原来它往 notes 里追加，而 notes 正是要给测试的人
       * 手写观察的那个框——两个 textarea 叠着，会自己长东西的偏偏是该写字的
       * 那个，实测直接导致报告被复制错。 */
      onActivate: (token, state) => {
        setLog((l) => [...l.slice(-19), `${token} 状态=${state}`]);
      },
      labels: {
        orphan: "这份素材已经不在了，提交上去模型读不懂这个记号",
        drifted: "编号还在，但现在指向的不是你当初选的那份",
        rebind: "改指到别的素材",
      },
    }),
    [byToken]
  );

  /*
   * 延迟采样。
   *
   * 量的是 beforeinput 到下一帧之间的时间——用户从按下到看见字的主观等待
   * 基本就是这一段。不量 keydown：中文输入法根本不发 keydown
   * （或者发一个 keyCode 229 的占位），只有 beforeinput 每次都到。
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const onBeforeInput = () => {
      const t0 = performance.now();
      /* 事件数同步记，帧延迟才靠 rAF。
       * 页面切到后台时 rAF 根本不跑，采样会一个都没有——
       * 那时如果只显示一个 0，测试的人会以为是自己没操作对。
       * 两个数分开记，下面就能明确说出是哪种情况。 */
      eventsRef.current += 1;
      requestAnimationFrame(() => {
        const dt = performance.now() - t0;
        const s = samplesRef.current;
        s.push(dt);
        if (s.length > 500) s.shift();
      });
    };
    const onCompStart = () => {
      compRef.current.startedAt = performance.now();
    };
    const onCompEnd = () => {
      const c = compRef.current;
      c.count += 1;
      if (c.startedAt) c.longest = Math.max(c.longest, performance.now() - c.startedAt);
      c.startedAt = 0;
    };

    host.addEventListener("beforeinput", onBeforeInput, true);
    host.addEventListener("compositionstart", onCompStart, true);
    host.addEventListener("compositionend", onCompEnd, true);
    return () => {
      host.removeEventListener("beforeinput", onBeforeInput, true);
      host.removeEventListener("compositionstart", onCompStart, true);
      host.removeEventListener("compositionend", onCompEnd, true);
    };
  }, []);

  /* 每秒把采样汇总一次。不在每次输入时 setState——那本身就会制造延迟，
   * 量出来的数就成了「测量行为自己的开销」 */
  useEffect(() => {
    const id = setInterval(() => {
      const sorted = [...samplesRef.current].sort((a, b) => a - b);
      setMetrics({
        events: eventsRef.current,
        samples: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        compositions: compRef.current.count,
        longestComposition: compRef.current.longest,
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback((next: string) => {
    setSeedText(next);
    setReloadKey((k) => k + 1);
  }, []);

  const resetMetrics = () => {
    samplesRef.current = [];
    eventsRef.current = 0;
    compRef.current = { count: 0, startedAt: 0, longest: 0 };
    setMetrics(ZERO);
  };

  const tokens = refTokensInText(text);
  const orphans = tokens.filter((t) => !byToken.has(t));

  const report = useMemo(() => {
    const lines = [
      "# Lexical IME spike 报告",
      `时间: ${new Date().toISOString()}`,
      `UA: ${typeof navigator === "undefined" ? "-" : navigator.userAgent}`,
      `屏幕: ${typeof window === "undefined" ? "-" : `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`}`,
      "",
      "## 延迟 (beforeinput -> 下一帧, ms)",
      `输入事件 ${metrics.events}  采样 ${metrics.samples}  p50 ${metrics.p50.toFixed(1)}  p95 ${metrics.p95.toFixed(1)}  max ${metrics.max.toFixed(1)}`,
      metrics.events > 0 && metrics.samples === 0
        ? "!! 有输入但一帧都没量到：页面多半在后台，请回到前台重测"
        : "",
      `composition 次数 ${metrics.compositions}  最长一次 ${metrics.longestComposition.toFixed(0)}ms`,
      `当前正文 ${text.length} 字`,
      "",
      "## 检查项",
      ...CHECKS.map((c) => `- [${VERDICT_LABEL[verdicts[c.id] ?? "untested"]}] ${c.title}`),
      "",
      "## 备注",
      notes || "(无)",
      "",
      "## 胶囊点击日志",
      ...(log.length ? log.map((l) => `- ${l}`) : ["(无)"]),
    ];
    return lines.filter((l) => l !== "").join("\n");
  }, [metrics, verdicts, notes, log, text.length]);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 text-ink">
      <header className="mb-5">
        <h1 className="text-lg font-bold">提示词编辑器 P0：输入法真机压测</h1>
        <p className="mt-1 text-xs leading-relaxed text-ink-subtle">
          这一页的唯一用途是回答一个问题：Lexical 的 contenteditable 在安卓中文输入法下能不能用。
          能用，它就是后面所有阶段的地基；不能用，整个真 WYSIWYG 方案回退到 textarea + 双栏。
          请用<strong>真机</strong>打开（安卓 Chrome + 搜狗/百度输入法），逐项测完，把最下面的报告发回来。
        </p>
      </header>

      {/* 编辑器 */}
      <section className="mb-4 rounded-2xl border border-line bg-surface p-3">
        <div ref={hostRef}>
          <PromptEditor
            initialText={seedText}
            reloadKey={reloadKey}
            onChangeText={setText}
            refContext={refContext}
            handle={handle}
            targets={[...byToken.entries()].map(([token, r]) => ({ token, ...r }))}
            labels={{
              heading: "分节标题",
              bullet: "无序列表",
              ordered: "有序列表",
              mentionHeader: "可引用素材",
              mentionEmpty: "没有匹配的素材",
              mentionNavigate: "移动",
              mentionSelect: "选中",
              mentionClose: "关闭",
            }}
            ariaLabel="提示词"
            placeholder="在这里打字…"
            className="min-h-[9rem] text-[15px] leading-relaxed"
          />
        </div>
      </section>

      {/* 素材栏 */}
      <section className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-ink-muted">素材（点一下插入胶囊）</h2>
          <button
            type="button"
            onClick={() => setPruned((p) => !p)}
            className="rounded-full border border-line px-2.5 py-1 text-[11px]"
          >
            {pruned ? "恢复第 1 张图" : "拔掉第 1 张图"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...byToken.entries()].map(([token, ref]) => (
            <button
              key={token}
              type="button"
              onClick={() => handle.current?.insertRef(token, ref.url)}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-1 text-[11px]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ref.url} alt="" className="h-4 w-4 rounded-full" />
              <span className="font-mono">{token}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
          「拔掉第 1 张图」重演的就是 make 页换模式/换档位时真实发生的事：
          <code className="mx-1">pruneMediaToSpecs</code> 把媒体丢掉，提示词里的编号无人处理。
          注意：只有<strong>通过素材按钮插入</strong>的胶囊记得住「当初选的是哪张」，
          从文本解析出来的（草稿恢复、套模板）记不住，所以只报得出红色孤儿、报不出黄色漂移。
          胶囊化之后，<span className="text-amber-700">黄色</span>= 编号还在但所指已变，
          <span className="text-red-700">红色划掉</span>= 指不到任何素材。textarea 时代这两种都是静默的。
        </p>
      </section>

      {/* 实时读数 */}
      <section className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="p50 (ms)" value={metrics.p50.toFixed(1)} />
        <Stat label="p95 (ms)" value={metrics.p95.toFixed(1)} tone={metrics.p95 > 50 ? "bad" : "ok"} />
        <Stat label="max (ms)" value={metrics.max.toFixed(0)} />
        <Stat label="正文字数" value={String(text.length)} />
      </section>

      <p className="mb-4 text-[11px] text-ink-subtle">
        输入事件 {metrics.events} / 量到帧 {metrics.samples}
        {metrics.events > 0 && metrics.samples === 0 && (
          <span className="ml-1 font-semibold text-red-700">
            —— 有输入却一帧都没量到，页面多半在后台。回到前台再测一次。
          </span>
        )}
      </p>

      <section className="mb-4 flex flex-wrap gap-2">
        <Btn onClick={() => reload(longText())}>灌 2000 字</Btn>
        <Btn onClick={() => reload(SEED)}>还原样例</Btn>
        <Btn onClick={() => reload("")}>清空</Btn>
        <Btn onClick={resetMetrics}>重置读数</Btn>
      </section>

      {/* 提交内容 */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-ink-muted">
          canonical（真正会离开编辑器的字符串）
        </h2>
        <pre className="max-h-40 overflow-auto rounded-2xl border border-line bg-black/[0.03] p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {text || "(空)"}
        </pre>
        <p className="mt-1.5 text-[11px] text-ink-subtle">
          引用 {tokens.length} 处
          {orphans.length > 0 && (
            <span className="text-red-700">，其中孤儿 {orphans.length} 处：{orphans.join("、")}</span>
          )}
        </p>
      </section>

      {/* 检查项 */}
      <section className="mb-4">
        <h2 className="mb-2 text-xs font-semibold text-ink-muted">逐项测（真机）</h2>
        <div className="space-y-2">
          {CHECKS.map((c) => {
            const v = verdicts[c.id] ?? "untested";
            return (
              <div key={c.id} className="rounded-2xl border border-line bg-surface p-2.5">
                <div className="text-[13px] font-semibold">{c.title}</div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">{c.how}</p>
                <div className="mt-2 flex gap-1.5">
                  {(["pass", "fail", "untested"] as Verdict[]).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setVerdicts((s) => ({ ...s, [c.id]: opt }))}
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        v === opt
                          ? opt === "pass"
                            ? "border-green-600 bg-green-600/15 text-green-800"
                            : opt === "fail"
                              ? "border-red-600 bg-red-600/15 text-red-800"
                              : "border-line bg-black/[0.05]"
                          : "border-line"
                      }`}
                    >
                      {VERDICT_LABEL[opt]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 报告 */}
      <section className="mb-10">
        <h2 className="mb-1.5 text-xs font-semibold text-ink-muted">报告（复制发回）</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="遇到的具体问题写这里：哪个输入法、什么操作、什么现象"
          className="mb-2 h-20 w-full rounded-2xl border border-line bg-surface p-2.5 text-[12px]"
        />
        <textarea
          readOnly
          value={report}
          onFocus={(e) => e.currentTarget.select()}
          className="h-56 w-full rounded-2xl border border-line bg-black/[0.03] p-2.5 font-mono text-[11px]"
        />
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div
      className={`rounded-2xl border p-2.5 ${
        tone === "bad" ? "border-red-500/50 bg-red-500/10" : "border-line bg-surface"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-base font-semibold">{value}</div>
    </div>
  );
}

function Btn({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px]"
    >
      {children}
    </button>
  );
}
