import { NextResponse } from "next/server";

/**
 * 会话保活。middleware 已经校验过令牌、也顺手续过签了，这里只需要回个 200。
 *
 * 故意不查库：保活是高频请求，为它每次读一遍用户表纯属浪费。
 * 令牌失效的请求压根到不了这里——middleware 会先返回 401。
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
