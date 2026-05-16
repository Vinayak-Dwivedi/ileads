import { cn } from "@/lib/utils";

export function PageShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("p-4 md:p-6 pb-24 lg:pb-6", className)}>{children}</section>;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-500",
        className,
      )}
    >
      <p className="text-slate-700 font-medium">{title}</p>
      {description ? <p className="mt-1 text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
