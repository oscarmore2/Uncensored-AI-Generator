import { redirect } from "next/navigation";

/** 旧路径：单渠道时代的模型库，已并入按渠道分 tab 的 /admin/models */
export default function LegacyWaveSpeedModelsPage() {
  redirect("/admin/models");
}
