"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface ModPublicWork {
  id: number;
  title: string | null;
  mode: string;
  prompt: string;
  media_url: string;
  thumb_url: string | null;
  source: string;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  is_adult: boolean;
}

interface ListResp {
  total: number;
  page: number;
  limit: number;
  works: ModPublicWork[];
}

const EMPTY_FORM = {
  media_url: "",
  prompt: "",
  mode: "txt2img",
  negative_prompt: "",
  source_zen_job_id: "",
  title: "",
  is_adult: false,
};

export default function ModPublicPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>(`/api/mod/public-works?page=${page}&limit=30`));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const togglePublish = (w: ModPublicWork) =>
    action(
      () =>
        api(`/api/mod/public-works/${w.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_published: !w.is_published }),
        }),
      w.is_published ? `#${w.id} 已下架` : `#${w.id} 已上架`
    );

  const changeSort = (w: ModPublicWork, delta: number) =>
    action(
      () =>
        api(`/api/mod/public-works/${w.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order: w.sort_order + delta }),
        }),
      `#${w.id} 排序已调整为 ${w.sort_order + delta}`
    );

  const toggleAdult = (w: ModPublicWork) =>
    action(
      () =>
        api(`/api/mod/public-works/${w.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_adult: !w.is_adult }),
        }),
      `#${w.id} 已${w.is_adult ? "移除" : "加上"} 18+ 标记`
    );

  const remove = (w: ModPublicWork) => {
    if (!window.confirm(`确定从公共库删除 #${w.id}？此操作不可恢复（不影响原用户作品）。`)) return;
    void action(() => api(`/api/mod/public-works/${w.id}`, { method: "DELETE" }), `#${w.id} 已删除`);
  };

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      await api("/api/mod/public-works/import", {
        method: "POST",
        body: JSON.stringify({
          media_url: form.media_url.trim() || undefined,
          prompt: form.prompt.trim(),
          mode: form.mode,
          negative_prompt: form.negative_prompt.trim() || undefined,
          source_zen_job_id: form.source_zen_job_id.trim() || undefined,
          title: form.title.trim() || undefined,
          is_adult: form.is_adult,
        }),
      });
      setForm(EMPTY_FORM);
      setFormOpen(false);
    }, "导入成功");
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">公共库</h1>
          <p className="text-gray-400 text-sm">上下架、排序、删除；支持 Zen/外部内容采集导入</p>
        </div>
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl"
        >
          <i className="fas fa-file-import mr-2" />
          采集导入
        </button>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      {formOpen && (
        <form onSubmit={submitImport} className="glass rounded-3xl p-6 mb-8 modal-pop">
          <h2 className="font-bold mb-4">采集导入公共库</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">提示词 Prompt *</label>
              <textarea
                required
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                className="w-full bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl p-3 text-sm outline-none min-h-20"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">媒体 URL（与 Zen Job ID 二选一）</label>
              <input
                value={form.media_url}
                onChange={(e) => setForm({ ...form, media_url: e.target.value })}
                placeholder="https://..."
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={form.is_adult}
                onChange={(e) => setForm({ ...form, is_adult: e.target.checked })}
              />
              标记为 18+ 成人作品
            </label>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Zen Job ID（自动拉取结果 URL）</label>
              <input
                value={form.source_zen_job_id}
                onChange={(e) => setForm({ ...form, source_zen_job_id: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">模式 *</label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm"
              >
                <option value="txt2img">txt2img</option>
                <option value="txt2vid">txt2vid</option>
                <option value="img2img">img2img</option>
                <option value="img2vid">img2vid</option>
                <option value="undress">undress</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">标题（选填）</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-400 block mb-1">负面提示词（选填）</label>
              <input
                value={form.negative_prompt}
                onChange={(e) => setForm({ ...form, negative_prompt: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
            >
              {busy ? "导入中..." : "确认导入"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-6 py-2.5 text-sm border border-white/10 rounded-2xl hover:bg-white/5"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data?.works.map((w) => (
          <div key={w.id} className={`glass rounded-3xl overflow-hidden ${w.is_published ? "" : "opacity-60"}`}>
            <div className="relative aspect-video bg-[#111]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.thumb_url ?? w.media_url} alt={`#${w.id}`} className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute top-3 right-3 flex gap-1">
                <span className="text-[10px] px-2 py-0.5 bg-black/70 rounded-full">{w.source}</span>
                {w.is_adult && <span className="text-[10px] px-2 py-0.5 bg-red-600 rounded-full font-bold">18+</span>}
                {!w.is_published && <span className="text-[10px] px-2 py-0.5 bg-gray-600/90 rounded-full">未上架</span>}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-gray-400 font-mono mb-2">
                #{w.id} · {w.mode} · 排序 {w.sort_order}
              </div>
              <p className="text-xs text-gray-300 line-clamp-2 mb-3">{w.title ?? w.prompt}</p>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => togglePublish(w)}
                  disabled={busy}
                  className={`flex-1 py-1.5 border rounded-xl disabled:opacity-50 ${
                    w.is_published
                      ? "bg-white/5 hover:bg-white/10 border-white/10"
                      : "bg-emerald-600/20 hover:bg-emerald-600/40 border-emerald-500/30 text-emerald-300"
                  }`}
                >
                  {w.is_published ? "下架" : "上架"}
                </button>
                <button
                  onClick={() => changeSort(w, -1)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
                  title="排序值 -1（越小越靠前）"
                >
                  <i className="fas fa-arrow-up" />
                </button>
                <button
                  onClick={() => toggleAdult(w)}
                  disabled={busy}
                  className={`px-3 py-1.5 border rounded-xl disabled:opacity-50 ${
                    w.is_adult ? "border-red-500/40 bg-red-500/15 text-red-300" : "border-white/10 bg-white/5"
                  }`}
                  title="切换 18+ 标记"
                >
                  18+
                </button>
                <button
                  onClick={() => changeSort(w, 1)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
                  title="排序值 +1"
                >
                  <i className="fas fa-arrow-down" />
                </button>
                <button
                  onClick={() => remove(w)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 rounded-xl disabled:opacity-50"
                >
                  <i className="fas fa-trash" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {data && data.works.length === 0 && (
        <div className="glass rounded-3xl p-16 text-center text-gray-500">公共库为空，去「作品审核」曝光作品或使用采集导入</div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex justify-center gap-x-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-5 py-2 border border-white/10 rounded-2xl hover:bg-white/5 disabled:opacity-40"
          >
            上一页
          </button>
          <span className="px-4 py-2 text-gray-400">
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-5 py-2 border border-white/10 rounded-2xl hover:bg-white/5 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
