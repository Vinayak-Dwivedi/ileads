import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/features/dashboard-01/components/app-sidebar";
import { SiteHeader } from "@/features/dashboard-01/components/site-header";
import { SectionCards } from "@/features/dashboard-01/components/section-cards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    // <div className="min-h-screen bg-[#f5f6f8] text-[14px] text-slate-700">
    //   <Sidebar />
    //   <div className="min-h-screen transition-all duration-200 lg:ml-64">
    //     <main className="min-w-0 bg-[#f5f6f8]">
    //       {children}
    //     </main>
    //     <MobileNav />
    //   </div>
    // </div>
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 48)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        {children}
        {/* <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
              <SectionCards />
              <div className="px-4 lg:px-6">
                <ChartAreaInteractive />
              </div>
              <DataTable data={data} />
            </div>
          </div>
        </div> */}
      </SidebarInset>
    </SidebarProvider>
  );
}
