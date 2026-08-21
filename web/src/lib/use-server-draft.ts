"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";

/**
 * 服务端草稿：跟踪编辑内容，按开关决定什么时候真正落盘。
 *
 * 两种模式（自动保存是 VIP 功能）：
 * - **自动**：每分钟落一次盘，离开页面时补一次；挂载时直接从数据库恢复，
 *   所以换台设备登录也能接着写
 * - **手动**：编辑期间一个字都不往服务端写，只有用户按保存才落盘；
 *   本地 IndexedDB 缓存照旧兜着刷新
 *
 * 生成一旦开始就**完全停写**（paused）。理由：那一刻的编辑内容已经交给上游了，
 * 再往草稿里写会让「这条草稿对应哪次生成」变得说不清。只有生成失败、
 * 回到可编辑状态，保存才回来——那正是用户要改了重试的场景。
 *
 * 跟踪与落盘分开是这套逻辑的关键：track 只记「现在长什么样、脏了没有」，
 * 落盘由定时器、按钮、或离开页面触发。手动模式下 track 永远不会自己触发落盘。
 */

/** 自动保存的节奏。用户说的是每分钟 */
const AUTO_SAVE_INTERVAL_MS = 60_000;

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

/** 草稿引用的素材现状，服务端算好一起下发（见 lib/draft-media-status） */
export type DraftMediaStatus = {
  total: number;
  gone: Array<{ url: string; name: string; deleted_at: string | null; delete_reason: string | null }>;
  /** 仍存活素材里最早的到期时间，全永久保留时为 null */
  expires_at: string | null;
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
  media?: DraftMediaStatus;
};

export function useServerDraft(opts: {
  initialMode: string;
  /** ?draft=N 指定打开的草稿；给了就无条件恢复 */
  initialDraftId?: number | null;
  enabled: boolean;
  /** 自动保存开关（VIP）。关闭时只有显式保存才落盘 */
  autoSave: boolean;
  /** 生成执行中：完全停写 */
  paused: boolean;
  onRestore: (draft: ApiDraft) => void;
  localSavedAt: () => number;
  hasContent: (payload: DraftPayload) => boolean;
}) {
  const { initialMode, initialDraftId = null, enabled, autoSave, paused, onRestore, localSavedAt, hasContent } = opts;

  const [ready, setReady] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  /** 挂载时找到的、可供用户点「恢复」的那条草稿 */
  const [restorable, setRestorable] = useState<ApiDraft | null>(null);

  const draftIdRef = useRef<number | null>(null);
  const pendingRef = useRef<DraftPayload | null>(null);
  const inFlightRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  /** 自动恢复只做一次 */
  const autoRestoredRef = useRef(false);

  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const localSavedAtRef = useRef(localSavedAt);
  localSavedAtRef.current = localSavedAt;
  const hasContentRef = useRef(hasContent);
  hasContentRef.current = hasContent;

  /** 真正落盘。返回是否写成功。 */
  const flush = useCallback(async (opts?: { saveAs?: string }): Promise<boolean> => {
    if (pausedRef.current && !opts?.saveAs) return false;
    const payload = pendingRef.current;
    if (!payload) return false;
    if (inFlightRef.current) return false;

    const id = draftIdRef.current;
    const asNew = Boolean(opts?.saveAs);
    // 空编辑器不该在列表里留下一条空草稿
    if ((id === null || asNew) && !hasContentRef.current(payload)) return false;

    inFlightRef.current = true;
    setSaving(true);
    try {
      if (id === null || asNew) {
        const created = await api<ApiDraft>("/api/drafts", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            ...(asNew ? { save_as: true, title: opts?.saveAs } : {}),
          }),
        });
        // 另存为之后就在编辑那份副本上继续——这是 Save As 的通常语义
        draftIdRef.current = created.id;
        setDraftId(created.id);
      } else {
        await api<ApiDraft>(`/api/drafts/${id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      }
      setDirty(false);
      setLastSavedAt(Date.now());
      return true;
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  }, []);

  /** 记下当前长什么样。手动模式下到此为止，不会自己往服务端写。 */
  const track = useCallback((payload: DraftPayload) => {
    pendingRef.current = payload;
    /*
     * 空编辑器不算「有未保存的更改」——刚打开页面什么都没写就提示用户
     * 有东西没保存，是在制造焦虑。已经存过草稿的则另说：把内容删空
     * 本身就是一次需要保存的改动。
     */
    setDirty(draftIdRef.current !== null || hasContentRef.current(payload));
  }, []);

  /** 用户按下保存 */
  const saveNow = useCallback(() => flush(), [flush]);

  /** 另存为一份新的（VIP；服务端还会再判一次） */
  const saveAs = useCallback((title: string) => flush({ saveAs: title }), [flush]);

  // 挂载时找活动草稿
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
        if (!alive || !draft) return;

        draftIdRef.current = draft.id;
        setDraftId(draft.id);
        setRestorable(draft);

        /*
         * 明确点开的那一条（?draft=N）当场恢复，那是用户的明确意图。
         * 其余情况只挂成「可恢复」，恢复与否交给下面那个 effect——
         * 这里读不到可靠的 autoSave：它来自 /api/me，挂载这一刻多半还没到，
         * 而这个 effect 不会因为它变化而重跑。
         */
        if (initialDraftId) {
          autoRestoredRef.current = true;
          onRestoreRef.current(draft);
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

  /*
   * 自动保存开着时，把数据库里那份铺回界面——这正是「换台设备登录也能
   * 接着写」的意思。放在独立的 effect 里等 autoSave 真正到位再决定。
   *
   * 两道保险：本地那份更新时不动界面（断网时本地写成功、服务端写失败），
   * 用户已经开始写了也不动（用户资料加载慢时，覆盖掉手上的内容最糟）。
   */
  useEffect(() => {
    if (!enabled || initialDraftId || autoRestoredRef.current) return;
    if (!autoSave || !restorable) return;
    autoRestoredRef.current = true;
    if (dirtyRef.current) return;
    if (new Date(restorable.updated_at).getTime() <= localSavedAtRef.current()) return;
    onRestoreRef.current(restorable);
  }, [enabled, initialDraftId, autoSave, restorable]);

  // 自动保存的分钟节拍
  useEffect(() => {
    if (!ready || !enabled || !autoSave || paused) return;
    const timer = setInterval(() => {
      if (pendingRef.current && !inFlightRef.current) void flush().catch(() => null);
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ready, enabled, autoSave, paused, flush]);

  // 离开页面时把这一分钟内的编辑补上
  useEffect(() => {
    if (!ready || !enabled || !autoSave || paused) return;
    const onHide = () => void flush().catch(() => null);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [ready, enabled, autoSave, paused, flush]);

  /** 用户点「恢复上次编辑的草稿」 */
  const restore = useCallback(() => {
    if (restorable) onRestoreRef.current(restorable);
  }, [restorable]);

  /**
   * 提交生成后把任务单挂到草稿上，供草稿列表的对账使用。
   * 立刻发、不等节拍：紧接着用户很可能就关页面了。
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
    const id = draftIdRef.current;
    draftIdRef.current = null;
    setDraftId(null);
    setDirty(false);
    setRestorable(null);
    if (id === null) return;
    try {
      await api(`/api/drafts/${id}`, { method: "DELETE" });
    } catch (err) {
      console.warn("[draft] 删除服务端草稿失败：", err);
    }
  }, []);

  return {
    ready,
    draftId,
    dirty,
    saving,
    lastSavedAt,
    restorable,
    track,
    saveNow,
    saveAs,
    restore,
    discard,
    attachGeneration,
  };
}
