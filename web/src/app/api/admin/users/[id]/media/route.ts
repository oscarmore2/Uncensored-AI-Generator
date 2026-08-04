import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

const querySchema = z.object({
  kind: z.enum(["main", "plaything", "upload"]).default("main"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

function urls(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = Number((await context.params).id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const query = querySchema.safeParse({
    kind: new URL(req.url).searchParams.get("kind") ?? undefined,
    page: new URL(req.url).searchParams.get("page") ?? undefined,
    limit: new URL(req.url).searchParams.get("limit") ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json({ error: "Invalid media query" }, { status: 400 });
  }
  const { kind, page, limit } = query.data;
  const skip = (page - 1) * limit;

  if (kind === "main") {
    const [total, records] = await Promise.all([
      db.generation.count({ where: { userId } }),
      db.generation.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          mode: true,
          prompt: true,
          status: true,
          resultUrls: true,
          isAdult: true,
          visibility: true,
          deletedAt: true,
          mediaExpiresAt: true,
          mediaDeletedAt: true,
          createdAt: true,
        },
      }),
    ]);
    return NextResponse.json({
      kind,
      total,
      page,
      limit,
      media: records.map((record) => ({
        id: record.id,
        channel: "main",
        label: record.mode,
        prompt: record.prompt,
        status: record.status,
        urls: urls(record.resultUrls),
        content_type: null,
        is_adult: record.isAdult,
        is_featured: record.visibility === "featured",
        expires_at: record.mediaExpiresAt,
        deleted_at: record.mediaDeletedAt ?? record.deletedAt,
        created_at: record.createdAt,
      })),
    });
  }

  if (kind === "plaything") {
    const [total, records] = await Promise.all([
      db.playthingGeneration.count({ where: { userId } }),
      db.playthingGeneration.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          prompt: true,
          status: true,
          resultUrls: true,
          isAdult: true,
          mediaExpiresAt: true,
          mediaDeletedAt: true,
          createdAt: true,
          product: { select: { label: true, modelId: true } },
        },
      }),
    ]);
    return NextResponse.json({
      kind,
      total,
      page,
      limit,
      media: records.map((record) => ({
        id: record.id,
        channel: "plaything",
        label: record.product.label || record.product.modelId,
        prompt: record.prompt,
        status: record.status,
        urls: urls(record.resultUrls),
        content_type: null,
        is_adult: record.isAdult,
        is_featured: false,
        expires_at: record.mediaExpiresAt,
        deleted_at: record.mediaDeletedAt,
        created_at: record.createdAt,
      })),
    });
  }

  const [total, records] = await Promise.all([
    db.mediaAsset.count({ where: { userId } }),
    db.mediaAsset.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        kind: true,
        channel: true,
        url: true,
        contentType: true,
        bytes: true,
        expiresAt: true,
        deletedAt: true,
        createdAt: true,
      },
    }),
  ]);
  return NextResponse.json({
    kind,
    total,
    page,
    limit,
    media: records.map((record) => ({
      id: record.id,
      channel: record.channel,
      label: record.kind,
      prompt: "",
      status: record.deletedAt ? "deleted" : "uploaded",
      urls: record.url ? [record.url] : [],
      content_type: record.contentType,
      bytes: record.bytes,
      is_adult: false,
      is_featured: false,
      expires_at: record.expiresAt,
      deleted_at: record.deletedAt,
      created_at: record.createdAt,
    })),
  });
}
