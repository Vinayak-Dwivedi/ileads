import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  hint?: string;
  className?: string;
}

const toneClass: Record<NonNullable<MetricCardProps["deltaTone"]>, string> = {
  up: "text-emerald-600",
  down: "text-red-500",
  neutral: "text-slate-500",
};

export function MetricCard({ label, value, delta, deltaTone = "neutral", hint, className }: MetricCardProps) {
  return (
    <article
      className={cn(
        "bg-white rounded-xl border border-slate-200 shadow-sm p-4 min-h-[120px] flex flex-col",
        className,
      )}
    >
      <label className="block text-slate-500 text-sm md:text-[15px]">{label}</label>
      <div className="text-[30px] md:text-[34px] leading-none text-slate-900 mt-2 font-medium">{value}</div>
      <div className="mt-auto pt-3">
        {delta ? (
          <span className={cn("text-[13px]", toneClass[deltaTone])}>
            {delta}
            {hint ? <span className="text-slate-400 ml-1">{hint}</span> : null}
          </span>
        ) : hint ? (
          <span className="text-[13px] text-slate-400">{hint}</span>
        ) : null}
      </div>
    </article>
  );
}
