import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { userOut } from "@/lib/serialize";
import { SERVER_BOOT_ID } from "@/lib/server-boot";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // server_boot_id 给前端判断本地草稿是否属于「这一代服务端」
  return NextResponse.json({ ...userOut(user), server_boot_id: SERVER_BOOT_ID });
}
