"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

type Policy = {
  id: number;
  media_type: string;
  channel: string;
  audience: string;
  retention_days: number | null;
  updated_at: string;
};

type CleanupRun = {
  id: number;
  dry_run: boolean;
  status: string;
  scanned: number;
  deleted: number;
  failed: number;
  started_at: string;
  completed_at: string | null;
};

type CleanupSettings = {
  policies: Policy[];
  pending: {
    uploads: number;
    main_generations: number;
    plaything_generations: number;
  };
  runs: CleanupRun[];
};

const labels: Record<string, string> = {
  "upload:all:all": "所有用户上传物",
  "generated:main:non_vip": "创作中心 · 非 VIP",
  "generated:main:vip": "创作中心 · VIP",
  "generated:plaything:non_vip": "玩物专区 · 非 VIP",
  "generated:plaything:vip": "玩物专区 · VIP",
};

export default function MediaCleanupPage() {
  const [data, setData] = useState<CleanupSettings | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api<CleanupSettings>("/api/admin/media-cleanup");
      setData(next);
      setPolicies(next.policies);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updatePolicy(id: number, patch: Partial<Policy>) {
    setPolicies((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ recalculated: number }>("/api/admin/media-cleanup", {
        method: "PATCH",
        body: JSON.stringify({ policies }),
      });
      setMessage(`策略已保存，并重算 ${result.recalculated} 条媒体的到期时间`);
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function run(dryRun: boolean) {
    if (!dryRun && !window.confirm("立即永久删除所有已到期媒体？此操作无法撤销。")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{
        scanned: number;
        deleted: number;
        failed: number;
      }>("/api/admin/media-cleanup", {
        method: "POST",
        body: JSON.stringify({ dry_run: dryRun, limit: 500 }),
      });
      setMessage(
        `${dryRun ? "试运行" : "清理"}完成：扫描 ${result.scanned}，${
          dryRun ? "预计清理" : "已清理"
        } ${result.deleted}，失败 ${result.failed}`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "执行失败");
    } finally {
      setBusy(false);
    }
  }

  /**
   * 媒体补录：把还挂在上游、没镜像到自家 OSS 的文件抓回来。
   * 上游随时可能清理文件，抓回来之前那些作品都是「随时会裂」的状态。
   */
  async function backfill(dryRun: boolean) {
    if (!dryRun && !window.confirm("开始补录？会把还能取到的上游媒体下载并转存到对象存储。")) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await api<{
        scanned: { publicWorks: number; generations: number };
        alreadyMirrored: number;
        rescued: number;
        dead: number;
        failed: number;
      }>("/api/admin/media-backfill", {
        method: "POST",
        body: JSON.stringify({ dry_run: dryRun, limit: 200 }),
      });
      setMessage(
        `${dryRun ? "补录体检" : "补录"}完成：扫描公共作品 ${r.scanned.publicWorks}、用户作品 ${r.scanned.generations}；` +
          `已在自家 OSS ${r.alreadyMirrored}，${dryRun ? "可补录" : "已补录"} ${r.rescued}，` +
          `上游已失效 ${r.dead}，失败可重试 ${r.failed}`
      );
      await load();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "补录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-3xl font-bold tracking-tighter mb-1">自动媒体清理</h1>
        <p className="text-sm text-ink-muted">
          精选作品不清理；修改策略会立即重算现有未精选媒体的到期时间。
        </p>
      </div>

      {message && <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">{message}</div>}

      <div className="grid grid-cols-3 gap-4">
        {[
          ["上传物", data?.pending.uploads ?? 0],
          ["创作中心", data?.pending.main_generations ?? 0],
          ["玩物专区", data?.pending.plaything_generations ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="glass rounded-2xl p-4">
            <div className="text-xs text-ink-subtle">{label} · 有到期策略</div>
            <div className="text-2xl font-bold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="glass rounded-3xl overflow-hidden">
        <div className="p-5 border-b border-line">
          <h2 className="font-semibold">媒体补录</h2>
          <p className="text-xs text-ink-subtle mt-1">
            把还挂在上游 CDN、没镜像到自家对象存储的媒体抓回来。上游随时会清理文件，
            没抓回来的作品都是「随时会裂」的状态。先体检看数字，再执行。
          </p>
        </div>
        <div className="p-5 flex flex-wrap gap-3">
          <button
            disabled={busy}
            onClick={() => backfill(true)}
            className="px-4 py-2 rounded-xl border border-line text-sm disabled:opacity-50"
          >
            体检（不写库）
          </button>
          <button
            disabled={busy}
            onClick={() => backfill(false)}
            className="px-4 py-2 rounded-xl bg-orange-700 text-white text-sm disabled:opacity-50"
          >
            执行补录
          </button>
        </div>
      </div>

      <div className="glass rounded-3xl overflow-hidden">
        <div className="p-5 border-b border-line">
          <h2 className="font-semibold">保留策略</h2>
          <p className="text-xs text-ink-subtle mt-1">保留天数从媒体创建时开始计算，可设 1–3650 天。</p>
        </div>
        <div className="divide-y divide-white/5">
          {policies.map((item) => {
            const key = `${item.media_type}:${item.channel}:${item.audience}`;
            const never = item.retention_days === null;
            return (
              <div key={item.id} className="grid grid-cols-[1fr_170px_150px] items-center gap-5 px-5 py-4">
                <div>
                  <div className="text-sm font-medium">{labels[key] ?? key}</div>
                  <div className="text-[11px] text-ink-subtle font-mono mt-1">{key}</div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    disabled={never}
                    value={item.retention_days ?? ""}
                    onChange={(event) =>
                      updatePolicy(item.id, {
                        retention_days: Math.max(1, Math.trunc(Number(event.target.value) || 1)),
                      })
                    }
                    className="w-24 bg-black/[0.04] border border-line rounded-xl px-3 py-2 disabled:opacity-40"
                  />
                  <span className="text-ink-muted">天</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={never}
                    onChange={(event) =>
                      updatePolicy(item.id, { retention_days: event.target.checked ? null : 7 })
                    }
                  />
                  永不过期
                </label>
              </div>
            );
          })}
        </div>
        <div className="p-5 border-t border-line flex justify-end">
          <button
            type="button"
            disabled={busy || !data}
            onClick={save}
            className="px-5 py-2.5 rounded-2xl bg-orange-700 text-white text-sm font-semibold disabled:opacity-50"
          >
            保存并重算
          </button>
        </div>
      </div>

      <div className="glass rounded-3xl p-5">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="font-semibold">手动执行</h2>
            <p className="text-xs text-ink-subtle mt-1">先试运行确认数量；正式清理会删除对象存储文件并清空媒体地址。</p>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(true)} className="px-4 py-2 rounded-xl border border-line text-sm disabled:opacity-50">
              试运行
            </button>
            <button disabled={busy} onClick={() => run(false)} className="px-4 py-2 rounded-xl bg-red-600/80 text-sm disabled:opacity-50 text-white">
              立即清理
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-ink-subtle">
              <tr className="border-b border-line">
                <th className="text-left py-2">时间</th>
                <th className="text-left">类型</th>
                <th className="text-left">状态</th>
                <th className="text-right">扫描</th>
                <th className="text-right">清理</th>
                <th className="text-right">失败</th>
              </tr>
            </thead>
            <tbody>
              {data?.runs.map((runItem) => (
                <tr key={runItem.id} className="border-b border-line text-ink-muted">
                  <td className="py-2">{new Date(runItem.started_at).toLocaleString()}</td>
                  <td>{runItem.dry_run ? "试运行" : "正式"}</td>
                  <td>{runItem.status}</td>
                  <td className="text-right">{runItem.scanned}</td>
                  <td className="text-right">{runItem.deleted}</td>
                  <td className="text-right">{runItem.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.runs.length === 0 && <p className="py-6 text-center text-ink-subtle">暂无执行记录</p>}
        </div>
      </div>
    </div>
  );
}
