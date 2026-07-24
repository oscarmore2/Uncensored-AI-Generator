"use client";

import { useEffect, useRef, useCallback } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "flexible" | "compact";
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";

type Props = {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** 切换登录/注册时重置 */
  resetKey?: string;
};

/**
 * Cloudflare Turnstile 组件：进入页面即渲染（触发 Bot Challenge），
 * 通过后拿到 token，提交登录/注册时一并带上。
 */
export function TurnstileWidget({ siteKey, onToken, resetKey }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        /* ignore */
      }
      widgetIdRef.current = null;
    }
    containerRef.current.innerHTML = "";
    onTokenRef.current(null);

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "dark",
      size: "flexible",
      callback: (token) => onTokenRef.current(token),
      "error-callback": () => onTokenRef.current(null),
      "expired-callback": () => onTokenRef.current(null),
      "timeout-callback": () => onTokenRef.current(null),
    });
  }, [siteKey]);

  useEffect(() => {
    let cancelled = false;

    function ensureScript() {
      if (window.turnstile) {
        if (!cancelled) renderWidget();
        return;
      }
      const existing = document.getElementById(SCRIPT_ID);
      if (existing) {
        window.onTurnstileLoad = () => {
          if (!cancelled) renderWidget();
        };
        return;
      }
      window.onTurnstileLoad = () => {
        if (!cancelled) renderWidget();
      };
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    ensureScript();

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget, resetKey]);

  return (
    <div className="space-y-1">
      <div ref={containerRef} className="cf-turnstile min-h-[65px]" />
      <p className="text-[10px] text-gray-500">由 Cloudflare 提供人机验证保护</p>
    </div>
  );
}
