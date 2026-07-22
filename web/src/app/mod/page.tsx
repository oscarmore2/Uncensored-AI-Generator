import Link from "next/link";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ModDashboardPage() {
  const [pendingReview, deleted, featured, publicCount, users, recent] = await Promise.all([
    db.generation.count({ where: { status: "succeeded", deletedAt: null, visibility: "private" } }),
    db.generation.count({ where: { deletedAt: { not: null } } }),
    db.generation.count({ where: { visibility: "featured" } }),
    db.publicWork.count({ where: { isPublished: true } }),
    db.user.count(),
    db.generation.findMany({
      where: { deletedAt: null },
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const stats = [
    { label: "待审成功作品", value: pendingReview, href: "/mod/generations?status=succeeded" },
    { label: "已软删除", value: deleted, href: "/mod/generations?deleted=1" },
    { label: "已曝光", value: featured, href: "/mod/public" },
    { label: "公共库已上架", value: publicCount, href: "/mod/public" },
    { label: "注册用户", value: users, href: "/mod/users" },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tighter mb-1">队列概览</h1>
      <p className="text-gray-400 text-sm mb-8">审核工作台 · 数据实时读取</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="glass rounded-3xl p-5 hover:border-rose-500/40 transition-colors">
            <div className="text-3xl font-bold font-mono stat-number">{s.value}</div>
            <div className="text-xs text-gray-400 mt-1">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">最近生成</h2>
        <Link href="/mod/generations" className="text-sm text-rose-400 hover:text-rose-300">
          进入审核 <i className="fas fa-arrow-right ml-1" />
        </Link>
      </div>
      <div className="glass rounded-3xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-white/10">
              <th className="px-5 py-3">ID</th>
              <th className="px-5 py-3">用户</th>
              <th className="px-5 py-3">模式</th>
              <th className="px-5 py-3">提示词</th>
              <th className="px-5 py-3">状态</th>
              <th className="px-5 py-3">时间</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((g) => (
              <tr key={g.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="px-5 py-3 font-mono text-gray-400">#{g.id}</td>
                <td className="px-5 py-3">{g.user.username}</td>
                <td className="px-5 py-3 font-mono text-xs">{g.mode}</td>
                <td className="px-5 py-3 max-w-xs truncate text-gray-300">{g.prompt}</td>
                <td className="px-5 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      g.status === "succeeded"
                        ? "bg-emerald-500/15 text-emerald-300"
                        : g.status === "failed"
                          ? "bg-red-500/15 text-red-300"
                          : "bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {g.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">{g.createdAt.toLocaleString("zh-CN")}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                  暂无生成记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
