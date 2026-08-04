import { redirect } from "next/navigation";

/** 旧路径：单渠道时代的 WaveSpeed API Key 页，已并入按渠道分 tab 的 /admin/providers */
export default function LegacyWaveSpeedPage() {
  redirect("/admin/providers");
}
