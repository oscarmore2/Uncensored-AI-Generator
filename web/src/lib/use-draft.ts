"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppContext";
import {
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftGuard,
  type DraftScope,
} from "./draft-store";

const SAVE_DEBOUNCE_MS = 400;

/**
 * 把一页的编辑状态挂到本地草稿上：挂载时恢复，之后防抖回写。
 *
 * `ready` 之前一律不写盘——否则组件初始的空表单会在草稿读回来之前
 * 就把它覆盖掉，刷新等于清空。
 */
export function useDraft<T>(
  scope: DraftScope,
  onRestore: (payload: T) => void,
  opts?: {
    /** 配额写满时的降级版本（一般是去掉媒体只留文本） */
    stripMedia?: (payload: T) => T;
    /** 为 false 时跳过恢复，直接进入可写状态（如 URL 带了 remix 参数） */
    enabled?: boolean;
  }
) {
  const { user } = useApp();
  const ownerKey = user ? String(user.id) : null;
  const bootId = user?.server_boot_id ?? null;
  const enabled = opts?.enabled ?? true;

  const [ready, setReady] = useState(false);
  const guardRef = useRef<DraftGuard | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<T | null>(null);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const stripRef = useRef(opts?.stripMedia);
  stripRef.current = opts?.stripMedia;

  const flush = useCallback(() => {
    const guard = guardRef.current;
    const payload = pendingRef.current;
    if (!guard || payload == null) return;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void saveDraft(scope, guard, payload, stripRef.current);
  }, [scope]);

  useEffect(() => {
    if (!ownerKey || !bootId) return;
    const guard: DraftGuard = { ownerKey, bootId };
    guardRef.current = guard;

    if (!enabled) {
      setReady(true);
      return;
    }

    let alive = true;
    void loadDraft<T>(scope, guard).then((payload) => {
      if (!alive) return;
      if (payload) onRestoreRef.current(payload);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [scope, ownerKey, bootId, enabled]);

  // 关标签页 / 切后台时把防抖里还没落盘的最后一次编辑补上
  useEffect(() => {
    if (!ready) return;
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [ready, flush]);

  const save = useCallback(
    (payload: T) => {
      if (!ready || !guardRef.current) return;
      pendingRef.current = payload;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [ready, flush]
  );

  const discard = useCallback(() => {
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void clearDraft(scope);
  }, [scope]);

  return { ready, save, discard };
}
