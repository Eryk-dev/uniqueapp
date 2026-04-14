"use client";

import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  Play,
  Loader2,
  Search,
  X,
  ChevronDown,
  Type,
  Pen,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { LineBadge, FreightBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

type PedidoRow = {
  id: string;
  numero: number;
  nome_cliente: string | null;
  linha_produto: string;
  forma_frete: string | null;
  itens_count: number;
  created_at: string;
};

type ItemProducao = {
  id: string;
  modelo: string;
  molde: string | null;
  fonte: string | null;
  personalizacao: string | null;
  has_personalizacao: boolean;
};

export default function GerarMoldePage() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["producao-selecao", search],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: "pronto_producao",
        per_page: "200",
      });
      if (search) params.set("busca", search);
      const res = await fetch(`/api/pedidos?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const orders: PedidoRow[] = data?.data ?? [];

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (orders.length > 0 && orders.every((o) => selectedIds.has(o.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orders.map((o) => o.id)));
    }
  }

  function handleExpand(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setExpandedId(expandedId === id ? null : id);
  }

  async function handleProduzir() {
    if (selectedIds.size === 0) return;
    setGenerating(true);

    try {
      const res = await fetch("/api/producao/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_ids: Array.from(selectedIds) }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Erro");

      const expCount = result.total_expeditions;
      toast.success(
        `${expCount} ${expCount === 1 ? "expedicao criada" : "expedicoes criadas"} — ${result.total_pedidos} pedidos`
      );
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["producao-selecao"] });
      queryClient.invalidateQueries({ queryKey: ["producao-kanban"] });
      queryClient.invalidateQueries({ queryKey: ["pedidos-stats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao produzir");
    } finally {
      setGenerating(false);
    }
  }

  // Preview grouping
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const groupPreview = new Map<string, number>();
  for (const o of selectedOrders) {
    const key = o.forma_frete || "Sem frete";
    groupPreview.set(key, (groupPreview.get(key) ?? 0) + 1);
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-semibold text-ink">Gerar Molde</h1>

      <div className="space-y-3">
        {/* Action bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search
              size={17}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente ou numero..."
              className="w-full rounded-xl border border-line bg-paper pl-10 pr-10 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              >
                <X size={17} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {orders.length > 0 && (
              <button
                onClick={toggleAll}
                className="px-4 py-2 rounded-lg border border-line text-sm font-medium text-ink-muted hover:bg-paper transition-colors"
              >
                {selectedIds.size === orders.length
                  ? "Desmarcar"
                  : "Selecionar todos"}
              </button>
            )}

            <button
              onClick={handleProduzir}
              disabled={selectedIds.size === 0 || generating}
              className={cn(
                "flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-medium transition-all",
                selectedIds.size > 0
                  ? "bg-ink text-paper hover:opacity-90 active:scale-[0.97]"
                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed dark:bg-zinc-800"
              )}
            >
              {generating ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              {generating
                ? "Gerando..."
                : `Gerar${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
            </button>
          </div>
        </div>

        {/* Group preview */}
        {groupPreview.size > 0 && (
          <div className="flex items-center gap-2 flex-wrap p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-line">
            <span className="text-sm text-ink-faint">
              Sera agrupado em {groupPreview.size}{" "}
              {groupPreview.size === 1 ? "expedicao" : "expedicoes"}:
            </span>
            {Array.from(groupPreview.entries()).map(([frete, count]) => (
              <span
                key={frete}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-paper border border-line text-xs font-medium text-ink"
              >
                <FreightBadge freight={frete} />
                <span className="text-ink-faint">{count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <LoadingSpinner message="Carregando pedidos..." />
        ) : orders.length === 0 ? (
          <EmptyState
            message="Nenhum pedido pronto para producao"
            sub="Pedidos com NF autorizada aparecem aqui quando estao prontos"
          />
        ) : (
          <div className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface/50">
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={
                          orders.length > 0 &&
                          orders.every((o) => selectedIds.has(o.id))
                        }
                        onChange={toggleAll}
                        className="rounded border-line"
                      />
                    </th>
                    <th className="w-10 px-1 py-2.5" />
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Pedido
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Cliente
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Linha
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Frete
                    </th>
                    <th className="text-center px-3 py-2.5 text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Itens
                    </th>
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-ink-faint uppercase tracking-wide">
                      Data
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {orders.map((o) => {
                    const isExpanded = expandedId === o.id;
                    return (
                      <OrderRow
                        key={o.id}
                        order={o}
                        selected={selectedIds.has(o.id)}
                        expanded={isExpanded}
                        onToggleSelect={() => toggle(o.id)}
                        onToggleExpand={(e) => handleExpand(e, o.id)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Order row with expandable personalization
// ──────────────────────────────────────────────

function OrderRow({
  order: o,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: {
  order: PedidoRow;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["pedido-itens", o.id],
    queryFn: async () => {
      const res = await fetch(`/api/pedidos/${o.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: expanded,
  });

  const itens: ItemProducao[] = data?.itens ?? [];

  return (
    <>
      <tr
        onClick={onToggleSelect}
        className={cn(
          "cursor-pointer transition-colors",
          selected
            ? "bg-indigo-50/50 dark:bg-indigo-950/20"
            : "hover:bg-surface/50"
        )}
      >
        <td className="px-3 py-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="rounded border-line"
          />
        </td>
        <td className="px-1 py-2.5">
          <button
            onClick={onToggleExpand}
            className="p-1 rounded hover:bg-surface transition-colors"
          >
            <ChevronDown
              size={14}
              className={cn(
                "text-ink-faint transition-transform duration-200",
                expanded && "rotate-180"
              )}
            />
          </button>
        </td>
        <td className="px-3 py-2.5 font-mono text-sm font-bold">
          #{o.numero}
        </td>
        <td className="px-3 py-2.5 text-ink truncate max-w-[200px]">
          {o.nome_cliente || "-"}
        </td>
        <td className="px-3 py-2.5">
          <LineBadge line={o.linha_produto?.toUpperCase()} />
        </td>
        <td className="px-3 py-2.5">
          <FreightBadge freight={o.forma_frete || "-"} />
        </td>
        <td className="px-3 py-2.5 text-center tabular-nums text-ink-muted">
          {o.itens_count}
        </td>
        <td className="px-3 py-2.5 text-ink-faint text-xs">
          {formatDate(o.created_at)}
        </td>
      </tr>

      {/* Expanded: item personalization */}
      {expanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border-t border-line px-6 py-3">
              {isLoading ? (
                <p className="text-xs text-ink-faint py-2">Carregando itens...</p>
              ) : itens.length === 0 ? (
                <p className="text-xs text-ink-faint py-2">Nenhum item encontrado</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
                    Itens &amp; Personalizacao
                  </p>
                  {itens.map((item, i) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 rounded-lg bg-paper border border-line p-3"
                    >
                      <span className="text-xs font-mono text-ink-faint mt-0.5">
                        {i + 1}.
                      </span>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-ink">
                            {item.modelo}
                          </span>
                          {item.molde && (
                            <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs text-ink-muted">
                              {item.molde}
                            </span>
                          )}
                          {item.fonte && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-xs text-ink-muted">
                              <Type size={10} />
                              {item.fonte}
                            </span>
                          )}
                        </div>
                        {item.has_personalizacao && item.personalizacao && (
                          <div className="flex items-start gap-1.5 mt-1">
                            <Pen
                              size={12}
                              className="text-indigo-500 mt-0.5 flex-shrink-0"
                            />
                            <p className="text-sm text-ink break-all">
                              {item.personalizacao}
                            </p>
                          </div>
                        )}
                        {item.has_personalizacao && !item.personalizacao && (
                          <p className="text-xs text-amber-600 dark:text-amber-400">
                            Personalizacao marcada, mas sem texto
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
