"use client";

import { useEffect } from "react";

/**
 * 会话保活：只要人在操作，登录态的倒计时就重新开始。
 *
 * 续签本身在 middleware 里做——任何带会话的请求都会把过期时间往后推。
 * 但「在编辑器里写 prompt」这件事一个请求都不发（手动保存模式下尤其如此），
 * 服务端看不见你在忙，于是写着写着就掉线了。这里补上那一拍。
 *
 * 必须**由交互驱动**，不能是无脑定时器：否则一个开着没人管的标签页就能把
 * 会话永远续下去，闲置过期形同虚设。没人动 = 不发请求 = 该过期就过期。
 */

/** 多久回头看一次「这段时间有没有人在操作」 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/* 覆盖打字、点按、滚动。光标在文本框里连打半小时也只算 keydown，够了 */
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

export function SessionKeepAlive({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;

    let interacted = false;
    const mark = () => {
      interacted = true;
    };
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, mark, { passive: true });
    }

    const timer = window.setInterval(() => {
      if (!interacted) return;
      // 页面在后台不算「在用」，而且移动端后台请求本来就常被系统掐掉
      if (document.visibilityState !== "visible") return;
      interacted = false;
      // 续签是 middleware 的事，这里只管把请求发出去；失败也无所谓，下一拍再来
      void fetch("/api/me/heartbeat", { cache: "no-store" }).catch(() => {});
    }, CHECK_INTERVAL_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, mark);
      window.clearInterval(timer);
    };
  }, [active]);

  return null;
}
