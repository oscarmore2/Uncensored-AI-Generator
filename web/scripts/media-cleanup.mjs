const appUrl = process.env.APP_URL;
const secret = process.env.MEDIA_CLEANUP_SECRET;

if (!appUrl || !secret) {
  console.error("APP_URL and MEDIA_CLEANUP_SECRET are required");
  process.exit(1);
}

const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/internal/media-cleanup`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ limit: Number(process.env.MEDIA_CLEANUP_BATCH_SIZE || 100) }),
  signal: AbortSignal.timeout(55_000),
});
const body = await response.text();
if (!response.ok) {
  console.error(`Media cleanup failed: HTTP ${response.status} ${body}`);
  process.exit(1);
}
console.log(body);
