"use client";

import { PROVIDER_LIST, type ProviderId } from "@/lib/providers/meta";

/**
 * 渠道切换 tab。管理端凡是「按渠道分」的页面都用这一个，
 * 保证 WaveSpeed 与 Atlas Cloud 在视觉上是平级的两块，而不是主次关系。
 *
 * 配色写成静态映射而不是拼 `bg-${accent}-…`：Tailwind 是编译期扫字符串的，
 * 拼出来的类名不会被生成，上线后就是没有颜色。
 */

const ACTIVE: Record<ProviderId, string> = {
  wavespeed: "bg-sky-600 border-sky-600 text-white",
  atlas: "bg-violet-600 border-violet-600 text-white",
};

const DOT: Record<ProviderId, string> = {
  wavespeed: "bg-sky-500",
  atlas: "bg-violet-500",
};

export type ProviderTabInfo = {
  id: ProviderId;
  label: string;
  /** 该渠道已同步的模型数；不传则不显示 */
  count?: number;
  /** 该渠道是否已配置可用 Key */
  configured?: boolean;
};

export function ProviderTabs({
  value,
  onChange,
  info,
  size = "md",
}: {
  value: ProviderId;
  onChange: (next: ProviderId) => void;
  info?: ProviderTabInfo[];
  size?: "sm" | "md";
}) {
  const byId = new Map((info ?? []).map((i) => [i.id, i]));
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-5 py-2.5 text-sm";

  return (
    <div className="inline-flex flex-wrap gap-2" role="tablist">
      {PROVIDER_LIST.map((p) => {
        const active = p.id === value;
        const meta = byId.get(p.id);
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.id)}
            className={`${pad} font-semibold rounded-2xl border transition-colors flex items-center gap-2 ${
              active ? ACTIVE[p.id] : "bg-surface border-line text-ink-muted hover:text-ink"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                active ? "bg-white/80" : meta?.configured === false ? "bg-ink-subtle/40" : DOT[p.id]
              }`}
            />
            {p.label}
            {meta?.count !== undefined && (
              <span className={`font-mono text-[11px] ${active ? "text-white/75" : "text-ink-subtle"}`}>
                {meta.count}
              </span>
            )}
            {meta?.configured === false && (
              <span
                title="该渠道尚未配置 API Key"
                className={`text-[10px] px-1.5 py-px rounded-full ${
                  active ? "bg-white/20" : "bg-amber-500/15 text-amber-800"
                }`}
              >
                未配置
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
