"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";

/** 防 open redirect：只允许站内相对路径 */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/make";
  const path = raw.trim();
  if (!/^\/(?!\/)/.test(path)) return "/make";
  if (path.includes("://") || path.includes("\\") || path.length > 512) return "/make";
  return path;
}

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
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/turnstile")
      .then((r) => r.json())
      .then((data: { site_key?: string }) => {
        if (!cancelled && data.site_key) setSiteKey(data.site_key);
      })
      .catch(() => {
        /* widget stays hidden until key loads */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!turnstileToken) {
      setError("请先完成人机验证");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          "cf-turnstile-response": turnstileToken,
          turnstile_token: turnstileToken,
          accepted_terms: mode === "login" || accepted,
        }),
      });
      router.push(safeNextPath(params.get("next")));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "网络错误，请重试");
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full glass rounded-3xl p-8 modal-pop">
        <div className="flex justify-center mb-6">
          <BrandLogo />
        </div>

        <div className="flex mb-6 bg-black/40 rounded-2xl p-1">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError("");
                setTurnstileToken(null);
                setTurnstileReset((n) => n + 1);
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

          {siteKey ? (
            <TurnstileWidget
              siteKey={siteKey}
              onToken={setTurnstileToken}
              resetKey={`${mode}-${turnstileReset}`}
            />
          ) : (
            <p className="text-[10px] text-gray-500">加载人机验证…</p>
          )}

          {mode === "register" && (
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-gray-400">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-1 h-4 w-4 accent-violet-500"
                required
              />
              <span>
                我已阅读并同意
                <Link href="/terms" target="_blank" className="mx-1 text-violet-300 underline">用户条款</Link>
                与
                <Link href="/content-policy" target="_blank" className="mx-1 text-violet-300 underline">内容使用条款</Link>
              </span>
            </label>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !turnstileToken || !siteKey || (mode === "register" && !accepted)}
            className="w-full py-3.5 bg-white text-black font-bold rounded-2xl hover:bg-gray-100 disabled:opacity-50"
          >
            {busy ? "处理中..." : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>

        <p className="text-center text-xs leading-5 text-gray-500 mt-4">
          点击“注册”或“登录”，代表你已知悉
          <Link href="/terms" className="mx-1 text-gray-300 hover:text-white">用户条款</Link>
          及
          <Link href="/content-policy" className="mx-1 text-gray-300 hover:text-white">内容使用条款</Link>
          的内容。
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
