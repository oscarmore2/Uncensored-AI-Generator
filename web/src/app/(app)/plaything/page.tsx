"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  InputMediaGoneDialog,
  RetryConfirmDialog,
  type ReuseMediaItem,
} from "@/components/InputMediaGoneDialog";
import { api, ApiError } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import type { PlaythingCategoryId, PlaythingMediaKind } from "@/lib/plaything-categories";
import { categoryMeta } from "@/lib/plaything-categories";
import { CategoryRail } from "@/components/plaything/CategoryRail";
import { ModelPicker } from "@/components/plaything/ModelPicker";
import {
  DynamicParamForm,
  defaultsFromProduct,
  buildFieldParams,
  mediaFieldKinds,
  mergeMediaUrlsIntoParams,
  releaseFormMedia,
  type DynamicFormState,
  type PromptOptimizeStyle,
} from "@/components/plaything/DynamicParamForm";
import { GenerateBar } from "@/components/plaything/GenerateBar";
import { MediaBrowser } from "@/components/plaything/MediaBrowser";
import {
  restorePendingMedia,
  toStoredMedia,
  uploadAllPending,
  uploadPendingMediaCached,
  type StoredMedia,
} from "@/lib/plaything-upload-client";
import { useDraft } from "@/lib/use-draft";
import type {
  Phase,
  PlaythingCategorySummary,
  PlaythingGen,
  PlaythingProduct,
} from "@/components/plaything/types";
import { useTranslations } from "next-intl";

type ReusePayload = {
  product_id: number;
  category: PlaythingCategoryId;
  prompt: string;
  negative_prompt: string;
  fields: Record<string, string>;
  media_fields: Record<string, string[]>;
  media: { usable_urls: string[] };
};

/** 刷新后要原样带回来的编辑内容；媒体存 File，靠 IndexedDB 落盘 */
type PlaythingDraft = {
  category: PlaythingCategoryId | null;
  selectedId: number | null;
  prompt: string;
  negativePrompt: string;
  fields: Record<string, string>;
  media: Record<string, StoredMedia[]>;
};

