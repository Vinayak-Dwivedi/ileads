"use client";

import * as React from "react"
import { NavMain } from "@/features/dashboard/components/nav-main"
import { NavSecondary } from "@/features/dashboard/components/nav-secondary"
import { NavUser } from "@/features/dashboard/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { FileChartColumn } from "lucide-react"
import { useRouter } from "next/navigation"
import { withBasePath } from "@/lib/base-path"

export function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const router = useRouter()

  const navMain = React.useMemo(() => [
    {
      title: "QMS Audit",
      url: "/dashboard",
      icon: FileChartColumn,
      isActive: true,
      items: [
        {
          title: "Dashboard",
          url: "/dashboard",
        },
        {
          title: "Calls",
          url: "/calls",
        },
        {
          title: "Parameters",
          url: "/parameters",
        },
        {
          title: "Agents",
          url: "/agents",
        },
      ],
    }
  ], [])

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-14 justify-start data-[slot=sidebar-menu-button]:p-2!"
              onClick={() => router.push("/")}
            >
              <img src={withBasePath("/ileads-logo.png")} alt="iLeads" className="h-auto max-w-32" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavSecondary items={[]} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
