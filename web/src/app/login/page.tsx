"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { TurnstileWidget } from "@/components/TurnstileWidget";
import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/** 防 open redirect：只允许站内相对路径 */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/make";
  const path = raw.trim();
  if (!/^\/(?!\/)/.test(path)) return "/make";
  if (path.includes("://") || path.includes("\\") || path.length > 512) return "/make";
  return path;
}

function LoginForm() {
  const t = useTranslations("Login");
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(
    params.get("mode") === "register" ? "register" : "login"
  );
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [providers, setProviders] = useState({ google: false, facebook: false });
  const [verificationEmail, setVerificationEmail] = useState("");
  const [devVerificationUrl, setDevVerificationUrl] = useState("");
  const [resendMessage, setResendMessage] = useState("");

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
    fetch("/api/auth/oauth/providers")
      .then((r) => r.json())
      .then((data: { google?: boolean; facebook?: boolean }) => {
        if (!cancelled) {
          setProviders({
            google: Boolean(data.google),
            facebook: Boolean(data.facebook),
          });
        }
      })
      .catch(() => {
        /* social buttons stay hidden */
      });
    const oauthError = params.get("oauth_error");
    const verifyError = params.get("verify_error");
    const oauthErrorKeys = new Set([
      "invalid_state",
      "not_configured",
      "verified_email_required",
      "email_already_registered",
      "account_disabled",
      "access_denied",
      "provider_failed",
    ]);
    if (oauthError) {
      const key = oauthErrorKeys.has(oauthError) ? oauthError : "provider_failed";
      setError(
        t(
          `oauthErrors.${key}` as
            | "oauthErrors.invalid_state"
            | "oauthErrors.not_configured"
            | "oauthErrors.verified_email_required"
            | "oauthErrors.email_already_registered"
            | "oauthErrors.account_disabled"
            | "oauthErrors.access_denied"
            | "oauthErrors.provider_failed"
        )
      );
    }
    else if (verifyError) setError(t("verificationInvalid"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!turnstileToken) {
      setError(t("captchaRequired"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        verification_required?: boolean;
        email?: string;
        devVerificationUrl?: string;
      }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          ...(mode === "register" ? { email: email.trim() } : {}),
          password,
          "cf-turnstile-response": turnstileToken,
          turnstile_token: turnstileToken,
          accepted_terms: mode === "login" || accepted,
        }),
      });
      if (mode === "register" && result.verification_required) {
        setVerificationEmail(result.email ?? email.trim());
        setDevVerificationUrl(result.devVerificationUrl ?? "");
        return;
      }
      router.push(safeNextPath(params.get("next")));
      router.refresh();
    } catch (err) {
      if (
        err instanceof ApiError &&
        ["EMAIL_ALREADY_PENDING", "EMAIL_SEND_FAILED"].includes(err.code ?? "")
      ) {
        setVerificationEmail(email.trim());
      }
      if (
        err instanceof ApiError &&
        err.code === "EMAIL_NOT_VERIFIED" &&
        username.includes("@")
      ) {
        setVerificationEmail(username.trim().toLowerCase());
      }
      const errorKeys: Record<string, "rateLimited" | "credentialsRequired" | "invalidCredentials" | "accountDisabled" | "invalidRegistration" | "identityUnavailable" | "emailNotVerified" | "emailServiceUnavailable"> = {
        RATE_LIMITED: "rateLimited",
        CREDENTIALS_REQUIRED: "credentialsRequired",
        INVALID_CREDENTIALS: "invalidCredentials",
        ACCOUNT_DISABLED: "accountDisabled",
        INVALID_REGISTRATION: "invalidRegistration",
        USERNAME_UNAVAILABLE: "identityUnavailable",
        IDENTITY_UNAVAILABLE: "identityUnavailable",
        EMAIL_NOT_VERIFIED: "emailNotVerified",
        EMAIL_SERVICE_UNAVAILABLE: "emailServiceUnavailable",
      };
      setError(
        err instanceof ApiError && err.code && errorKeys[err.code]
          ? t(errorKeys[err.code])
          : err instanceof ApiError
            ? err.message
            : t("networkError")
      );
      setTurnstileToken(null);
      setTurnstileReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    if (!verificationEmail || busy) return;
    setBusy(true);
    setResendMessage("");
    try {
      const result = await api<{ message: string; dev_verification_url?: string }>(
        "/api/auth/resend-verification",
        {
          method: "POST",
          body: JSON.stringify({ email: verificationEmail }),
        }
      );
      setResendMessage(t("verificationSent"));
      if (result.dev_verification_url) setDevVerificationUrl(result.dev_verification_url);
    } catch (reason) {
      setResendMessage(reason instanceof ApiError ? reason.message : t("networkError"));
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
        <div className="mb-5 flex justify-center">
          <LanguageSwitcher compact />
        </div>

        {verificationEmail ? (
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6 text-center">
            <i className="fas fa-envelope-circle-check text-3xl text-emerald-700" />
            <h1 className="mt-3 text-xl font-bold">{t("checkEmailTitle")}</h1>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {t("checkEmailBody", { email: verificationEmail })}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void resendVerification()}
              className="mt-5 rounded-2xl border border-line px-5 py-2.5 text-sm font-semibold hover:bg-black/[0.04] disabled:opacity-50"
            >
              {busy ? t("processing") : t("resendVerification")}
            </button>
            {resendMessage && <p className="mt-3 text-xs text-ink-muted">{resendMessage}</p>}
            {devVerificationUrl && (
              <a href={devVerificationUrl} className="mt-3 block text-xs text-teal-700 underline">
                {t("demoVerifyLink")}
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                setVerificationEmail("");
                setMode("login");
                setError("");
              }}
              className="mt-4 block w-full text-xs text-ink-subtle hover:text-ink-muted"
            >
              {t("backToLogin")}
            </button>
          </div>
        ) : (
          <>
        <div className="flex mb-6 bg-black/[0.04] rounded-2xl p-1">
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
                mode === m ? "bg-orange-700 text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {m === "login" ? t("login") : t("register")}
            </button>
          ))}
        </div>

        {(providers.google || providers.facebook) && (
          <div className="mb-5 grid gap-3">
            {providers.google && (
              <a
                href={`/api/auth/oauth/google?next=${encodeURIComponent(safeNextPath(params.get("next")))}`}
                className="flex items-center justify-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 font-semibold text-black hover:bg-gray-100"
              >
                <span className="text-lg font-black text-blue-700">G</span>
                {t("continueGoogle")}
              </a>
            )}
            {providers.facebook && (
              <a
                href={`/api/auth/oauth/facebook?next=${encodeURIComponent(safeNextPath(params.get("next")))}`}
                className="flex items-center justify-center gap-3 rounded-2xl bg-[#1877F2] px-4 py-3 font-semibold text-ink hover:bg-[#166fe5]"
              >
                <i className="fab fa-facebook text-lg" />
                {t("continueFacebook")}
              </a>
            )}
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-ink-subtle">
              <span className="h-px flex-1 bg-black/[0.06]" />
              {t("orPassword")}
              <span className="h-px flex-1 bg-black/[0.06]" />
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-sm text-ink-muted">
              {mode === "login" ? t("usernameOrEmail") : t("username")}
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full mt-1 bg-surface border border-line focus:border-orange-500 rounded-2xl px-4 py-3 outline-none"
            />
          </div>
          {mode === "register" && (
            <div>
              <label className="text-sm text-ink-muted">{t("email")}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                maxLength={254}
                className="w-full mt-1 bg-surface border border-line focus:border-orange-500 rounded-2xl px-4 py-3 outline-none"
              />
              <p className="mt-1 text-[10px] text-ink-subtle">{t("emailHint")}</p>
            </div>
          )}
          <div>
            <label className="text-sm text-ink-muted">{t("password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 8 : 1}
              className="w-full mt-1 bg-surface border border-line focus:border-orange-500 rounded-2xl px-4 py-3 outline-none"
            />
            {mode === "register" && <p className="text-[10px] text-ink-subtle mt-1">{t("passwordHint")}</p>}
          </div>

          {siteKey ? (
            <TurnstileWidget
              siteKey={siteKey}
              onToken={setTurnstileToken}
              resetKey={`${mode}-${turnstileReset}`}
            />
          ) : (
            <p className="text-[10px] text-ink-subtle">{t("captchaLoading")}</p>
          )}

          {mode === "register" && (
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-5 text-ink-muted">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-1 h-4 w-4 accent-teal-500"
                required
              />
              <span>
                {t("agreePrefix")}
                <Link href="/terms" target="_blank" className="mx-1 text-teal-700 underline">{t("terms")}</Link>
                {t("and")}
                <Link href="/content-policy" target="_blank" className="mx-1 text-teal-700 underline">{t("contentPolicy")}</Link>
              </span>
            </label>
          )}

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={busy || !turnstileToken || !siteKey || (mode === "register" && !accepted)}
            className="w-full py-3.5 bg-orange-700 text-white font-bold rounded-2xl hover:bg-orange-700 disabled:opacity-50"
          >
            {busy ? t("processing") : mode === "login" ? t("login") : t("registerAndLogin")}
          </button>
        </form>

        <p className="text-center text-xs leading-5 text-ink-subtle mt-4">
          {t("noticePrefix")}
          <Link href="/terms" className="mx-1 text-ink-muted hover:text-ink">{t("terms")}</Link>
          {t("noticeMiddle")}
          <Link href="/content-policy" className="mx-1 text-ink-muted hover:text-ink">{t("contentPolicy")}</Link>
          {t("noticeSuffix")}
        </p>
        <p className="mt-2 text-center text-[10px] leading-4 text-ink-subtle">
          {t("geoNotice")}
        </p>
          </>
        )}
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
