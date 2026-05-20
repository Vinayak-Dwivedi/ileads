"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, type LucideIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function NavMain({
  items,
}: {
  items: {
    title: string;
    url: string;
    icon?: LucideIcon;
    isActive?: boolean;
    items?: {
      title: string;
      url?: string;
      onClick?: () => void;
    }[];
  }[];
}) {
  const pathname = usePathname();

  function isActive(url: string) {
    const normalized = pathname.replace(/^\/ileads-qms/, "") || "/";
    return normalized === url || normalized.startsWith(`${url}/`);
  }

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            asChild
            defaultOpen={item.isActive}
            className="group/collapsible"
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon ? <item.icon /> : null}
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items?.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      {subItem.onClick ? (
                        <SidebarMenuSubButton
                          onClick={subItem.onClick}
                          className="cursor-pointer"
                        >
                          <span>{subItem.title}</span>
                        </SidebarMenuSubButton>
                      ) : (
                        <SidebarMenuSubButton
                          asChild
                          isActive={subItem.url ? isActive(subItem.url) : false}
                          className={cn(
                            subItem.url &&
                              isActive(subItem.url) &&
                              "bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-100",
                          )}
                        >
                          <Link href={subItem.url || "#"}>
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      )}
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
