"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, MODES, modeCost, type ApiGeneration } from "@/lib/client";
import { useApp } from "@/components/AppContext";

const EXAMPLE_PROMPTS = [
  "一个穿着黑色丝袜和吊带睡裙的亚洲美女，躺在豪华酒店床上，柔和暖光，写实摄影风格，高细节，8k",
  "赛博朋克风格的性感女性，霓虹灯下的雨夜街道，湿发，皮衣，电影光影",
  "两个亲密拥抱的年轻情侣，柔焦背景，浪漫氛围，自然光，写实",
];

type Phase = "idle" | "submitting" | "polling";

function MakePageInner() {
  const { user, refreshUser, toast, setRechargeOpen } = useApp();
  // 引流页「同款参数创作」通过 query 带入 prompt/negative/mode
  const searchParams = useSearchParams();
  const [modeIdx, setModeIdx] = useState(() => {
    const idx = MODES.findIndex((m) => m.key === searchParams.get("mode"));
    return idx >= 0 ? idx : 0;
  });
  const [prompt, setPrompt] = useState(() => searchParams.get("prompt") ?? "");
  const [negative, setNegative] = useState(
    () => searchParams.get("negative") ?? "低质量, 模糊, 变形, 文字, watermark, 丑陋"
  );
  const [ratio, setRatio] = useState("1:1");
  const [quality, setQuality] = useState("quality");
  const [style, setStyle] = useState("realistic");
  const [batch, setBatch] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ id: number; urls: string[] } | null>(null);
  const pollingRef = useRef(false);

  const cost = modeCost(modeIdx, batch);
  const needsImage = modeIdx === 2 || modeIdx === 3;

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast("图片不能超过 10MB", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setImageBase64(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function startGeneration() {
    if (!prompt.trim()) return toast("请输入提示词", true);
    if (phase !== "idle") return;

    setPhase("submitting");
    setResult(null);
    setProgress(0);
    try {
      const gen = await api<ApiGeneration>("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          mode: MODES[modeIdx].key,
          prompt: prompt.trim(),
          negative_prompt: negative,
          ratio,
          style,
          quality,
          batch,
          image_base64: imageBase64,
        }),
      });
      toast(`生成任务已提交！ID: ${gen.id}，正在后台处理...`);
      await refreshUser();
      setPhase("polling");
      void poll(gen.id);
    } catch (e) {
      toast(`生成失败: ${e instanceof Error ? e.message : e}`, true);
      setPhase("idle");
    }
  }

  async function poll(genId: number) {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 4500));
        try {
          const data = await api<{
            status: string;
            progress?: number;
            result_urls: string[] | null;
            error?: string | null;
          }>(`/api/generations/${genId}/status`);
          if (typeof data.progress === "number") setProgress(data.progress);
          if ((data.status === "succeeded" || data.status === "partial") && data.result_urls?.length) {
            setResult({ id: genId, urls: data.result_urls });
            setProgress(100);
            await refreshUser();
            return;
          }
          if (data.status === "failed") {
            toast(data.error ? `生成失败: ${data.error}` : "生成失败，点数已退回", true);
            await refreshUser();
            return;
          }
        } catch {
          // 网络抖动，继续轮询
        }
      }
      toast("生成超时，请在「我的作品」中查看进度", true);
    } finally {
      pollingRef.current = false;
      setPhase("idle");
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter">创作中心</h1>
          <p className="text-gray-400 mt-1">同源 API • Cookie 会话</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {MODES.map((m, i) => (
          <button
            key={m.key}
            onClick={() => setModeIdx(i)}
            className={`mode-tab flex-1 md:flex-none px-6 py-3 text-sm font-semibold rounded-3xl flex items-center justify-center gap-x-2 border ${
              i === modeIdx ? "active border-rose-600" : "bg-white/5 border-white/10"
            }`}
          >
            <i className={`fas ${m.icon}`} />
            <span>{m.label}</span>
            <span className="text-[10px] px-1.5 py-px bg-white/10 rounded">{m.cost}点</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 glass rounded-3xl p-6">
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-300">提示词 (Prompt)</label>
              <button
                onClick={() =>
                  setPrompt(EXAMPLE_PROMPTS[Math.floor(Math.random() * EXAMPLE_PROMPTS.length)])
                }
                className="text-xs flex items-center gap-x-1 text-rose-400 hover:text-rose-300"
              >
                <i className="fas fa-magic" /> <span>随机示例</span>
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="prompt-box w-full bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl p-4 text-sm placeholder:text-gray-500 outline-none"
              placeholder="描述你想要的场景，例如：一个穿着黑色蕾丝的亚洲美女躺在床上，柔和灯光，写实风格，高细节..."
            />
          </div>

          <div className="mb-5">
            <label className="text-sm font-semibold text-gray-300 mb-2 block">负面提示词 (Negative)</label>
            <input
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              className="w-full bg-[#111] border border-white/10 focus:border-rose-500/60 rounded-2xl px-4 py-3 text-sm outline-none"
            />
          </div>

          {needsImage && (
            <div className="mb-5">
              <label className="text-sm font-semibold text-gray-300 mb-2 block">参考图片</label>
              <label className="block border-2 border-dashed border-white/20 hover:border-rose-500/40 rounded-3xl p-8 text-center cursor-pointer transition-colors">
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                {imageBase64 ? (
                  <div>
                    {/* base64 预览图，无需 next/image 优化 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageBase64} alt="预览" className="mx-auto max-h-48 rounded-2xl shadow-xl mb-3" />
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setImageBase64(null);
                      }}
                      className="text-xs px-4 py-1 bg-white/10 hover:bg-white/20 rounded-full"
                    >
                      移除图片
                    </button>
                  </div>
                ) : (
                  <div>
                    <i className="fas fa-cloud-upload-alt text-4xl text-gray-500 mb-3" />
                    <p className="text-sm">点击上传参考图片</p>
                    <p className="text-xs text-gray-500 mt-1">支持 JPG / PNG，最大 10MB</p>
                  </div>
                )}
              </label>
            </div>
          )}

          <div className="mb-2">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-300">高级设置</label>
              <button
                onClick={() => setAdvancedOpen(!advancedOpen)}
                className="text-xs text-gray-400 flex items-center gap-1"
              >
                <span>{advancedOpen ? "收起" : "展开"}</span>
                <i className={`fas fa-chevron-${advancedOpen ? "up" : "down"} text-xs`} />
              </button>
            </div>

            {advancedOpen && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">宽高比</label>
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                    className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="1:1">1:1 正方形</option>
                    <option value="16:9">16:9 横向</option>
                    <option value="9:16">9:16 纵向</option>
                    <option value="4:3">4:3</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">质量模式</label>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="fast">快速 (低成本)</option>
                    <option value="quality">高质量</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">风格</label>
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="realistic">写实风格</option>
                    <option value="asian">亚洲写实</option>
                    <option value="anime">动漫风格</option>
                    <option value="cinematic">电影感</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">生成数量</label>
                  <select
                    value={batch}
                    onChange={(e) => setBatch(Number(e.target.value))}
                    className="w-full bg-[#111] border border-white/10 rounded-xl px-3 py-2 text-sm"
                  >
                    <option value={1}>1 张/段</option>
                    <option value={2}>2 张/段</option>
                    <option value={4}>4 张/段 (+50%点数)</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 glass rounded-3xl p-6 flex flex-col">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-xs text-gray-400">预计消耗</div>
                <div className="flex items-baseline">
                  <span className="text-5xl font-bold font-mono text-rose-400">{cost}</span>
                  <span className="ml-2 text-lg text-gray-400">点数</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">当前余额</div>
                <div className="flex items-center justify-end gap-x-1">
                  <i className="fas fa-coins text-amber-400" />
                  <span className="font-mono text-2xl font-semibold stat-number">{user?.balance ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="bg-black/40 rounded-2xl p-4 text-xs space-y-2 mb-6">
              <div className="flex justify-between">
                <span className="text-gray-400">模型</span>
                <span className="font-mono text-emerald-400">Zen SDXL_NSFW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">预计时间</span> <span>8-90 秒</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">宽高比</span> <span>{ratio}</span>
              </div>
            </div>
          </div>

          <button
            onClick={startGeneration}
            disabled={phase !== "idle"}
            className="generate-btn w-full py-4 text-white font-bold text-lg rounded-3xl flex items-center justify-center gap-x-3 shadow-xl active:scale-[0.985] disabled:opacity-60"
          >
            {phase === "idle" ? (
              <>
                <i className="fas fa-magic" /> <span>立即生成</span>
              </>
            ) : (
              <>
                <i className="fas fa-spinner fa-spin" />
                <span>{phase === "submitting" ? "提交中..." : "生成中..."}</span>
              </>
            )}
          </button>

          <div className="mt-3 text-center">
            <button
              onClick={() => setRechargeOpen(true)}
              className="text-xs text-gray-400 hover:text-rose-400 flex items-center justify-center gap-x-1 mx-auto"
            >
              <i className="fas fa-coins fa-sm" /> <span>点数不足？立即充值</span>
            </button>
          </div>
        </div>
      </div>

      {phase === "polling" && !result && (
        <div className="mt-8 glass rounded-3xl p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 border-4 border-rose-500/30 border-t-rose-500 rounded-full animate-spin" />
          <div className="text-sm mb-3">正在生成中… {progress}%</div>
          <div className="max-w-md mx-auto h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-rose-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(2, progress)}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-8">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-x-2">
              <i className="fas fa-check-circle text-emerald-400" /> 生成完成
            </h3>
            <button
              onClick={() => setResult(null)}
              className="text-xs px-3 py-1 bg-white/5 rounded-full"
            >
              关闭
            </button>
          </div>
          <div className="glass rounded-3xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.urls[0]} className="w-full max-h-[420px] object-cover" alt="AI Generated" />
            <div className="p-5 flex gap-3">
              <a
                href={result.urls[0]}
                download={`avclubs_${Date.now()}.jpg`}
                target="_blank"
                rel="noopener"
                className="flex-1 py-2.5 text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl flex items-center justify-center gap-x-2"
              >
                <i className="fas fa-download" /> <span>下载</span>
              </a>
              <a
                href="/history"
                className="flex-1 py-2.5 text-sm font-semibold bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-center leading-8"
              >
                查看全部作品
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MakePage() {
  return (
    <Suspense>
      <MakePageInner />
    </Suspense>
  );
}
