import { cn } from "@/lib/utils";

type Tone = "green" | "yellow" | "red" | "blue" | "purple" | "orange" | "slate";

const tones: Record<Tone, string> = {
  green: "bg-[#eefbf1] text-[#17823a] border-[#ccefd6]",
  yellow: "bg-[#fff6e5] text-[#d97706] border-[#ffe0a3]",
  red: "bg-[#fff1f1] text-[#ef4444] border-[#fecaca]",
  blue: "bg-[#eef2ff] text-[#2563eb] border-[#d6ddff]",
  purple: "bg-[#f4edff] text-[#7c3aed] border-[#e3d5ff]",
  orange: "bg-[#fff6e8] text-[#f97316] border-[#ffe2bf]",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
};

export function Pill({
  children,
  tone = "slate",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center min-h-[24px] px-2.5 rounded-md border text-[13px] whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
