import "server-only";
import net from "node:net";
import { env } from "./env";
import { clientIp } from "./rate-limit";

export type RegistrationGeo = {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  source: string;
  capturedAt: Date;
};

function clean(value: string | null | undefined, max = 120): string | null {
  const decoded = value ? decodeURIComponentSafe(value).trim() : "";
  return decoded ? decoded.slice(0, max) : null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeCountryCode(value: string | null | undefined): string | null {
  const code = clean(value, 2)?.toUpperCase() ?? null;
  return code && /^[A-Z]{2}$/.test(code) && code !== "XX" ? code : null;
}

function isPublicIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) {
    return false;
  }
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return true;
}

function headerGeo(req: Request): RegistrationGeo | null {
  const fromCloudflare = Boolean(req.headers.get("cf-ray"));
  const fromVercel = Boolean(req.headers.get("x-vercel-id"));
  const fromCloudFront = Boolean(req.headers.get("x-amz-cf-id"));
  const countryCode = normalizeCountryCode(
    (fromCloudflare ? req.headers.get("cf-ipcountry") : null) ??
      (fromVercel ? req.headers.get("x-vercel-ip-country") : null) ??
      (fromCloudFront ? req.headers.get("cloudfront-viewer-country") : null)
  );
  const region = clean(
    (fromVercel ? req.headers.get("x-vercel-ip-country-region") : null) ??
      (fromCloudFront
        ? req.headers.get("cloudfront-viewer-country-region-name")
        : null)
  );
  const city = clean(
    (fromVercel ? req.headers.get("x-vercel-ip-city") : null) ??
      (fromCloudFront ? req.headers.get("cloudfront-viewer-city") : null)
  );
  if (!countryCode && !region && !city) return null;
  return {
    countryCode,
    country: null,
    region,
    city,
    source: fromCloudflare
      ? "cloudflare_headers"
      : fromVercel
        ? "vercel_headers"
        : "cloudfront_headers",
    capturedAt: new Date(),
  };
}

async function ipinfoGeo(ip: string): Promise<RegistrationGeo | null> {
  if (!env.IPINFO_TOKEN || !isPublicIp(ip)) return null;
  const base = env.IPINFO_API_BASE.replace(/\/+$/, "");
  const token = encodeURIComponent(env.IPINFO_TOKEN);
  const endpoints = [
    `${base}/lookup/${encodeURIComponent(ip)}?token=${token}`,
    `${base}/lite/${encodeURIComponent(ip)}?token=${token}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) continue;
      const data = (await response.json()) as {
        country_code?: string;
        country?: string;
        region?: string;
        city?: string;
        geo?: {
          country_code?: string;
          country?: string;
          region?: string;
          city?: string;
        };
      };
      const geo = data.geo ?? data;
      const result: RegistrationGeo = {
        countryCode: normalizeCountryCode(geo.country_code),
        country: clean(geo.country),
        region: clean(geo.region),
        city: clean(geo.city),
        source: endpoint.includes("/lite/") ? "ipinfo_lite" : "ipinfo",
        capturedAt: new Date(),
      };
      if (result.countryCode || result.country || result.region || result.city) return result;
    } catch {
      // Geo enrichment must never block registration.
    }
  }
  return null;
}

export async function detectRegistrationGeo(req: Request): Promise<RegistrationGeo | null> {
  const fromHeaders = headerGeo(req);
  const fromIpinfo = await ipinfoGeo(clientIp(req));
  if (!fromHeaders) return fromIpinfo;
  if (!fromIpinfo) return fromHeaders;
  return {
    countryCode: fromHeaders.countryCode ?? fromIpinfo.countryCode,
    country: fromHeaders.country ?? fromIpinfo.country,
    region: fromHeaders.region ?? fromIpinfo.region,
    city: fromHeaders.city ?? fromIpinfo.city,
    source: `${fromHeaders.source}+${fromIpinfo.source}`,
    capturedAt: new Date(),
  };
}

export function registrationGeoData(geo: RegistrationGeo | null) {
  if (!geo) return {};
  return {
    registrationCountryCode: geo.countryCode,
    registrationCountry: geo.country,
    registrationRegion: geo.region,
    registrationCity: geo.city,
    registrationGeoSource: geo.source,
    registrationGeoCapturedAt: geo.capturedAt,
  };
}
