"use client";

import { useState } from "react";

interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface Props {
  tabs: TabItem[];
  initialId?: string;
}

export function DetailTabs({ tabs, initialId }: Props) {
  const fallbackId = tabs[0]?.id ?? "";
  const [activeId, setActiveId] = useState(initialId ?? fallbackId);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {tabs.map((tab) => {
          const isActive = tab.id === active?.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-[0_10px_18px_hsl(var(--primary)/0.25)]"
                  : "bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div>{active?.content}</div>
    </div>
  );
}
