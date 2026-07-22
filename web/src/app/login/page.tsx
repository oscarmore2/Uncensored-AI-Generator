"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(
    params.get("mode") === "register" ? "register" : "login"
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const next = params.get("next");
      router.push(next && next.startsWith("/") ? next : "/make");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full glass rounded-3xl p-8 modal-pop">
        <div className="flex items-center justify-center gap-x-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-pink-700 flex items-center justify-center">
            <span className="font-black text-white text-3xl tracking-tighter">AV</span>
          </div>
          <span className="font-bold text-3xl tracking-tight">AVClubs</span>
        </div>

        <div className="flex mb-6 bg-black/40 rounded-2xl p-1">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
                mode === m ? "bg-rose-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm text-gray-300">用户名</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full mt-1 bg-[#111] border border-white/10 focus:border-rose-500 rounded-2xl px-4 py-3 outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-gray-300">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 8 : 1}
              className="w-full mt-1 bg-[#111] border border-white/10 focus:border-rose-500 rounded-2xl px-4 py-3 outline-none"
            />
            {mode === "register" && <p className="text-[10px] text-gray-500 mt-1">至少 8 个字符</p>}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 bg-white text-black font-bold rounded-2xl hover:bg-gray-100 disabled:opacity-50"
          >
            {busy ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-4">
          会话使用 HttpOnly Cookie，浏览器脚本无法读取
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
