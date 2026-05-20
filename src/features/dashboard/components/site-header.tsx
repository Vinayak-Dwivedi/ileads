"use client"
import { usePathname } from 'next/navigation'
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"

const titles: Record<string, { title: string; eyebrow: string }> = {
  dashboard: { title: "Dashboard", eyebrow: "Quality overview" },
  calls: { title: "Calls", eyebrow: "Call library" },
  parameters: { title: "Parameters", eyebrow: "Audit setup" },
  agents: { title: "Agents", eyebrow: "Agent roster" },
}

export function SiteHeader() {
  const pathname = usePathname()
  const segment = pathname.replace(/^\/ileads-qms/, "").split("/").filter(Boolean)[0] || "dashboard"
  const current = titles[segment] ?? { title: "QMS", eyebrow: "Quality management" }

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b border-slate-200 bg-white/95 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-8"
        />
        <div className="min-w-0">
          {/* <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{current.eyebrow}</div> */}
          <h1 className="truncate text-base font-semibold text-slate-900">{current.title}</h1>
        </div>
        {/* <Badge variant="outline" className="ml-auto hidden border-blue-100 bg-blue-50 text-blue-700 sm:inline-flex">
          Demo ready
        </Badge> */}
      </div>
    </header>
  )
}
