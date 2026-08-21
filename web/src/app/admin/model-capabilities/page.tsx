"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

/**
 * 模型能力档案 + 与现行启发式的差异报告。
 *
 * 这一页是「要不要把运行期切到能力表」的决策依据：先看清楚切过去会改变
 * 多少个模型的行为、改的是哪几个字段，再决定。目前运行期仍走旧逻辑，
 * 这里只读不写。
 */

type Diff = { field: string; was: string; now: string };
type Input = { field: string; kind: string; role: string; min: number; max: number | null };
type Row = {
  provider: string;
  model_id: string;
  name: string;
  type: string;
  bound: boolean;
  summary: string;
  inputs: Input[];
  notes: string[];
  diffs: Diff[];
  status: string;
};

const STATUS_CN: Record<string, string> = {
  missing: "未派生",
  derived: "已派生",
  reviewed: "已复核",
  manual: "人工覆盖",
  stale: "待复核",
};

export default function ModelCapabilitiesPage() {
  const [data, setData] = useState<{ total: number; with_diff: number; bound_with_diff: number; rows: Row[] } | null>(null);
  const [onlyBound, setOnlyBound] = useState(true);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const q = new URLSearchParams();
      if (onlyBound) q.set("bound", "1");
      if (onlyDiff) q.set("diff", "1");
      setData(await api(`/api/admin/model-capabilities?${q}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, [onlyBound, onlyDiff]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">模型能力档案</h1>
        <p className="mt-1 text-sm text-ink-muted">
          把上游 schema 归一成固定的输入角色与产出类型。运行期目前仍走旧的启发式，
          这一页用来核对切换过去会改变什么。
        </p>
      </div>

      {data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <Stat label="模型" value={data.total} />
          <Stat label="与旧逻辑有差异" value={data.with_diff} tone={data.with_diff ? "warn" : "ok"} />
          <Stat label="其中已绑产品" value={data.bound_with_diff} tone={data.bound_with_diff ? "warn" : "ok"} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyBound} onChange={(e) => setOnlyBound(e.target.checked)} className="accent-orange-700" />
          只看已绑产品的
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} className="accent-orange-700" />
          只看有差异的
        </label>
        <button type="button" onClick={() => void load()} className="rounded-2xl border border-line px-3 py-1.5 text-xs hover:bg-black/[0.04]">
          刷新
        </button>
      </div>

      {err && <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-700">{err}</p>}

      <div className="overflow-x-auto rounded-3xl border border-line">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-black/[0.03] text-left text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-2.5">渠道</th>
              <th className="px-4 py-2.5">模型</th>
              <th className="px-4 py-2.5">能力摘要</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">差异</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => {
              const key = `${r.provider}|${r.model_id}`;
              return (
                <tr key={key} className="border-t border-line align-top">
                  <td className="px-4 py-2.5 text-xs text-ink-subtle">{r.provider}</td>
                  <td className="px-4 py-2.5">
                    <button type="button" onClick={() => setOpen(open === key ? null : key)} className="text-left font-mono text-xs hover:text-orange-700">
                      {r.model_id}
                    </button>
                    {r.bound && <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-px text-[10px] text-emerald-700">已绑</span>}
                    {open === key && (
                      <div className="mt-2 space-y-1 rounded-2xl bg-black/[0.03] p-3 text-[11px]">
                        {r.inputs.map((i) => (
                          <div key={i.field} className="font-mono">
                            {i.field} · {i.kind} · <span className="text-orange-700">{i.role}</span> · {i.min}~{i.max ?? "n"}
                          </div>
                        ))}
                        {r.inputs.length === 0 && <div className="text-ink-subtle">无媒体输入位</div>}
                        {r.notes.map((n, idx) => (
                          <div key={idx} className="text-amber-700">⚠ {n}</div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">{r.summary}</td>
                  <td className="px-4 py-2.5 text-xs">{STATUS_CN[r.status] ?? r.status}</td>
                  <td className="px-4 py-2.5">
                    {r.diffs.length === 0 ? (
                      <span className="text-xs text-ink-subtle">—</span>
                    ) : (
                      <div className="space-y-0.5">
                        {r.diffs.map((d, idx) => (
                          <div key={idx} className="text-[11px]">
                            <span className="font-mono">{d.field}</span>：
                            <span className="text-ink-subtle">{d.was}</span> → <span className="font-semibold text-orange-700">{d.now}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data?.rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-subtle">没有符合条件的模型</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "text-ink";
  return (
    <div className="rounded-2xl border border-line px-4 py-2">
      <span className="text-xs text-ink-subtle">{label}</span>{" "}
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}
