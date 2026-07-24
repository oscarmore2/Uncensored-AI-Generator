/**
 * Cloudflare Worker：把 Railway → Zen 的请求经 CF 边缘转发，绕过机房 IP 的 Bot Challenge。
 *
 * 部署：
 *   1. Cloudflare Dashboard → Workers & Pages → Create Worker
 *   2. 粘贴本文件内容并 Deploy
 *   3. （推荐）绑定自定义域名，如 zen-proxy.yourdomain.com
 *   4. Railway 环境变量：
 *        ZEN_BASE_URL=https://zen-proxy.yourdomain.com/api/public/v1
 *      或 workers.dev：
 *        ZEN_BASE_URL=https://<worker-name>.<subdomain>.workers.dev/api/public/v1
 *
 * 可选安全：Workers → Settings → Variables **必须**设置 PROXY_SECRET；
 * Railway 同步设置 ZEN_PROXY_SECRET（同值）。Worker 校验头 X-Zen-Proxy-Secret。
 * 未设置 PROXY_SECRET 时 Worker 拒绝代理（防开放代理滥用）。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Zen-Proxy-Secret, Idempotency-Key",
        },
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({ ok: true, service: "zen-proxy", target: "https://api.zencreator.pro" });
    }

    const expected = env && env.PROXY_SECRET;
    if (!expected) {
      return Response.json(
        { error: "PROXY_SECRET is required; refusing to run as open proxy" },
        { status: 503 }
      );
    }
    const got = request.headers.get("X-Zen-Proxy-Secret") || "";
    // Worker 无 Node crypto；长度先比，再逐字节（简易常量时间）
    if (got.length !== expected.length) {
      return Response.json({ error: "Unauthorized proxy" }, { status: 401 });
    }
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (mismatch !== 0) {
      return Response.json({ error: "Unauthorized proxy" }, { status: 401 });
    }

    if (!url.pathname.startsWith("/api/public/")) {
      return Response.json({ error: "Only /api/public/* is proxied" }, { status: 404 });
    }

    const target = new URL(url.pathname + url.search, "https://api.zencreator.pro");
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.delete("x-zen-proxy-secret");

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }

    const upstream = await fetch(target.toString(), init);
    const outHeaders = new Headers(upstream.headers);
    outHeaders.set("Access-Control-Allow-Origin", "*");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  },
};
