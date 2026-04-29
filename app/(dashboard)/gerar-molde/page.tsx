"use client";

import { useState } from "react";
import { useQueryClient, useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  Play,
  Loader2,
  Search,
  X,
  ChevronDown,
  Type,
  Pen,
  Image as ImageIcon,
  Box,
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
  tipo_personalizacao: string | null;
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

  const { data, isFetching } = useQuery({
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
    placeholderData: keepPreviousData,
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

    type SkippedPedido = {
      pedido_id: string;
      numero: number | null;
      nome_cliente: string | null;
      fotos_erro: number;
      fotos_pendente: number;
    };

    const formatSkipped = (skipped: SkippedPedido[]) =>
      skipped
        .map((s) => {
          const detalhes: string[] = [];
          if (s.fotos_pendente > 0) detalhes.push(`${s.fotos_pendente} pendente`);
          if (s.fotos_erro > 0) detalhes.push(`${s.fotos_erro} erro`);
          return `#${s.numero ?? "?"} ${s.nome_cliente ?? ""} (${detalhes.join(", ")})`;
        })
        .join("\n");

    try {
      const res = await fetch("/api/producao/gerar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pedido_ids: Array.from(selectedIds) }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === "fotos_com_problema" && Array.isArray(result.skipped)) {
          // Todos os pedidos foram pulados — mantem selecao e mostra lista
          toast.error(
            `Nenhum pedido pode ser gerado — fotos pendentes ou em erro:\n${formatSkipped(result.skipped)}`,
            { duration: 10000 }
          );
          return;
        }
        throw new Error(result.error || "Erro");
      }

      const expCount = result.total_expeditions;
      const skipped: SkippedPedido[] = result.skipped ?? [];
      const skippedIds = new Set(skipped.map((s) => s.pedido_id));

      toast.success(
        `${expCount} ${expCount === 1 ? "expedicao criada" : "expedicoes criadas"} — ${result.total_pedidos} pedidos`
      );

      if (skipped.length > 0) {
        toast.warning(
          `${skipped.length} ${skipped.length === 1 ? "pedido pulado" : "pedidos pulados"} por foto pendente/erro:\n${formatSkipped(skipped)}`,
          { duration: 10000 }
        );
      }

      // Mantem apenas os pulados selecionados (pra usuario ver e tratar)
      setSelectedIds(skippedIds);
      queryClient.invalidateQueries({ queryKey: ["producao-selecao"] });
      queryClient.invalidateQueries({ queryKey: ["producao-kanban"] });
      queryClient.invalidateQueries({ queryKey: ["pedidos-stats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao produzir");
    } finally {
      setGenerating(false);
    }
  }

  // Preview grouping — split by tipo_personalizacao then by frete
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));

  const kidsOrders = selectedOrders.filter((o) => o.linha_produto === "uniquekids");
  const boxOrders = selectedOrders.filter((o) => o.tipo_personalizacao === "uniquebox");
  const mistoOrders = selectedOrders.filter((o) => o.tipo_personalizacao === "bloco_misto");
  const blocoP = selectedOrders.filter((o) => o.tipo_personalizacao === "bloco_P");
  const blocoM = selectedOrders.filter((o) => o.tipo_personalizacao === "bloco_M");
  const blocoG = selectedOrders.filter((o) => o.tipo_personalizacao === "bloco_G");
  const boxBlocoP = selectedOrders.filter((o) => o.tipo_personalizacao === "box_bloco_P");
  const boxBlocoM = selectedOrders.filter((o) => o.tipo_personalizacao === "box_bloco_M");
  const boxBlocoG = selectedOrders.filter((o) => o.tipo_personalizacao === "box_bloco_G");

  function buildFreightPreview(items: PedidoRow[]) {
    const map = new Map<string, number>();
    for (const o of items) {
      const key = o.forma_frete || "Sem frete";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }

  const kidsPreview = buildFreightPreview(kidsOrders);
  const boxPreview = buildFreightPreview(boxOrders);
  const blocoPreviews: Array<{ size: 'P' | 'M' | 'G'; map: Map<string, number> }> = (
    [
      { size: 'P' as const, map: buildFreightPreview(blocoP) },
      { size: 'M' as const, map: buildFreightPreview(blocoM) },
      { size: 'G' as const, map: buildFreightPreview(blocoG) },
    ]
  ).filter((g) => g.map.size > 0);
  const boxBlocoPreviews: Array<{ size: 'P' | 'M' | 'G'; map: Map<string, number> }> = (
    [
      { size: 'P' as const, map: buildFreightPreview(boxBlocoP) },
      { size: 'M' as const, map: buildFreightPreview(boxBlocoM) },
      { size: 'G' as const, map: buildFreightPreview(boxBlocoG) },
    ]
  ).filter((g) => g.map.size > 0);
  // bloco_misto agrupa 1 expedicao por pedido (chave inclui pedido_id no agrupamento)
  const mistoExpeditionsCount = mistoOrders.length;
  const totalExpeditions =
    kidsPreview.size + boxPreview.size +
    blocoPreviews.reduce((sum, g) => sum + g.map.size, 0) +
    boxBlocoPreviews.reduce((sum, g) => sum + g.map.size, 0) +
    mistoExpeditionsCount;

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

        {/* Group preview — split by tipo_personalizacao */}
        {totalExpeditions > 0 && (
          <div className="space-y-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-line">
            <span className="text-sm text-ink-faint">
              Sera agrupado em {totalExpeditions}{" "}
              {totalExpeditions === 1 ? "expedicao" : "expedicoes"}:
            </span>

            {kidsPreview.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                  Kids
                </span>
                {Array.from(kidsPreview.entries()).map(([frete, count]) => (
                  <span
                    key={`kids-${frete}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-paper border border-line text-xs font-medium text-ink"
                  >
                    <FreightBadge freight={frete} />
                    <span className="text-ink-faint">{count}</span>
                  </span>
                ))}
              </div>
            )}

            {boxPreview.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                  Box
                </span>
                {Array.from(boxPreview.entries()).map(([frete, count]) => (
                  <span
                    key={`box-${frete}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-paper border border-line text-xs font-medium text-ink"
                  >
                    <FreightBadge freight={frete} />
                    <span className="text-ink-faint">{count}</span>
                  </span>
                ))}
              </div>
            )}

            {blocoPreviews.map((g) => (
              <div key={`bloco-${g.size}`} className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400">
                  Bloco {g.size}
                </span>
                {Array.from(g.map.entries()).map(([frete, count]) => (
                  <span
                    key={`bloco-${g.size}-${frete}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-paper border border-line text-xs font-medium text-ink"
                  >
                    <FreightBadge freight={frete} />
                    <span className="text-ink-faint">{count}</span>
                  </span>
                ))}
              </div>
            ))}

            {boxBlocoPreviews.map((g) => (
              <div key={`boxbloco-${g.size}`} className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-0.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-l text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
                    Box
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-r text-[10px] font-bold uppercase bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400">
                    Bloco {g.size}
                  </span>
                </div>
                {Array.from(g.map.entries()).map(([frete, count]) => (
                  <span
                    key={`boxbloco-${g.size}-${frete}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-paper border border-line text-xs font-medium text-ink"
                  >
                    <FreightBadge freight={frete} />
                    <span className="text-ink-faint">{count}</span>
                  </span>
                ))}
              </div>
            ))}

            {mistoExpeditionsCount > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                  Bloco Misto
                </span>
                <span className="text-xs text-ink-faint">
                  {mistoExpeditionsCount} {mistoExpeditionsCount === 1 ? "expedicao isolada" : "expedicoes isoladas"} (1 por pedido)
                </span>
              </div>
            )}
          </div>
        )}

        {/* Table */}
        {isFetching && !data ? (
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
                      Tipo
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

function TipoBadge({ tipo }: { tipo: string | null }) {
  if (!tipo) return <span className="text-xs text-ink-faint">-</span>;

  const blocoMatch = tipo.match(/^bloco_(P|M|G)$/);
  if (blocoMatch) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400">
        <ImageIcon size={10} />
        Bloco {blocoMatch[1]}
      </span>
    );
  }
  const boxBlocoMatch = tipo.match(/^box_bloco_(P|M|G)$/);
  if (boxBlocoMatch) {
    return (
      <div className="flex items-center gap-0.5">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-l text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
          <Box size={10} />
          Box
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-r text-[10px] font-bold uppercase bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400">
          <ImageIcon size={10} />
          Bloco {boxBlocoMatch[1]}
        </span>
      </div>
    );
  }
  if (tipo === "bloco_misto") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
        <ImageIcon size={10} />
        Bloco Misto
      </span>
    );
  }
  if (tipo === "uniquebox") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400">
        <Box size={10} />
        Box
      </span>
    );
  }
  return <span className="text-xs text-ink-faint">-</span>;
}

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
  const { data, isFetching } = useQuery({
    queryKey: ["pedido-itens", o.id],
    queryFn: async () => {
      const res = await fetch(`/api/pedidos/${o.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: expanded,
    placeholderData: keepPreviousData,
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
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
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
          <TipoBadge tipo={o.tipo_personalizacao} />
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
          <td colSpan={9} className="p-0">
            <div className="bg-zinc-50 dark:bg-zinc-900/50 border-t border-line px-6 py-3">
              {isFetching && !data ? (
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
