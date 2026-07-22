import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { generationSchema } from "@/lib/validators";
import { generationCost, processGeneration } from "@/lib/zen";
import { generationOut } from "@/lib/serialize";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`gen:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "生成请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = generationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const gen = parsed.data;
  const cost = generationCost(gen.mode, gen.batch);

  // 原子扣费：余额不足时不更新任何行
  const charged = await db.user.updateMany({
    where: { id: user.id, balance: { gte: cost } },
    data: { balance: { decrement: cost } },
  });
  if (charged.count === 0) {
    return NextResponse.json({ error: "点数不足，请先充值" }, { status: 400 });
  }

  const record = await db.generation.create({
    data: {
      userId: user.id,
      mode: gen.mode,
      prompt: gen.prompt,
      negativePrompt: gen.negative_prompt,
      params: JSON.stringify({ ratio: gen.ratio, style: gen.style, quality: gen.quality, batch: gen.batch }),
      cost,
      status: "pending",
    },
  });

  void processGeneration(record.id);

  return NextResponse.json(generationOut(record), { status: 201 });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const gens = await db.generation.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(gens.map(generationOut));
}
