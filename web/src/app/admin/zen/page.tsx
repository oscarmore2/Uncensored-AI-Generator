"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface ZenAcc {
  id: number;
  label: string;
  api_key_mask: string;
  is_active: boolean;
  last_known_balance: number | null;
  last_balance_synced_at: string | null;
  task_count: number;
  zen_credits_consumed: number;
  created_at: string;
}

interface ListResp {
  accounts: ZenAcc[];
  env_fallback: { configured: boolean; api_key_mask: string | null; in_use: boolean };
  note: string;
}

interface TaskRow {
  id: number;
  zen_job_id: string | null;
  username: string;
  mode: string;
  status: string;
  progress: number;
  cost: number;
  zen_credits_cost: number | null;
  prompt: string;
  created_at: string;
}

const EMPTY = { label: "", api_key: "", activate: true };

export default function AdminZenAccountsPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [tasksFor, setTasksFor] = useState<number | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/zen-accounts"));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, []);

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
      if (e instanceof Error && e.message === "__warning_already_set__") {
        await load();
      } else {
        setMsg(e instanceof ApiError ? e.message : "操作失败");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      const resp = await api<{ ok: boolean; warning?: string }>("/api/admin/zen-accounts", {
        method: "POST",
        body: JSON.stringify({
          label: form.label.trim(),
          api_key: form.api_key.trim(),
          activate: form.activate,
          sync_balance: true,
        }),
      });
      setForm(EMPTY);
      setFormOpen(false);
      if (resp.warning) {
        setMsg(
          `账户已保存，但余额同步失败（常见于 Railway 被 Cloudflare 拦截）。请配置 ZEN_BASE_URL 为 Worker 代理后再点「同步余额」。详情：${resp.warning}`
        );
        throw new Error("__warning_already_set__");
      }
    }, "Zen 账户已添加并同步余额");
  }

  async function loadTasks(id: number) {
    setTasksFor(id);
    try {
      const resp = await api<{ tasks: TaskRow[] }>(`/api/admin/zen-accounts/${id}?limit=20`);
      setTasks(resp.tasks);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载任务失败");
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">Zen Creator 账户</h1>
          <p className="text-gray-400 text-sm">
            多 API Key 管理 · 真实余额同步 · 本地任务与 Zen taskId 一一对应
          </p>
          <p className="text-amber-400/90 text-xs mt-2 max-w-xl">
            若出现 Cloudflare「Just a moment」403：不是 Key 无效，是机房 IP 被拦。请部署{" "}
            <code className="text-gray-300">scripts/zen-proxy-worker.js</code> 并把 Railway 的{" "}
            <code className="text-gray-300">ZEN_BASE_URL</code> 指向 Worker。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() =>
              action(
                () =>
                  api("/api/admin/zen-accounts", {
                    method: "PATCH",
                    body: JSON.stringify({ action: "sync_all_balances" }),
                  }),
                "已刷新全部账户余额"
              )
            }
            className="px-4 py-2.5 text-sm border border-white/10 rounded-2xl hover:bg-white/5 disabled:opacity-50"
          >
            <i className="fas fa-sync mr-2" />
            同步余额
          </button>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl"
          >
            <i className="fas fa-plus mr-2" />
            添加账户
          </button>
        </div>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      {data?.note && (
        <div className="glass rounded-3xl p-4 mb-6 text-xs text-gray-400">
          <i className="fas fa-circle-info mr-2 text-rose-400" />
          {data.note} 预留回调：<code className="text-gray-300">POST /api/zen/webhook</code>
        </div>
      )}

      {data?.env_fallback && (
        <div
          className={`glass rounded-3xl p-4 mb-6 text-sm ${
            data.env_fallback.in_use ? "border border-amber-500/30" : ""
          }`}
        >
          <div className="font-semibold mb-1">.env 兜底</div>
          {data.env_fallback.configured ? (
            <p className="text-gray-400 text-xs">
              Key {data.env_fallback.api_key_mask}
              {data.env_fallback.in_use
                ? " · 当前无激活 DB 账户，生成走 .env"
                : " · 有激活 DB 账户时不会使用 .env"}
            </p>
          ) : (
            <p className="text-gray-500 text-xs">未配置。添加并激活一个账户后即可调用 Zen。</p>
          )}
        </div>
      )}

      {formOpen && (
        <form onSubmit={submitCreate} className="glass rounded-3xl p-6 mb-8 modal-pop">
          <h2 className="font-bold mb-4">添加 Zen 账户</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">备注名 *</label>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="例如：主账户"
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">API Key *（zc_live_…）</label>
              <input
                required
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                className="w-full bg-[#111] border border-white/10 rounded-2xl px-3 py-2.5 text-sm outline-none font-mono"
              />
            </div>
            <label className="flex items-center gap-x-2 text-sm text-gray-300 cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              <span>添加后立即激活（会停用其他账户）；添加时会调用 Zen /balance 校验</span>
            </label>
          </div>
          <div className="mt-5 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="px-6 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
            >
              {busy ? "验证中..." : "确认添加"}
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

      <div className="space-y-3">
        {data?.accounts.map((a) => (
          <div
            key={a.id}
            className={`glass rounded-3xl p-5 ${a.is_active ? "ring-1 ring-emerald-500/40" : ""}`}
          >
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{a.label}</span>
                  {a.is_active ? (
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">
                      激活中
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 bg-white/10 text-gray-400 rounded-full">未激活</span>
                  )}
                </div>
                <div className="text-xs font-mono text-gray-400">Key: {a.api_key_mask}</div>
                <div className="mt-2 flex flex-wrap gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">余额</span>
                    <div className="font-mono text-lg">
                      {a.last_known_balance !== null ? a.last_known_balance : "—"}
                    </div>
                    {a.last_balance_synced_at && (
                      <div className="text-[10px] text-gray-500">
                        {new Date(a.last_balance_synced_at).toLocaleString("zh-CN")}
                      </div>
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">任务数</span>
                    <div className="font-mono text-lg">{a.task_count}</div>
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">估算消耗</span>
                    <div className="font-mono text-lg">{a.zen_credits_consumed}</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {!a.is_active && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      action(
                        () =>
                          api(`/api/admin/zen-accounts/${a.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ activate: true, sync_balance: true }),
                          }),
                        `已激活「${a.label}」`
                      )
                    }
                    className="px-4 py-2 text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-xl disabled:opacity-50"
                  >
                    激活
                  </button>
                )}
                {a.is_active && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      action(
                        () =>
                          api(`/api/admin/zen-accounts/${a.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ activate: false }),
                          }),
                        `已停用「${a.label}」`
                      )
                    }
                    className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
                  >
                    停用
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    action(
                      () =>
                        api(`/api/admin/zen-accounts/${a.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ sync_balance: true }),
                        }),
                      `已同步「${a.label}」余额`
                    )
                  }
                  className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl disabled:opacity-50"
                >
                  刷新余额
                </button>
                <button
                  onClick={() => void loadTasks(a.id)}
                  className="px-4 py-2 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl"
                >
                  查看任务
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`确定删除「${a.label}」？关联任务保留。`)) return;
                    void action(
                      () => api(`/api/admin/zen-accounts/${a.id}`, { method: "DELETE" }),
                      `已删除「${a.label}」`
                    );
                  }}
                  className="px-4 py-2 text-xs bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 rounded-xl disabled:opacity-50"
                >
                  删除
                </button>
              </div>
            </div>

            {tasksFor === a.id && (
              <div className="mt-4 border-t border-white/10 pt-4 overflow-x-auto">
                <div className="text-xs text-gray-400 mb-2">最近任务（本地 ID ↔ Zen taskId）</div>
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1 pr-3">本地#</th>
                      <th className="py-1 pr-3">Zen taskId</th>
                      <th className="py-1 pr-3">用户</th>
                      <th className="py-1 pr-3">状态</th>
                      <th className="py-1 pr-3">进度</th>
                      <th className="py-1 pr-3">消耗</th>
                      <th className="py-1">提示词</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id} className="border-t border-white/5">
                        <td className="py-2 pr-3 font-mono">#{t.id}</td>
                        <td className="py-2 pr-3 font-mono text-gray-400" title={t.zen_job_id ?? ""}>
                          {t.zen_job_id ? `${t.zen_job_id.slice(0, 8)}…` : "—"}
                        </td>
                        <td className="py-2 pr-3">{t.username}</td>
                        <td className="py-2 pr-3">{t.status}</td>
                        <td className="py-2 pr-3 font-mono">{t.progress}%</td>
                        <td className="py-2 pr-3 font-mono">{t.zen_credits_cost ?? "—"}</td>
                        <td className="py-2 text-gray-400 max-w-xs truncate">{t.prompt}</td>
                      </tr>
                    ))}
                    {tasks.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-4 text-center text-gray-500">
                          该账户尚无任务
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        {data && data.accounts.length === 0 && (
          <div className="glass rounded-3xl p-12 text-center text-gray-500">
            尚未添加 Zen 账户。可添加后激活，或使用 .env 的 ZEN_API_KEY。
          </div>
        )}
      </div>
    </div>
  );
}
