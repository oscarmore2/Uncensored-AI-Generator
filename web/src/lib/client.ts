"use client";

// 同源 API 封装：Cookie 会话自动携带，无需手动附加 token
export interface ApiUser {
  id: number;
  username: string;
  role: string;
  balance: number;
  is_vip: boolean;
  vip_expires_at: string | null;
}

export interface ApiGeneration {
  id: number;
  mode: string;
  prompt: string;
  status: string;
  result_urls: string[] | null;
  cost: number;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new ApiError(resp.status, (data as { error?: string }).error ?? `请求失败 (${resp.status})`);
  }
  return data as T;
}

export const MODES = [
  { key: "txt2img", label: "文字生图", icon: "fa-font", cost: 2 },
  { key: "txt2vid", label: "文字生视频", icon: "fa-video", cost: 15 },
  { key: "img2img", label: "图片生图", icon: "fa-image", cost: 3 },
  { key: "img2vid", label: "图片生视频", icon: "fa-film", cost: 20 },
] as const;

export function modeCost(modeIndex: number, batch: number): number {
  const base = MODES[modeIndex].cost;
  return batch === 4 ? Math.floor(base * 1.5) : base;
}
