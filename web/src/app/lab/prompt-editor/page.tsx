import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { Spike } from "./Spike";

/**
 * P0 go/no-go：Lexical 的中文输入法真机压测。
 *
 * 真 WYSIWYG 必然落在 contenteditable 上，而**安卓中文输入是唯一可能推翻
 * 整个方案的风险**。所以在写任何正式代码之前，先拿真机把这一页跑一遍。
 *
 * 这一页刻意不放在 /admin 下面：admin 布局是 w-56 固定侧栏、没做响应式，
 * 375px 的手机上正文只剩一百多像素，测不出任何东西。而这次要测的恰恰是
 * 窄屏 + 软键盘 + 输入法候选条同时挤占空间时编辑器还好不好用。
 *
 * 权限仍然是管理员：页面自己在服务端 requireRole，不依赖 middleware
 * （middleware 的 matcher 没覆盖 /lab，这里是唯一也是权威的那道门）。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function Page() {
  const admin = await requireRole("admin");
  if (!admin) redirect("/");
  return <Spike />;
}
