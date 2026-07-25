import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/site";

export const revalidate = 3600;

const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/explore", changeFrequency: "daily", priority: 0.9 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.8 },
  { path: "/terms", changeFrequency: "monthly", priority: 0.3 },
  { path: "/content-policy", changeFrequency: "monthly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "monthly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticEntries = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  try {
    const works = await db.publicWork.findMany({
      where: { isPublished: true, isAdult: false },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 10_000,
    });

    return [
      ...staticEntries,
      ...works.map((work) => ({
        url: absoluteUrl(`/explore/${work.id}`),
        lastModified: work.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];
  } catch (error) {
    console.error("[sitemap] Unable to load public works; serving static URLs only.", error);
    return staticEntries;
  }
}
