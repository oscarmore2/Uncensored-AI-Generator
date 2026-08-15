"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface Item {
  id: number;
  user_id: number;
  channel: string;
  filename: string | null;
  content_type: string | null;
  bytes: number | null;
  sha256: string | null;
  sha256_short: string | null;
  url: string;
  refs: number;
  created_at: string;
  expires_at: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
}

interface Resp {
  items: Item[];
  stats: {
    live_assets: number;
    distinct_objects: number;
    shared_objects: number;
    referenced_bytes: number;
    stored_bytes: number;
    saved_bytes: number;
    without_hash: number;
  };
}

function mb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AdminMediaAssetsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [q, setQ] = useState("");
  const [onlyDup, setOnlyDup] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: "100" });
      if (q.trim()) qs.set("q", q.trim());
      if (onlyDup) qs.set("dup", "1");
      setData(await api<Resp>(`/api/admin/media-assets?${qs}`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [q, onlyDup]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.stats;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter mb-1">上传台账</h1>
        <p className="text-sm text-ink-muted">
          相同内容只在对象存储上留一份，多条记录共用同一个对象。
          「共用数」大于 1 就是去重生效的地方。
        </p>
      </div>

      {msg && <p className="text-sm text-amber-800">{msg}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          ["存活记录", s ? String(s.live_assets) : "—", null],
          ["实际对象数", s ? String(s.distinct_objects) : "—", s ? `其中 ${s.shared_objects} 个被复用` : null],
          ["实际占用", s ? mb(s.stored_bytes) : "—", s ? `引用合计 ${mb(s.referenced_bytes)}` : null],
          ["去重省下", s ? mb(s.saved_bytes) : "—", null],
        ].map(([label, value, hint]) => (
          <div key={String(label)} className="glass rounded-2xl p-4">
            <div className="text-xs text-ink-subtle">{label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
            {hint && <div className="mt-1 text-[11px] text-ink-subtle">{hint}</div>}
          </div>
        ))}
      </div>

      {s && s.without_hash > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          有 <strong className="tabular-nums">{s.without_hash}</strong> 条历史记录没有哈希，
          不参与去重——它们是加这个字段之前传的。这些文件照常可用，只是可能存在重复副本。
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜文件名，或粘贴哈希前几位"
          className="min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 py-2 text-sm outline-none focus:border-orange-500/50 sm:max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyDup} onChange={(e) => setOnlyDup(e.target.checked)} />
          只看被复用的
        </label>
      </div>

      <div className="glass overflow-hidden rounded-3xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-ink-subtle">
              <tr>
                <th className="px-4 py-3 font-medium">文件</th>
                <th className="px-4 py-3 font-medium">哈希</th>
                <th className="px-4 py-3 font-medium">大小</th>
                <th className="px-4 py-3 font-medium">共用数</th>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">上传时间</th>
                <th className="px-4 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data?.items.map((it) => (
                <tr key={it.id} className={it.deleted_at ? "opacity-55" : ""}>
                  <td className="max-w-[220px] px-4 py-2.5">
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener"
                      className="block truncate text-orange-700 hover:underline"
                      title={it.filename ?? it.url}
                    >
                      {it.filename ?? "(无文件名)"}
                    </a>
                    <span className="text-[11px] text-ink-subtle">
                      {it.channel} · {it.content_type ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-ink-muted">
                    {it.sha256_short ?? <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                    {it.bytes != null ? mb(it.bytes) : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {it.refs > 1 ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-700">
                        ×{it.refs}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-subtle">1</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-ink-muted">#{it.user_id}</td>
                  <td className="px-4 py-2.5 text-xs tabular-nums text-ink-subtle">
                    {new Date(it.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {it.deleted_at ? (
                      <span className="text-ink-subtle">已清理{it.delete_reason ? ` · ${it.delete_reason}` : ""}</span>
                    ) : it.expires_at ? (
                      <span className="text-ink-muted">
                        {new Date(it.expires_at).toLocaleDateString()} 到期
                      </span>
                    ) : (
                      <span className="text-emerald-700">长期保留</span>
                    )}
                  </td>
                </tr>
              ))}
              {data && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-ink-subtle">
                    没有匹配的记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
