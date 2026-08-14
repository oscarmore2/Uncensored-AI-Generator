"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";

interface OssAcc {
  id: number;
  label: string;
  provider: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_key_mask: string;
  public_base_url: string | null;
  path_prefix: string;
  mirror_results: boolean;
  force_path_style: boolean;
  is_active: boolean;
}

interface ListResp {
  accounts: OssAcc[];
  env_fallback: {
    configured: boolean;
    endpoint: string | null;
    bucket: string | null;
    in_use: boolean;
    mirror_results: boolean;
  };
}

const PROVIDERS = [
  { value: "s3", label: "AWS S3 / 通用 S3" },
  { value: "aliyun", label: "阿里云 OSS" },
  { value: "minio", label: "MinIO" },
  { value: "r2", label: "Cloudflare R2" },
] as const;

const EMPTY = {
  label: "",
  provider: "aliyun" as "s3" | "aliyun" | "minio" | "r2",
  endpoint: "",
  region: "oss-cn-hangzhou",
  bucket: "",
  access_key_id: "",
  secret_access_key: "",
  public_base_url: "",
  path_prefix: "media",
  mirror_results: true,
  force_path_style: false,
  activate: true,
};

export default function AdminOssPage() {
  const [data, setData] = useState<ListResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  /** null = 新建；数字 = 正在编辑那个账户 */
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    try {
      setData(await api<ListResp>("/api/admin/oss-accounts"));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(fn: () => Promise<unknown>, okMsg: string) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      await fn();
      setMsg(okMsg);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setFormOpen(true);
  }

  /** 把已有账户读进表单。密钥不回填——服务端只存密文，界面上也只有掩码 */
  function startEdit(a: OssAcc) {
    setEditingId(a.id);
    setForm({
      label: a.label,
      provider: a.provider as (typeof EMPTY)["provider"],
      endpoint: a.endpoint,
      region: a.region,
      bucket: a.bucket,
      access_key_id: a.access_key_id,
      secret_access_key: "",
      public_base_url: a.public_base_url ?? "",
      path_prefix: a.path_prefix,
      mirror_results: a.mirror_results,
      force_path_style: a.force_path_style,
      activate: a.is_active,
    });
    setFormOpen(true);
    setMsg("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      ...form,
      label: form.label.trim(),
      endpoint: form.endpoint.trim(),
      bucket: form.bucket.trim(),
      access_key_id: form.access_key_id.trim(),
      public_base_url: form.public_base_url.trim() || null,
    };
    if (editingId !== null) {
      // 编辑时密钥留空 = 不改。空字符串会被 zod 的 min(1) 拒掉，所以要整个删掉
      if (form.secret_access_key.trim()) {
        payload.secret_access_key = form.secret_access_key.trim();
      } else {
        delete payload.secret_access_key;
      }
    } else {
      payload.secret_access_key = form.secret_access_key.trim();
    }

    await action(async () => {
      await api(
        editingId === null ? "/api/admin/oss-accounts" : `/api/admin/oss-accounts/${editingId}`,
        { method: editingId === null ? "POST" : "PATCH", body: JSON.stringify(payload) }
      );
      closeForm();
    }, editingId === null ? "OSS 账户已添加" : "OSS 账户已更新");
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tighter mb-1">对象存储 OSS</h1>
          <p className="text-ink-muted text-sm">
            S3 兼容存储（阿里云 OSS / AWS / MinIO / R2）；生成结果可自动从上游 URL 镜像到自有桶
          </p>
        </div>
        <button
          onClick={() => (formOpen ? closeForm() : startCreate())}
          className="px-5 py-2.5 text-sm font-semibold bg-orange-700 hover:bg-orange-600 rounded-2xl text-white"
        >
          <i className={`fas ${formOpen ? "fa-xmark" : "fa-plus"} mr-2`} />
          {formOpen ? "取消" : "添加账户"}
        </button>
      </div>

      {msg && <p className="mb-4 text-sm text-amber-800">{msg}</p>}

      {data?.env_fallback && (
        <div
          className={`glass rounded-3xl p-4 mb-6 text-sm ${
            data.env_fallback.in_use ? "border border-amber-500/30" : ""
          }`}
        >
          <div className="font-semibold mb-1">.env 兜底配置</div>
          {data.env_fallback.configured ? (
            <p className="text-ink-muted text-xs">
              {data.env_fallback.endpoint} / {data.env_fallback.bucket}
              {data.env_fallback.in_use ? " · 当前无激活 DB 账户，正在使用 .env" : " · 有激活 DB 账户时优先用 DB"}
            </p>
          ) : (
            <p className="text-ink-subtle text-xs">未配置 OSS_* 环境变量</p>
          )}
        </div>
      )}

      {formOpen && (
        <form onSubmit={(e) => void submitForm(e)} className="glass rounded-3xl p-6 mb-8 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">
              {editingId === null ? "添加 OSS 账户" : `编辑账户 #${editingId}`}
            </h2>
            {editingId !== null && (
              <button
                type="button"
                onClick={closeForm}
                className="text-xs text-ink-muted hover:text-ink"
              >
                取消编辑
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">备注名</span>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">提供商</span>
              <select
                value={form.provider}
                onChange={(e) => {
                  const p = e.target.value as "s3" | "aliyun" | "minio" | "r2";
                  setForm({
                    ...form,
                    provider: p,
                    force_path_style: p === "minio",
                    region: p === "aliyun" ? "oss-cn-hangzhou" : p === "r2" ? "auto" : "us-east-1",
                  });
                }}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="text-ink-muted text-xs">Endpoint</span>
              <input
                required
                placeholder="https://oss-cn-hangzhou.aliyuncs.com"
                value={form.endpoint}
                onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">Region</span>
              <input
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">Bucket</span>
              <input
                required
                value={form.bucket}
                onChange={(e) => setForm({ ...form, bucket: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">Access Key ID</span>
              <input
                required
                value={form.access_key_id}
                onChange={(e) => setForm({ ...form, access_key_id: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">
                Secret Access Key
                {editingId !== null && <span className="ml-1 text-ink-subtle">（留空则不修改）</span>}
              </span>
              <input
                required={editingId === null}
                type="password"
                placeholder={editingId !== null ? "不改就别填" : ""}
                value={form.secret_access_key}
                onChange={(e) => setForm({ ...form, secret_access_key: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="text-ink-muted text-xs">公网访问域名</span>
              <input
                placeholder="https://pub-xxxx.r2.dev 或 https://cdn.yourdomain.com"
                value={form.public_base_url}
                onChange={(e) => setForm({ ...form, public_base_url: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
              {/*
                这一栏名义上选填，实际对 R2/S3 是必填。留空时 publicUrlForKey
                会退回 https://{bucket}.{endpoint}/，而那是 S3 API 端点——
                只接受签名请求，浏览器直接取会 401，表现为全站图片裂掉。
              */}
              {!form.public_base_url.trim() && (
                <span className="mt-1.5 block rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-800">
                  留空会退回用 S3 API 端点拼地址（<code className="font-mono">{"{bucket}.{endpoint}"}</code>），
                  那个端点只接受签名请求，浏览器取不到，表现就是图片全裂。
                  R2 请填存储桶的公开域名 <code className="font-mono">https://pub-xxxx.r2.dev</code>，
                  或你自己绑的 CDN 域名。
                </span>
              )}
            </label>
            <label className="block text-sm">
              <span className="text-ink-muted text-xs">路径前缀</span>
              <input
                value={form.path_prefix}
                onChange={(e) => setForm({ ...form, path_prefix: e.target.value })}
                className="mt-1 w-full bg-surface border border-line rounded-xl px-3 py-2 font-mono text-xs"
              />
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={form.mirror_results}
                onChange={(e) => setForm({ ...form, mirror_results: e.target.checked })}
              />
              自动镜像结果 生成结果
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.force_path_style}
                onChange={(e) => setForm({ ...form, force_path_style: e.target.checked })}
              />
              Force Path Style（MinIO 通常需要）
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm({ ...form, activate: e.target.checked })}
              />
              {editingId === null ? "立即激活" : "设为激活账户"}
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="px-5 py-2.5 bg-orange-700 hover:bg-orange-600 rounded-2xl text-sm font-semibold disabled:opacity-50 text-white"
          >
            保存
          </button>
        </form>
      )}

      <div className="space-y-4">
        {data?.accounts.map((a) => (
          <div key={a.id} className="glass rounded-3xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{a.label}</span>
                  {a.is_active && (
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-700 rounded-full">
                      激活中
                    </span>
                  )}
                  <span className="text-[10px] px-2 py-0.5 bg-black/[0.06] text-ink-muted rounded-full">{a.provider}</span>
                </div>
                <div className="text-xs text-ink-subtle mt-2 font-mono space-y-1">
                  <div>
                    {a.endpoint} · {a.bucket} · {a.region}
                  </div>
                  <div>
                    AK: {a.access_key_id} · SK: {a.secret_key_mask}
                  </div>
                  <div>
                    前缀 {a.path_prefix}
                    {a.public_base_url ? ` · 公网域名 ${a.public_base_url}` : ""}
                    {a.mirror_results ? " · 镜像结果" : " · 不镜像"}
                  </div>
                  {/* 没配公网域名等于所有媒体链接都取不到，值得在列表里就喊出来 */}
                  {!a.public_base_url && (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 font-sans text-[11px] text-amber-800">
                      <i className="fas fa-triangle-exclamation mr-1" />
                      未配公网访问域名，媒体链接会指向 S3 API 端点，浏览器取不到（图片全裂）
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  disabled={busy}
                  onClick={() => startEdit(a)}
                  className="px-3 py-1.5 text-xs rounded-xl border border-line hover:bg-black/[0.05] disabled:opacity-50"
                >
                  <i className="fas fa-pen mr-1.5" />
                  编辑
                </button>
                {!a.is_active && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () => api(`/api/admin/oss-accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ activate: true }) }),
                        "已激活"
                      )
                    }
                    className="text-xs px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/30 text-emerald-700 rounded-lg"
                  >
                    激活
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () => api(`/api/admin/oss-accounts/${a.id}/test`, { method: "POST" }),
                      `桶 ${a.bucket} 连接成功`
                    )
                  }
                  className="text-xs px-3 py-1.5 bg-black/[0.03] border border-line rounded-lg"
                >
                  测试连接
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`删除 OSS 账户「${a.label}」？`)) return;
                    void action(
                      () => api(`/api/admin/oss-accounts/${a.id}`, { method: "DELETE" }),
                      "已删除"
                    );
                  }}
                  className="text-xs px-3 py-1.5 bg-red-600/20 border border-red-500/30 text-red-700 rounded-lg"
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ))}
        {data && data.accounts.length === 0 && (
          <p className="text-ink-subtle text-sm text-center py-10">尚未配置 OSS 账户</p>
        )}
      </div>
    </div>
  );
}
