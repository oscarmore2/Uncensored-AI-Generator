"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import { InputMediaGoneDialog, type ReuseMediaItem } from "@/components/InputMediaGoneDialog";
import { useTranslations } from "next-intl";

/**
 * 「套用参数 / 重新生成」两个按钮 + 输入媒体已清理时的说明弹框。
 *
 * 作品弹窗和作品整页都要这套动作，逻辑抽在这里而不是各写一份——
 * 这段真正的复杂度不在按钮上，而在跳转前先问一遍当初的参考图还在不在：
 * 还在就带过去，不在就把「哪个文件、何时传、何时删、为何删」讲清楚，
 * 用户确认后只恢复参数，媒体留给他自己重新上传。
 */
export function WorkReuseActions({
  generationId,
  onNavigate,
  className = "",
}: {
  generationId: number;
  /** 弹窗场景下用来先关掉弹窗，避免跳转过程中弹窗还压在上面 */
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useTranslations("History");
  const { toast } = useApp();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gone, setGone] = useState<{
    items: ReuseMediaItem[];
    unrecorded: boolean;
    go: (skipMedia: boolean) => void;
  } | null>(null);

  const openInMake = useCallback(
    async (run: boolean) => {
      if (checking) return;
      setChecking(true);
      const go = (skipMedia: boolean) => {
        const q = new URLSearchParams({ reuse: String(generationId) });
        if (run) q.set("run", "1");
        if (skipMedia) q.set("nomedia", "1");
        onNavigate?.();
        router.push(`/make?${q.toString()}`);
      };
      try {
        const info = await api<{
          needs_image: boolean;
          input_unrecorded: boolean;
          media: { all_available: boolean; items: ReuseMediaItem[] };
        }>(`/api/generations/${generationId}/reuse`);

        const missing = info.needs_image && (!info.media.all_available || info.input_unrecorded);
        if (missing) {
          setGone({ items: info.media.items, unrecorded: info.input_unrecorded, go });
          return;
        }
        go(false);
      } catch (err) {
        // 服务端已经把原因带回来了（如数据库缺列），直接显示比一句「失败」有用
        toast(err instanceof ApiError && err.message ? err.message : t("reuseFailed"), true);
      } finally {
        setChecking(false);
      }
    },
    [checking, generationId, onNavigate, router, t, toast]
  );

  /*
   * 存为模板的第二个入口（需求 10）：已完成的作品也能存。
   * 只把作品 id 发上去，参数由服务端从这条生成记录里翻出来——
   * 前端手上只有展示用的字段，凑不出完整的表单快照。
   */
  const saveAsTemplate = useCallback(async () => {
    if (saving) return;
    const name = window.prompt(t("saveTemplatePrompt"))?.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api("/api/templates", {
        method: "POST",
        body: JSON.stringify({ name, from_generation_id: generationId }),
      });
      toast(t("saveTemplateOk"));
    } catch (err) {
      toast(err instanceof ApiError && err.message ? err.message : t("saveTemplateFailed"), true);
    } finally {
      setSaving(false);
    }
  }, [generationId, saving, t, toast]);

  return (
    <>
      <div className={`flex gap-3 ${className}`}>
        <button
          onClick={() => void openInMake(false)}
          disabled={checking}
          className="flex-1 py-3 bg-black/[0.03] border border-line rounded-2xl flex items-center justify-center gap-x-2 disabled:opacity-40"
        >
          <i className="fas fa-rotate-left" /> {t("reuse")}
        </button>
        <button
          onClick={() => void openInMake(true)}
          disabled={checking}
          className="flex-1 py-3 bg-orange-700 hover:bg-orange-600 rounded-2xl font-semibold flex items-center justify-center gap-x-2 disabled:opacity-40 text-white"
        >
          <i className="fas fa-rotate-right" /> {t("retry")}
        </button>
        <button
          onClick={() => void saveAsTemplate()}
          disabled={saving}
          aria-label={t("saveTemplate")}
          title={t("saveTemplate")}
          className="flex w-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-black/[0.03] disabled:opacity-40"
        >
          <i className={`fas ${saving ? "fa-spinner fa-spin" : "fa-bookmark"}`} />
        </button>
      </div>
      {gone && (
        <InputMediaGoneDialog
          items={gone.items}
          unrecorded={gone.unrecorded}
          onCancel={() => setGone(null)}
          onConfirm={() => {
            const go = gone.go;
            setGone(null);
            go(true);
          }}
        />
      )}
    </>
  );
}
