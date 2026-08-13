import "server-only";
import dns from "dns/promises";
import net from "net";
import { env } from "./env";

/**
 * 允许镜像来源的主机后缀。
 *
 * 这份名单是「能不能把上游产物抓回自家 OSS」的开关，不是安全边界的全部——
 * 私网 IP 由下面的 isPrivateIp + DNS 复核单独挡。名单没覆盖到的上游，
 * mirrorRemoteUrls 会静默回落到上游直链，等上游过期就是一片裂图。
 *
 * 踩过的坑：接入 Atlas 之后没有回来补这里，于是 Atlas/Seedance 的产出
 * 一次都没有镜像成功过（cloudfront.net 与 volces.com 都不在名单里），
 * 上游一清理，探索页和我的作品同时裂掉。**加新渠道必须回来补这里。**
 *
 * cloudfront.net / volces.com 是公有 CDN，放行等于允许服务端抓取任意
 * 该 CDN 上的公开对象。这类 SSRF 危害有限（拿不到内网、拿不到元数据端点），
 * 换来的是媒体能真正落到自己手里，值得。
 */
const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  "zencreator.pro",
  "zencreator.com",
  "wavespeed.ai",
  // Atlas Cloud 的分发 CDN
  "cloudfront.net",
  // 火山引擎 TOS：Seedance 系列的产出落在这里
  "volces.com",
  "cloudflarestorage.com",
  "amazonaws.com",
  "aliyuncs.com",
  "r2.dev",
  "hf.co",
  "huggingface.co",
];

/** 上游换 CDN 时的应急出口：改环境变量即可，不必等一次发版 */
function envExtraHostSuffixes(): string[] {
  return env.MEDIA_MIRROR_EXTRA_HOSTS.split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function isPrivateIp(ip: string): boolean {
  if (ip === "0.0.0.0" || ip === "::" || ip === "::1") return true;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
    return true;
  }
  // 172.16.0.0 – 172.31.255.255
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 unique local / link-local
  const lower = ip.toLowerCase();
  if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
  return false;
}

function hostAllowed(hostname: string, extraSuffixes: string[] = []): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost") return false;
  if (net.isIP(host)) return !isPrivateIp(host);

  const suffixes = [...DEFAULT_ALLOWED_HOST_SUFFIXES, ...envExtraHostSuffixes(), ...extraSuffixes]
    .map((s) => s.toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);

  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 校验远程媒体 URL，防止 SSRF（内网、元数据地址、非 https）。
 * 可选传入自家 CDN 主机名白名单。
 */
export async function assertSafeRemoteMediaUrl(
  rawUrl: string,
  opts?: { extraHostSuffixes?: string[] }
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid remote URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only https remote URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Remote URL must not contain credentials");
  }
  if (!hostAllowed(parsed.hostname, opts?.extraHostSuffixes)) {
    throw new Error(`Remote host not allowed: ${parsed.hostname}`);
  }

  // DNS 解析后再挡一层私网 IP（防 DNS rebinding 基础防护）
  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        throw new Error(`Remote host resolves to private IP: ${r.address}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("private IP")) throw err;
    throw new Error(`Failed to resolve remote host: ${parsed.hostname}`);
  }

  return parsed;
}
