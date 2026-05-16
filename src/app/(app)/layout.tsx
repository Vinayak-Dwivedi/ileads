import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-[#f5f6f8] text-[14px] text-slate-700">
      <Sidebar />
      <div className="min-h-screen transition-all duration-200 lg:ml-64">
        <main className="min-w-0 bg-[#f5f6f8]">
          {children}
        </main>
        <MobileNav />
      </div>
    </div>
  );
}
