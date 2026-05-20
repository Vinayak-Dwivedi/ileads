import { LogOut } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { Button } from "@/components/ui/button"

interface TopbarProps {
  title: string;
  crumb?: string;
  right?: React.ReactNode;
}

export async function Topbar({ title, crumb, right }: TopbarProps) {
  return (
    <header className="flex min-h-[72px] items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur md:px-7">
      <div className="flex items-center gap-4 min-w-0">
        <h2 className="m-0 text-xl font-semibold tracking-tight text-slate-800 leading-none md:text-[36px]">
          {title}
        </h2>
        {crumb ? (
          <div className="flex h-[42px] items-center border-l border-slate-300 pl-4 text-[28px] leading-none text-slate-500 md:text-[32px]">
            {crumb}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 md:gap-4">
        {right}
        <form action={withBasePath("/api/auth/logout")} method="post" className="hidden xl:block">
          {/* <button
            type="submit"
            className="html-btn"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button> */}
          <Button>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
