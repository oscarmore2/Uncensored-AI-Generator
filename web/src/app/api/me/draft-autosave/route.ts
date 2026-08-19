import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/csrf";
import { isVipActive } from "@/lib/pricing";
import { userOut } from "@/lib/serialize";

/**
 * 草稿自动保存开关。
 *
 * 开启是 VIP 功能，关闭任何人都可以——否则 VIP 过期的用户会被永久卡在
 * 开启状态上，既关不掉也享受不到。
 */
export async function PATCH(req: Request) {
  const origin = assertSameOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ error: origin.error }, { status: origin.status });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = z.object({ enabled: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }

  if (parsed.data.enabled && !isVipActive(user)) {
    return NextResponse.json({ error: "草稿自动保存仅对 VIP 开放" }, { status: 403 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { draftAutoSave: parsed.data.enabled },
    include: { vipTier: true },
  });
  return NextResponse.json(userOut(updated));
}
