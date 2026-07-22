"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface ModUser {
  id: number;
  username: string;
  role: string;
  balance: number;
  disabled_at: string | null;
  created_at: string;
  generation_count: number;
  enabled: boolean;
}

export default function AdminModsPage() {
  const [mods, setMods] = useState<ModUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [username, setUsername] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ mods: ModUser[] }>("/api/admin/mods");
      setMods(data.mods);
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
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  async function grantMod(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    await action(
      () => api("/api/admin/mods", { method: "POST", body: JSON.stringify({ username: username.trim() }) }),
      `已将 ${username.trim()} 设为审核员`
    );
    setUsername("");
  }

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">审核员管理</h1>
      <p className="text-gray-400 text-sm mb-6">
        启用/停用审核员登录；停用后无法登录与调用 API。也可撤销审核员角色降为普通用户。
      </p>

      <form onSubmit={grantMod} className="glass rounded-3xl p-5 mb-6 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-400 block mb-1">将已有用户提升为审核员</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            className="w-full bg-[#111] border border-white/10 rounded-2xl px-4 py-2.5 text-sm outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={busy || !username.trim()}
          className="px-5 py-2.5 text-sm font-semibold bg-rose-600 hover:bg-rose-500 rounded-2xl disabled:opacity-50"
        >
          设为审核员
        </button>
      </form>

      {msg && <p className="mb-4 text-sm text-amber-300">{msg}</p>}

      <div className="glass rounded-3xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">用户名</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">作品数</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {mods.map((m) => (
              <tr
                key={m.id}
                className={`border-b border-white/5 hover:bg-white/[0.02] ${m.enabled ? "" : "opacity-60"}`}
              >
                <td className="px-4 py-3 font-mono text-gray-400">#{m.id}</td>
                <td className="px-4 py-3 font-medium">{m.username}</td>
                <td className="px-4 py-3">
                  {m.enabled ? (
                    <span className="text-xs px-2 py-0.5 bg-emerald-500/15 text-emerald-300 rounded-full">已启用</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-red-500/15 text-red-300 rounded-full">已停用</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono">{m.generation_count}</td>
                <td className="px-4 py-3 text-xs text-gray-500">
                  {new Date(m.created_at).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {m.enabled ? (
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`停用审核员「${m.username}」？停用后无法登录。`)) return;
                        void action(
                          () =>
                            api(`/api/admin/mods/${m.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ enabled: false }),
                            }),
                          `已停用 ${m.username}`
                        );
                      }}
                      className="text-xs px-3 py-1 bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 rounded-lg mr-2 disabled:opacity-50"
                    >
                      停用
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        action(
                          () =>
                            api(`/api/admin/mods/${m.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ enabled: true }),
                            }),
                          `已启用 ${m.username}`
                        )
                      }
                      className="text-xs px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 rounded-lg mr-2 disabled:opacity-50"
                    >
                      启用
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`撤销「${m.username}」的审核员角色，降为普通用户？`)) return;
                      void action(
                        () =>
                          api(`/api/admin/mods/${m.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ keep_role: false }),
                          }),
                        `已撤销 ${m.username} 的审核员角色`
                      );
                    }}
                    className="text-xs px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg disabled:opacity-50"
                  >
                    撤销角色
                  </button>
                </td>
              </tr>
            ))}
            {mods.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  暂无审核员。可在上方输入已有用户名进行提升。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
