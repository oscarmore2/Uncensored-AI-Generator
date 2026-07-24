"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useApp } from "@/components/AppContext";
import type { PlaythingCategoryId, PlaythingMediaKind } from "@/lib/plaything-categories";
import { categoryMeta } from "@/lib/plaything-categories";
import { CategoryRail } from "@/components/plaything/CategoryRail";
import { ModelPicker } from "@/components/plaything/ModelPicker";
import {
  DynamicParamForm,
  defaultsFromProduct,
  buildSubmitPayload,
  type DynamicFormState,
} from "@/components/plaything/DynamicParamForm";
import { GenerateBar } from "@/components/plaything/GenerateBar";
import { MediaBrowser } from "@/components/plaything/MediaBrowser";
import type {
  Phase,
  PlaythingCategorySummary,
  PlaythingGen,
  PlaythingProduct,
} from "@/components/plaything/types";

export default function PlaythingPage() {
  const { user, refreshUser, toast, setRechargeOpen } = useApp();
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
  const pollingRef = useRef(false);

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
      toast(e instanceof ApiError ? e.message : "加载失败");
    }
  }, [toast]);

  const loadHistory = useCallback(async () => {
    try {
      const gens = await api<PlaythingGen[]>("/api/plaything/generations");
      setHistory(gens);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    void loadHistory();
  }, [loadCatalog, loadHistory]);

  const categoryProducts = useMemo(() => {
    if (!category) return [] as PlaythingProduct[];
    return products.filter((p) => p.category === category);
  }, [products, category]);

  // 切品类：选推荐优先模型并重置表单
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
    setForm(defaultsFromProduct(selected));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mediaKind: PlaythingMediaKind = selected?.media_kind
    ?? (category ? categoryMeta(category).mediaKind : "image");

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

  function selectCategory(id: PlaythingCategoryId) {
    setCategory(id);
  }

  function selectModel(id: number) {
    setSelectedId(id);
  }

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
          toast("生成完成");
          return;
        }
        if (g.status === "failed") {
          setPhase("idle");
          await refreshUser();
          await loadHistory();
          toast(g.error || "生成失败，点数已退回");
          return;
        }
      }
      toast("仍在处理中，可稍后在右侧媒体库查看");
      setPhase("idle");
    } finally {
      pollingRef.current = false;
    }
  }

  async function submit() {
    if (!selected || phase !== "idle") return;
    const payload = buildSubmitPayload(selected, form);
    if (payload.needsMedia) {
      toast("该模型需要上传参考媒体");
      return;
    }
    const reqPrompt = selected.param_schema?.required?.includes("prompt");
    if ((reqPrompt || !payload.image_base64) && !form.prompt.trim() && !payload.image_base64) {
      // soft: allow image-only tools
      if (!Object.values(form.mediaFiles).some(Boolean)) {
        toast("请填写提示词或上传参考媒体");
        return;
      }
    }
    if ((user?.balance ?? 0) < selected.credit_cost) {
      toast("点数不足");
      setRechargeOpen(true);
      return;
    }

    setPhase("submitting");
    setProgress(0);
    try {
      const gen = await api<PlaythingGen>("/api/plaything/generations", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          prompt: payload.prompt,
          params: payload.params,
          image_base64: payload.image_base64,
        }),
      });
      await refreshUser();
      setProgress(gen.progress);
      setHistory((prev) => [gen, ...prev.filter((x) => x.id !== gen.id)]);
      void pollUntilDone(gen.id);
    } catch (e) {
      setPhase("idle");
      toast(e instanceof ApiError ? e.message : "提交失败");
    }
  }

  if (forbidden) {
    return (
      <div className="max-w-xl mx-auto py-24 text-center px-6">
        <h1 className="text-3xl font-bold tracking-tighter mb-3">玩物专区</h1>
        <p className="text-gray-400 text-sm">
          暂无访问权限。请联系管理员开通，或开通带玩物权限的 VIP 等级。
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tighter mb-1">玩物专区</h1>
          <p className="text-gray-400 text-sm">
            WaveSpeed 工作台 · 按品类创作
            {note ? ` · ${note}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 lg:gap-5 min-h-[calc(100vh-10rem)]">
        <CategoryRail
          categories={categories}
          active={category}
          onChange={selectCategory}
        />

        <aside className="lg:w-[340px] shrink-0 flex flex-col gap-4 glass rounded-3xl p-4 sm:p-5">
          {categoryProducts.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">该品类暂无上架模型</p>
          ) : (
            <>
              <ModelPicker
                products={categoryProducts}
                selectedId={selectedId}
                onSelect={selectModel}
              />
              {selected && (
                <>
                  <div className="flex-1 overflow-y-auto max-h-[50vh] lg:max-h-none pr-1">
                    <DynamicParamForm product={selected} value={form} onChange={setForm} />
                  </div>
                  <GenerateBar
                    creditCost={selected.credit_cost}
                    balance={user?.balance ?? 0}
                    phase={phase}
                    progress={progress}
                    onGenerate={() => void submit()}
                    onTopUp={() => setRechargeOpen(true)}
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
          />
        </section>
      </div>
    </div>
  );
}
