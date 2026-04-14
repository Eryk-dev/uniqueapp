import { cn } from "@/lib/utils";
import { Package } from "lucide-react";

interface EmptyStateProps {
  message: string;
  sub?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ message, sub, icon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 gap-3", className)}>
      <div className="text-ink-faint">
        {icon ?? <Package size={32} strokeWidth={1.5} />}
      </div>
      <p className="text-sm text-ink-muted font-medium">{message}</p>
      {sub && <p className="text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}
