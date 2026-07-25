import Link from "next/link";
import { GuestHeader } from "./GuestHeader";
import { useTranslations } from "next-intl";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("Legal");
  return (
    <div className="min-h-screen">
      <GuestHeader />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Link href="/" className="text-sm text-gray-400 hover:text-white">
          <i className="fas fa-arrow-left mr-2" />
          {t("back")}
        </Link>
        <article className="legal-copy mt-6 rounded-3xl border border-white/10 bg-white/[0.035] p-7 sm:p-10">
          <h1>{title}</h1>
          <p className="legal-updated">{t("updated", { date: updated })}</p>
          {children}
        </article>
      </main>
    </div>
  );
}
