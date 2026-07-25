import type { Metadata } from "next";
import { AppProvider } from "@/components/AppContext";
import { Header } from "@/components/Header";
import { RechargeModal } from "@/components/RechargeModal";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Header />
      <div className="max-w-7xl mx-auto px-6 pt-8 pb-16">{children}</div>
      <RechargeModal />
    </AppProvider>
  );
}
