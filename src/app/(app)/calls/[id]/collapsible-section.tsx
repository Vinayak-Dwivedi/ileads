"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="html-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-bold text-slate-800"
        aria-expanded={open}
      >
        <span>{title}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="border-t border-slate-100">{children}</div> : null}
    </section>
  );
}