import "server-only";
import dns from "dns/promises";
import net from "net";

const DEFAULT_ALLOWED_HOST_SUFFIXES = [
  "zencreator.pro",
  "zencreator.com",
  "wavespeed.ai",
  "cloudflarestorage.com",
  "amazonaws.com",
  "aliyuncs.com",
  "r2.dev",
  "hf.co",
  "huggingface.co",
];

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

  const suffixes = [...DEFAULT_ALLOWED_HOST_SUFFIXES, ...extraSuffixes]
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
