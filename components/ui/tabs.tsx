"use client";

import { cn } from "@/lib/utils";

export interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex items-center gap-0.5 p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/60">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150",
              activeTab === tab.id
                ? "bg-ink text-paper shadow-sm"
                : "text-ink-muted hover:text-ink hover:bg-white/60 dark:hover:bg-zinc-700/60"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "tabular-nums",
                  activeTab === tab.id
                    ? "text-paper/70"
                    : "text-ink-faint"
                )}
              >
                ({tab.count})
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
