import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { absoluteUrl } from "@/lib/site";

/**
 * 生成 / 撤销一条作品的分享链接。
 *
 * 令牌是随机的，不是 id：生成记录默认私有，用 id 做公开地址等于让任何人
 * 顺着数字遍历出别人的作品。
 *
 * 成人作品一律不给分享链接。分享页是公开页，没有登录也没有年龄验证，
 * 一旦链接流出就绕过了全站的成人门禁——这个口子不能开。
 */

/** 16 字节 base64url ≈ 128 bit，够抗遍历 */
function newShareToken(): string {
  return randomBytes(16).toString("base64url");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = assertSameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const genId = Number(id);
  if (!Number.isInteger(genId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const gen = await db.generation.findFirst({
    where: { id: genId, userId: user.id, deletedAt: null },
    select: {
      id: true,
      status: true,
      isAdult: true,
      shareToken: true,
      resultUrls: true,
      mediaDeletedAt: true,
    },
  });
  if (!gen) return NextResponse.json({ error: "作品不存在" }, { status: 404 });

  if (gen.isAdult) {
    return NextResponse.json(
      { error: "成人作品不支持分享", code: "ADULT_NOT_SHAREABLE" },
      { status: 403 }
    );
  }
  if (gen.status !== "succeeded" || !gen.resultUrls) {
    return NextResponse.json({ error: "作品尚未生成完成", code: "NOT_READY" }, { status: 409 });
  }
  // 媒体都清理掉了再发链接没有意义，对面只会看到一个报错页
  if (gen.mediaDeletedAt) {
    return NextResponse.json(
      { error: "作品媒体已过保留期，无法分享", code: "MEDIA_GONE" },
      { status: 409 }
    );
  }

  const token = gen.shareToken ?? newShareToken();
  if (!gen.shareToken) {
    await db.generation.update({ where: { id: gen.id }, data: { shareToken: token } });
  }

  return NextResponse.json({ token, url: absoluteUrl(`/s/g/${token}`) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const originCheck = assertSameOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json({ error: originCheck.error }, { status: originCheck.status });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const genId = Number(id);
  if (!Number.isInteger(genId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { count } = await db.generation.updateMany({
    where: { id: genId, userId: user.id },
    data: { shareToken: null },
  });
  if (count === 0) return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