export default function PlaythingPage() {
  const t = useTranslations("Plaything");
  const { user, refreshUser, toast } = useApp();
  const router = useRouter();
  const [products, setProducts] = useState<PlaythingProduct[]>([]);
  const [categories, setCategories] = useState<PlaythingCategorySummary[]>([]);
  const [note, setNote] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [category, setCategory] = useState<PlaythingCategoryId | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<DynamicFormState>(defaultsFromProduct(null));
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<PlaythingGen[]>([]);
  const [browserSelectedId, setBrowserSelectedId] = useState<number | null>(null);
  const [quoteCost, setQuoteCost] = useState<number | null>(null);
  const [quoteSource, setQuoteSource] = useState<"wavespeed" | "fallback" | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [promptOptimizerEnabled, setPromptOptimizerEnabled] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const pollingRef = useRef(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PendingMedia.id → 已上传 URL；优化提示词时抢先传的参考图，真正提交生成时复用，不重复上传
  const uploadedUrlCache = useRef(new Map<string, string>());
  /**
   * 草稿里的表单内容先搁这儿：目录还没到时算不出该套用到哪个产品，
   * 等下面按 selected 重置表单的 effect 跑到对应产品时再顶上去。
   */
  const pendingDraftRef = useRef<PlaythingDraft | null>(null);
  const searchParams = useSearchParams();
  const reuseLoadedRef = useRef(false);
  /** 套用历史任务：目录还没到时先存着，等选中对应模型再套进表单 */
  const pendingReuseRef = useRef<ReusePayload | null>(null);
  const [reuseEpoch, setReuseEpoch] = useState(0);
  const [gone, setGone] = useState<{
    items: ReuseMediaItem[];
    unrecorded: boolean;
    go: (skipMedia: boolean) => void;
  } | null>(null);
  const [retryPrompt, setRetryPrompt] = useState(false);
  /** 草稿读回来后 +1，用来把上面的 ref 交给下面按产品重置表单的 effect 去消费 */
  const [draftEpoch, setDraftEpoch] = useState(0);

  const loadCatalog = useCallback(async () => {
    try {
      const data = await api<{
        products: PlaythingProduct[];
        categories: PlaythingCategorySummary[];
        note?: string;
      }>("/api/plaything/catalog");
      setProducts(data.products);
      setCategories(data.categories);
      setNote(data.note ?? "");
      setForbidden(false);
      setCategory((prev) => prev ?? data.categories[0]?.id ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setForbidden(true);
        return;
      }
      toast(e instanceof ApiError ? e.message : t("loadFailed"));
    }
  }, [t, toast]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api<PlaythingGen[]>("/api/plaything/generations"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadHistory();
    api<{ plaything_prompt_optimizer?: boolean }>("/api/features")
      .then((f) => setPromptOptimizerEnabled(Boolean(f.plaything_prompt_optimizer)))
      .catch(() => setPromptOptimizerEnabled(false));
  }, [loadCatalog, loadHistory]);

  /** ?reuse=<id>：从作品浏览器套用一条历史任务 */
  useEffect(() => {
    const reuseId = searchParams.get("reuse");
    if (!reuseId || reuseLoadedRef.current) return;
    reuseLoadedRef.current = true;
    const skipMedia = searchParams.get("nomedia") === "1";

    api<ReusePayload>(`/api/plaything/generations/${encodeURIComponent(reuseId)}/reuse`)
      .then((d) => {
        pendingReuseRef.current = skipMedia
          ? { ...d, media_fields: {}, media: { usable_urls: [] } }
          : d;
        setCategory(d.category);
        setSelectedId(d.product_id);
        // 分类/模型与当前一致时不会触发任何 state 变化，靠它把上面的 effect 再踢一次
        setReuseEpoch((e) => e + 1);
        toast(t("reuseApplied"));
      })
      .catch((e) =>
        toast(e instanceof ApiError && e.message ? e.message : t("reuseFailed"), true)
      );
  }, [searchParams, t, toast]);

  const categoryProducts = useMemo(() => {
    if (!category) return [] as PlaythingProduct[];
    return products.filter((p) => p.category === category);
  }, [products, category]);

  useEffect(() => {
    if (!category) return;
    const list = products.filter((p) => p.category === category);
    if (!list.length) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      return list[0].id;
    });
  }, [category, products]);

  const selected = useMemo(
    () => categoryProducts.find((p) => p.id === selectedId) ?? null,
    [categoryProducts, selectedId]
  );

  useEffect(() => {
    const reuse = pendingReuseRef.current;
    const useReuse = reuse != null && selected != null && reuse.product_id === selected.id;
    const draft = pendingDraftRef.current;
    const useDraftForm =
      !useReuse && draft != null && selected != null && draft.selectedId === selected.id;

    setForm((prev) => {
      releaseFormMedia(prev);
      if (useReuse && selected) {
        // 套用：以当前模型默认值打底，覆盖历史参数；媒体用已在对象存储里的 URL
        const base = defaultsFromProduct(selected);
        const fields = { ...base.fields };
        for (const [k, v] of Object.entries(reuse.fields ?? {})) {
          if (k in fields) fields[k] = v;
        }
        const usable = new Set(reuse.media.usable_urls);
        const mediaUrls: Record<string, string[]> = {};
        for (const [field, urls] of Object.entries(reuse.media_fields ?? {})) {
          const kept = urls.filter((u) => usable.has(u));
          if (kept.length) mediaUrls[field] = kept;
        }
        return {
          prompt: reuse.prompt,
          negativePrompt: reuse.negative_prompt,
          fields,
          mediaFiles: base.mediaFiles,
          mediaUrls,
        };
      }
      if (!useDraftForm) return defaultsFromProduct(selected);
      // 以当前产品的默认值打底，再盖上草稿：产品参数改过之后
      // 草稿里已消失的字段不会漏、多出来的字段也不会带进来
      const base = defaultsFromProduct(selected);
      const mediaFiles = { ...base.mediaFiles };
      for (const key of Object.keys(mediaFiles)) {
        mediaFiles[key] = restorePendingMedia(draft.media?.[key] ?? []);
      }
      const fields = { ...base.fields };
      for (const [k, v] of Object.entries(draft.fields ?? {})) {
        if (k in fields) fields[k] = v;
      }
      return { prompt: draft.prompt, negativePrompt: draft.negativePrompt, fields, mediaFiles };
    });

    if (useReuse || (pendingReuseRef.current && products.length > 0 && selected)) {
      pendingReuseRef.current = null;
      if (useReuse && searchParams.get("run") === "1") setRetryPrompt(true);
    }
    if (useDraftForm || (pendingDraftRef.current && products.length > 0 && selected)) {
      // 用掉了，或者草稿指向的产品已经下架 —— 两种情况都不该再等下去
      pendingDraftRef.current = null;
    }

    setQuoteCost(selected?.credit_cost ?? null);
    setQuoteSource(null);
    uploadedUrlCache.current.clear();
  }, [selected?.id, products.length, draftEpoch, reuseEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { save: saveDraft } = useDraft<PlaythingDraft>("plaything", (d) => {
    pendingDraftRef.current = d;
    if (d.category) setCategory(d.category);
    if (d.selectedId != null) setSelectedId(d.selectedId);
    // 草稿是异步读回来的，此时上面那个 effect 早就跑完了。若草稿里的
    // 分类/模型跟当前一致，不会有任何 state 变化，effect 也就不会重跑，
    // 于是 pendingDraftRef 永远消不掉、回写被一直挡住。用它显式再踢一次。
    setDraftEpoch((e) => e + 1);
  });

  useEffect(() => {
    // 草稿/套用还没落到具体产品上时别回写，否则会用空表单把它盖掉
    if (pendingDraftRef.current || pendingReuseRef.current) return;
    const media: Record<string, StoredMedia[]> = {};
    for (const [field, items] of Object.entries(form.mediaFiles)) {
      media[field] = toStoredMedia(items);
    }
    saveDraft({
      category,
      selectedId,
      prompt: form.prompt,
      negativePrompt: form.negativePrompt,
      fields: form.fields,
      media,
    });
  }, [saveDraft, category, selectedId, form]);

  const mediaKind: PlaythingMediaKind =
    selected?.media_kind ?? (category ? categoryMeta(category).mediaKind : "image");

  const filteredHistory = useMemo(() => {
    if (!category) return history;
    return history.filter((g) => g.category === category);
  }, [history, category]);

  useEffect(() => {
    const firstOk = filteredHistory.find(
      (g) => g.status === "succeeded" && g.result_urls?.length
    );
    setBrowserSelectedId(firstOk?.id ?? null);
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  // 参数变化 → debounce 询价（媒体用占位，不先上传）
  useEffect(() => {
    if (!selected) return;
    const payload = buildFieldParams(selected, form, (key, values) => t(key, values));
    if (!payload.ok) {
      setQuoteCost(selected.credit_cost);
      setQuoteSource(null);
      return;
    }
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(() => {
      setQuoting(true);
      void api<{
        cost: number;
        source: "wavespeed" | "fallback";
      }>("/api/plaything/quote", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          inputs: {
            ...payload.params,
            ...(payload.prompt ? { prompt: payload.prompt } : {}),
          },
        }),
      })
        .then((q) => {
          setQuoteCost(q.cost);
          setQuoteSource(q.source);
        })
        .catch(() => {
          setQuoteCost(selected.credit_cost);
          setQuoteSource("fallback");
        })
        .finally(() => setQuoting(false));
    }, 400);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [form.prompt, form.negativePrompt, form.fields, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * WaveSpeed 提示词优化（仅玩物专区）。若已选了参考图，抢先上传一次拿公开 URL 一并送审优化，
   * 上传结果写进 uploadedUrlCache，真正提交生成时 uploadAllPending 会命中缓存不再重复上传。
   */
  async function optimizePromptText(style: PromptOptimizeStyle) {
    if (!selected || optimizing) return;
    const text = form.prompt.trim();
    if (!text) return;

    setOptimizing(true);
    try {
      const fieldKinds = mediaFieldKinds(selected);
      let imageUrl: string | undefined;
      for (const [field, items] of Object.entries(form.mediaFiles)) {
        const item = items[0];
        if (item?.kind === "image") {
          imageUrl = await uploadPendingMediaCached({
            item,
            productId: selected.id,
            field,
            fieldKinds,
            cache: uploadedUrlCache.current,
          });
          break;
        }
      }

      const mode = selected.media_kind === "video" ? "video" : "image";
      // 模型 schema 里有 negative_prompt 才要反向，否则生成了也没地方填
      const wantNegative = Boolean(selected.param_schema?.properties?.negative_prompt);
      const res = await api<{ prompt: string; negative_prompt: string | null }>(
        "/api/plaything/prompt-optimize",
        {
          method: "POST",
          body: JSON.stringify({
            text,
            image_url: imageUrl,
            mode,
            style,
            want_negative: wantNegative,
            ...(wantNegative && form.negativePrompt.trim()
              ? { negative_text: form.negativePrompt.trim() }
              : {}),
          }),
        }
      );
      setForm((prev) => ({
        ...prev,
        prompt: res.prompt,
        ...(res.negative_prompt ? { negativePrompt: res.negative_prompt } : {}),
      }));
      toast(t("optimizeDone"));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("optimizeFailed"), true);
    } finally {
      setOptimizing(false);
    }
  }

  /**
   * 套用 / 重新生成：先确认当初的输入媒体还在不在，
   * 不在就先把文件名、上传时间、删除时间、删除原因讲清楚，用户确认后只填参数。
   */
  const reuseGeneration = useCallback(
    async (genId: number, run: boolean) => {
      const go = (skipMedia: boolean) => {
        const q = new URLSearchParams({ reuse: String(genId) });
        if (run) q.set("run", "1");
        if (skipMedia) q.set("nomedia", "1");
        reuseLoadedRef.current = false;
        router.replace(`/plaything?${q.toString()}`);
      };
      try {
        const info = await api<{
          input_unrecorded: boolean;
          media_fields: Record<string, string[]>;
          media: { all_available: boolean; items: ReuseMediaItem[] };
        }>(`/api/plaything/generations/${genId}/reuse`);

        const hadMedia =
          Object.keys(info.media_fields).length > 0 || info.media.items.length > 0;
        if (hadMedia && !info.media.all_available) {
          setGone({ items: info.media.items, unrecorded: info.input_unrecorded, go });
          return;
        }
        go(false);
      } catch (e) {
        toast(e instanceof ApiError && e.message ? e.message : t("reuseFailed"), true);
      }
    },
    [router, t, toast]
  );

  async function pollUntilDone(id: number) {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setPhase("polling");
    try {
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const g = await api<PlaythingGen>(`/api/plaything/generations/${id}`);
        setProgress(g.progress);
        setHistory((prev) => {
          const rest = prev.filter((x) => x.id !== g.id);
          return [g, ...rest];
        });
        if (g.status === "succeeded") {
          setPhase("idle");
          setBrowserSelectedId(g.id);
          await refreshUser();
          await loadHistory();
          toast(t("completed"));
          return;
        }
        if (g.status === "failed") {
          setPhase("idle");
          await refreshUser();
          await loadHistory();
          toast(g.error || t("failedRefunded"));
          return;
        }
      }
      toast(t("stillProcessing"));
      setPhase("idle");
    } finally {
      pollingRef.current = false;
    }
  }

  async function submit() {
    if (!selected || phase !== "idle") return;
    const payload = buildFieldParams(selected, form, (key, values) => t(key, values));
    if (!payload.ok) {
      toast(payload.error);
      return;
    }
    // 余额不足在上传媒体之前就拦住：否则文件已进 OSS、服务端才拒绝，留下孤儿文件
    const cost = quoteCost ?? selected.credit_cost;
    const balance = user?.balance ?? 0;
    if (balance < cost) {
      toast(t("insufficientCredits", { cost, balance }), true);
      router.push("/pricing");
      return;
    }

    setPhase("submitting");
    setProgress(0);
    try {
      // 点击生成后再上传媒体
      const uploaded = await uploadAllPending({
        productId: selected.id,
        mediaByField: payload.mediaFiles,
        fieldKinds: mediaFieldKinds(selected),
        cache: uploadedUrlCache.current,
      });
      // 套用历史任务带回来的媒体已经在对象存储里，不重复上传，直接并进去
      const mediaUrls: Record<string, string[]> = { ...uploaded };
      for (const [field, urls] of Object.entries(form.mediaUrls ?? {})) {
        if (!urls.length) continue;
        mediaUrls[field] = [...(mediaUrls[field] ?? []), ...urls];
      }
      const params = mergeMediaUrlsIntoParams(selected, payload.params, mediaUrls);

      const gen = await api<PlaythingGen>("/api/plaything/generations", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          prompt: payload.prompt,
          params,
        }),
      });
      await refreshUser();
      setProgress(gen.progress);
      setHistory((prev) => [gen, ...prev.filter((x) => x.id !== gen.id)]);
      void pollUntilDone(gen.id);
    } catch (e) {
      setPhase("idle");
      if (e instanceof ApiError && e.code === "INSUFFICIENT_CREDITS") {
        toast(t("insufficient"));
        router.push("/pricing");
      } else {
        toast(e instanceof Error ? e.message : e instanceof ApiError ? e.message : t("submitFailed"));
      }
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center px-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-3">{t("title")}</h1>
        <p className="text-ink-muted text-sm">
          {t("noAccess")}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter mb-1">{t("title")}</h1>
          <p className="text-ink-muted text-sm">
            {t("subtitle")}
            {note ? ` · ${note}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 min-h-[calc(100vh-10rem)]">
        <CategoryRail categories={categories} active={category} onChange={setCategory} />

        <aside className="lg:w-[340px] shrink-0 flex flex-col gap-4 glass rounded-3xl p-4 sm:p-5">
          {categoryProducts.length === 0 ? (
            <p className="text-sm text-ink-subtle py-8 text-center">{t("emptyCategory")}</p>
          ) : (
            <>
              <ModelPicker
                products={categoryProducts}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              {selected && (
                <>
                  <div className="flex-1 overflow-y-auto overscroll-contain max-h-[50vh] lg:max-h-none pr-1">
                    <DynamicParamForm
                      product={selected}
                      value={form}
                      onChange={setForm}
                      onError={(msg) => toast(msg)}
                      promptOptimizerEnabled={promptOptimizerEnabled}
                      optimizing={optimizing}
                      onOptimizePrompt={(style) => void optimizePromptText(style)}
                    />
                  </div>
                  <GenerateBar
                    creditCost={quoteCost ?? selected.credit_cost}
                    balance={user?.balance ?? 0}
                    phase={phase}
                    progress={progress}
                    quoteSource={quoteSource}
                    quoting={quoting}
                    onGenerate={() => void submit()}
                    onTopUp={() => router.push("/pricing")}
                  />
                </>
              )}
            </>
          )}
        </aside>

        <section className="flex-1 min-w-0 glass rounded-3xl p-4 sm:p-6">
          <MediaBrowser
            mediaKind={mediaKind}
            items={filteredHistory}
            selectedId={browserSelectedId}
            onSelect={setBrowserSelectedId}
            onReuse={(id, run) => void reuseGeneration(id, run)}
          />
        </section>
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
      {retryPrompt && (
        <RetryConfirmDialog
          cost={quoteCost ?? selected?.credit_cost ?? 0}
          balance={user?.balance ?? 0}
          onCancel={() => setRetryPrompt(false)}
          onConfirm={() => {
            setRetryPrompt(false);
            void submit();
          }}
        />
      )}
    </div>
  );
}
