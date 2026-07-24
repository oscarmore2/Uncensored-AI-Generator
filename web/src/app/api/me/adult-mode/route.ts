import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/csrf";
import { isVipActive } from "@/lib/pricing";
import { isAtLeast18 } from "@/lib/adult-access";
import { userOut } from "@/lib/serialize";

const bodySchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    birth_date: z.string().date(),
    confirm_adult: z.literal(true),
  }),
]);

export async function PATCH(req: Request) {
  const origin = assertSameOrigin(req);
  if (!origin.ok) {
    return NextResponse.json({ error: origin.error }, { status: origin.status });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  }

  if (!parsed.data.enabled) {
    const updated = await db.user.update({
      where: { id: user.id },
      data: { adultModeEnabled: false },
      include: { vipTier: true },
    });
    return NextResponse.json(userOut(updated));
  }

  if (!isVipActive(user)) {
    return NextResponse.json({ error: "成人模式仅对有效 VIP 用户开放" }, { status: 403 });
  }

  const birthDate = new Date(`${parsed.data.birth_date}T00:00:00.000Z`);
  if (!Number.isFinite(birthDate.getTime()) || !isAtLeast18(birthDate)) {
    return NextResponse.json({ error: "未满 18 岁，无法开启成人模式" }, { status: 403 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      birthDate,
      ageVerifiedAt: new Date(),
      adultModeEnabled: true,
    },
    include: { vipTier: true },
  });
  return NextResponse.json(userOut(updated));
}
