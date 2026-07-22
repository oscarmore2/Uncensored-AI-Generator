import { AppProvider } from "@/components/AppContext";
import { Header } from "@/components/Header";
import { AgeGate } from "@/components/AgeGate";
import { RechargeModal } from "@/components/RechargeModal";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AgeGate />
      <Header />
      <div className="max-w-7xl mx-auto px-6 pt-8 pb-16">{children}</div>
      <RechargeModal />
    </AppProvider>
  );
}
