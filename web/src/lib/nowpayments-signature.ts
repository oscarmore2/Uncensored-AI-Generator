import crypto from "crypto";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, JsonValue>>((result, key) => {
        result[key] = sortJson(value[key]);
        return result;
      }, {});
  }
  return value;
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b) || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function signNowPaymentsPayload(
  payload: Record<string, JsonValue>,
  ipnSecret: string
): string {
  const canonical = JSON.stringify(sortJson(payload));
  return crypto.createHmac("sha512", ipnSecret).update(canonical).digest("hex");
}

export function verifyNowPaymentsSignature(
  payload: Record<string, JsonValue>,
  ipnSecret: string,
  receivedSignature: string
): boolean {
  return safeEqualHex(
    signNowPaymentsPayload(payload, ipnSecret),
    receivedSignature
  );
}
