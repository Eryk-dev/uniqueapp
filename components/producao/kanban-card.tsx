"use client";

import { cn, formatDate } from "@/lib/utils";
import { LineBadge, FreightBadge } from "@/components/ui/status-badge";
import { ArrowRight, Loader2 } from "lucide-react";

interface KanbanCardProps {
  pedido: {
    id: string;
    numero: number;
    nome_cliente: string | null;
    linha_produto: string;
    forma_frete: string | null;
    itens_count: number;
    created_at: string;
  };
  actions?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
    variant?: "primary" | "ghost";
  }[];
  onSelect?: (id: string) => void;
  selected?: boolean;
  style?: React.CSSProperties;
}

export function KanbanCard({
  pedido,
  actions,
  onSelect,
  selected,
  style,
}: KanbanCardProps) {
  const isBox = pedido.linha_produto?.toUpperCase() === "UNIQUEBOX";

  return (
    <div
      style={style}
      className={cn(
        "relative rounded-xl border bg-paper shadow-sm transition-all duration-150 animate-fade-in",
        selected
          ? "border-ink ring-1 ring-ink/20"
          : "border-line hover:border-zinc-300 dark:hover:border-zinc-600"
      )}
    >
      {/* Color strip */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1 rounded-l-xl",
          isBox ? "bg-uniquebox" : "bg-uniquekids"
        )}
      />

      <div className="p-3 pl-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            {onSelect && (
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onSelect(pedido.id)}
                className="rounded border-line"
              />
            )}
            <span className="font-mono text-xs font-bold text-ink">
              #{pedido.numero}
            </span>
            <LineBadge line={pedido.linha_produto?.toUpperCase()} />
          </div>
          <FreightBadge freight={pedido.forma_frete || "-"} />
        </div>

        {/* Client */}
        <p className="text-sm text-ink truncate mb-1">
          {pedido.nome_cliente || "Sem cliente"}
        </p>

        {/* Meta */}
        <div className="flex items-center gap-2 text-[11px] text-ink-faint">
          <span>
            {pedido.itens_count} {pedido.itens_count === 1 ? "item" : "itens"}
          </span>
          <span>{formatDate(pedido.created_at)}</span>
        </div>

        {/* Actions */}
        {actions && actions.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-line">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                }}
                disabled={action.loading}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all",
                  action.variant === "ghost"
                    ? "border border-line text-ink-muted hover:bg-surface"
                    : "bg-ink text-paper hover:opacity-90 active:scale-[0.97]",
                  action.loading && "opacity-50"
                )}
              >
                {action.loading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ArrowRight size={12} />
                )}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
