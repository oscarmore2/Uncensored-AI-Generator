// Cryptomus Webhook 联调脚本：
// 1) 直接向数据库插入一条待支付的 CryptoPayment
// 2) 用与 Cryptomus 相同的算法（PHP 风格转义 + md5(base64+key)）对模拟回调签名
// 3) POST 到本地 webhook，验证验签、幂等入账、重复回调不重复加点
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const API_KEY = process.env.CRYPTOMUS_PAYMENT_API_KEY ?? "local_test_payment_key_replace_me";
const BASE = "http://localhost:3000";

const db = new PrismaClient();

function phpJson(obj) {
  return JSON.stringify(obj).replace(/\//g, "\\/");
}

function sign(json) {
  return crypto.createHash("md5").update(Buffer.from(json).toString("base64") + API_KEY).digest("hex");
}

const user = await db.user.findUnique({ where: { username: "demo_user" } });
if (!user) throw new Error("demo_user not found; login once first");

const orderId = `cr_test_${Date.now()}`;
await db.cryptoPayment.create({
  data: { userId: user.id, orderId, credits: 500, amountUsdCents: 12900, status: "check" },
});
const before = user.balance;
console.log(`created order ${orderId}, balance before = ${before}`);

const payload = {
  type: "payment",
  uuid: "62f88b36-a9d5-4fa6-aa26-e040c3dbf26d",
  order_id: orderId,
  amount: "129.00000000",
  payment_amount: "129.00000000",
  payment_amount_usd: "129.00",
  merchant_amount: "126.42000000",
  commission: "2.58000000",
  is_final: true,
  status: "paid",
  from: "0xabc/def",  // 带斜杠，验证 PHP 转义处理
  wallet_address_uuid: null,
  network: "polygon",
  currency: "USD",
  payer_currency: "USDT",
  payer_amount: "129.00000000",
  payer_amount_exchange_rate: "1.00000000",
  additional_data: null,
  txid: "0x6f0d9c83/74db57ca",
};
const body = phpJson(payload);
const withSign = body.slice(0, -1) + `,"sign":"${sign(body)}"}`;

async function post(payloadStr, label) {
  const resp = await fetch(`${BASE}/api/payments/crypto/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payloadStr,
  });
  console.log(`${label}: HTTP ${resp.status} ${await resp.text()}`);
}

await post(withSign, "1. valid webhook");
await post(withSign, "2. duplicate webhook (idempotency)");
await post(withSign.replace('"merchant_amount":"126.42000000"', '"merchant_amount":"999.00000000"'), "3. tampered body (should 401)");
await post(withSign.replace(/"sign":"[a-f0-9]+"/, '"sign":"deadbeef"'), "4. wrong sign (should 401)");

const after = await db.user.findUnique({ where: { id: user.id } });
const record = await db.cryptoPayment.findUnique({ where: { orderId } });
console.log(`balance after = ${after.balance} (expect +500 exactly once => ${before + 500})`);
console.log(`payment record: status=${record.status} credited=${record.credited} txid=${record.txid}`);

const txCount = await db.transaction.count({ where: { userId: user.id, method: "cryptomus" } });
console.log(`cryptomus transactions total = ${txCount}`);

await db.$disconnect();
