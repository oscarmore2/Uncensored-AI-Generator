"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";

/**
 * 服务端草稿的自动回写。
 *
 * 与本地那层（lib/use-draft，IndexedDB）的分工：
 * - 本地是「这一秒的编辑」，防抖 400ms，断网也能写，管刷新不丢
 * - 服务端是「这条草稿」，防抖 1.5s，管换设备、换浏览器还能接着写
 *
 * 两层都在，所以挂载时会各恢复一次。谁说了算按写入时间比——
 * 断网时本地写成功而服务端写失败，服务端那份就是旧的，直接采纳会把
 * 用户离线时的编辑抹掉。
 *
 * 一个编辑器对应一条草稿，切模式不换草稿、只更新它的 mode 字段：
 * 「正在编辑的这个窗口」本身就是那条草稿，中途换个模式不该凭空多出一条。
 */

const SAVE_DEBOUNCE_MS = 1500;

export type DraftPayload = {
  mode: string;
  tier?: string;
  spicy?: boolean;
  product_id?: number | null;
  provider_model_id?: string | null;
  prompt?: string;
  negative_prompt?: string | null;
  snapshot?: string;
};

export type ApiDraft = {
  id: number;
  mode: string;
  tier: string;
  spicy: boolean;
  product_id: number | null;
  provider_model_id: string | null;
  title: string | null;
  prompt: string;
  negative_prompt: string | null;
  snapshot: string;
  generation_id: number | null;
  created_at: string;
  updated_at: string;
};

export function useServerDraft(opts: {
  /** 挂载时按这个模式找活动草稿 */
  initialMode: string;
  /**
   * 指定要打开的草稿（URL 带 ?draft=N）。给了就取这一条，而且**无条件**恢复：
   * 用户是明确点开这条草稿的，不该再跟本地那份比新旧。
   */
  initialDraftId?: number | null;
  /** 为 false 时不恢复也不保存（如 URL 带了 reuse 参数） */
  enabled: boolean;
  /** 服务端那份更新时调用 */
  onRestore: (draft: ApiDraft) => void;
  /** 本地那份的写入时间（毫秒）；没有传 0 */
  localSavedAt: () => number;
  /** 有没有值得保存的内容；空编辑器不该在列表里留下空草稿 */
  hasContent: (payload: DraftPayload) => boolean;
}) {
  const { initialMode, initialDraftId = null, enabled, onRestore, localSavedAt, hasContent } = opts;

  const [ready, setReady] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);

  const draftIdRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<DraftPayload | null>(null);
  /* 同一时刻只允许一个写请求在飞：防抖之外还要防「上一个还没回来又发一个」，
   * 两个请求乱序回来会导致新建出两条草稿。 */
  const inFlightRef = useRef(false);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const localSavedAtRef = useRef(localSavedAt);
  localSavedAtRef.current = localSavedAt;
  const hasContentRef = useRef(hasContent);
  hasContentRef.current = hasContent;

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const payload = pendingRef.current;
    if (!payload || inFlightRef.current) return;
    const id = draftIdRef.current;
    // 还没建过、且没内容：不建空草稿
    if (id === null && !hasContentRef.current(payload)) return;

    pendingRef.current = null;
    inFlightRef.current = true;
    try {
      if (id === null) {
        const created = await api<ApiDraft>("/api/drafts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        draftIdRef.current = created.id;
        setDraftId(created.id);
      } else {
        await api<ApiDraft>(`/api/drafts/${id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
    } catch (err) {
      // 草稿保存失败不该打断创作：本地那层还在兜着，下一次编辑会再试
      console.warn("[draft] 服务端保存失败：", err);
    } finally {
      inFlightRef.current = false;
      // 保存期间又有新编辑进来，补一次
      if (pendingRef.current) void flush();
    }
  }, []);

  // 挂载时取该模式的活动草稿
  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const draft = initialDraftId
          ? await api<ApiDraft>(`/api/drafts/${initialDraftId}`)
          : (
              await api<{ draft: ApiDraft | null }>(
                `/api/drafts?active=1&mode=${encodeURIComponent(initialMode)}`
              )
            ).draft;
        if (!alive) return;
        if (draft) {
          draftIdRef.current = draft.id;
          setDraftId(draft.id);
          // 明确点开的那条一律恢复；自动找到的活动草稿才比新旧
          const serverAt = new Date(draft.updated_at).getTime();
          if (initialDraftId || serverAt > localSavedAtRef.current()) {
            onRestoreRef.current(draft);
          }
        }
      } catch (err) {
        console.warn("[draft] 读取服务端草稿失败：", err);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, initialMode, initialDraftId]);

  // 关标签页时把防抖里还没发出去的补上
  useEffect(() => {
    if (!ready || !enabled) return;
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [ready, enabled, flush]);

  const save = useCallback(
    (payload: DraftPayload) => {
      if (!ready || !enabled) return;
      pendingRef.current = payload;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [ready, enabled, flush]
  );

  /**
   * 提交生成后把任务单挂到草稿上，供需求 8 的对账使用。
   *
   * 立刻发、不走防抖：紧接着用户很可能就关掉页面了，挂不上这条草稿就成了
   * 没人认领的孤儿——列表里永远躺着，而作品其实已经生成好。
   */
  const attachGeneration = useCallback(async (generationId: number) => {
    const id = draftIdRef.current;
    if (id === null) return;
    try {
      await api(`/api/drafts/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ generation_id: generationId }),
      });
    } catch (err) {
      console.warn("[draft] 挂任务单失败：", err);
    }
  }, []);

  /** 生成成功后调用：这条草稿的使命结束了 */
  const discard = useCallback(async () => {
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = draftIdRef.current;
    draftIdRef.current = null;
    setDraftId(null);
    if (id === null) return;
    try {
      await api(`/api/drafts/${id}`, { method: "DELETE" });
    } catch (err) {
      console.warn("[draft] 删除服务端草稿失败：", err);
    }
  }, []);

  return { ready, draftId, save, discard, attachGeneration };
}
