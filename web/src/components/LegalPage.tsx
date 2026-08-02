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
        <Link href="/" className="text-sm text-ink-muted hover:text-ink">
          <i className="fas fa-arrow-left mr-2" />
          {t("back")}
        </Link>
        <article className="legal-copy mt-6 rounded-3xl border border-line bg-black/[0.03] p-7 sm:p-10">
          <h1>{title}</h1>
          <p className="legal-updated">{t("updated", { date: updated })}</p>
          {children}
        </article>
      </main>
    </div>
  );
}
