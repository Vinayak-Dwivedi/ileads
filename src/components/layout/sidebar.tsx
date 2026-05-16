"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, FileBarChart2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { withBasePath } from "@/lib/base-path";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calls", label: "Calls" },
  { href: "/parameters", label: "QA" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-full w-64 flex-col bg-gray-100 text-gray-700 transition-transform duration-300 lg:flex">
      <div className="px-2 py-6">
        <div className="mb-8 flex items-center px-4">
          <img src={withBasePath("/ileads-logo.png")} alt="iLeads" className="h-auto max-w-[130px]" />
        </div>
        <nav className="space-y-2">
          <div className="group space-y-3">
            <div className="relative rounded-lg px-4 py-3 text-gray-700 transition-colors hover:bg-white hover:text-black">
              <Link href="/dashboard" className="flex items-center gap-3">
                <FileBarChart2 className="h-5 w-5" />
                QMS Audit
              </Link>
              <ChevronDown className="absolute right-[15px] top-1/2 h-4 w-4 -translate-y-1/2 rotate-180" />
            </div>
            <ul className="mx-auto w-4/6 list-none space-y-2">
              {nav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "block w-full rounded-md px-3 py-1.5 text-sm capitalize text-gray-700 hover:bg-white hover:text-black",
                        active && "bg-white font-semibold text-black shadow-sm",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      </div>
      <form action={withBasePath("/api/auth/logout")} method="post" className="mt-auto px-6 pb-5">
        <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50">
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </form>
    </aside>
  );
}
