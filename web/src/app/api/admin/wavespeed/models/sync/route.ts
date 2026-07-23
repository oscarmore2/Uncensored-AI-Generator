import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { syncWaveSpeedCatalog } from "@/lib/wavespeed";
import { logAdminAction } from "@/lib/admin-audit";

export async function POST() {
  const admin = await requireRole("admin");
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const result = await syncWaveSpeedCatalog();
    await logAdminAction(admin.id, "wavespeed_sync", { type: "WaveSpeedCatalog", id: "all" }, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
