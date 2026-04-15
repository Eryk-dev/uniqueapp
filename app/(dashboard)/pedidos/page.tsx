"use client";

import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, X, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { PedidoCard } from "@/components/pedidos/pedido-card";

// Pipeline stages in order (left to right)
const PIPELINE_STAGES = [
  { id: "recebido", label: "Recebido" },
  { id: "aguardando_nf", label: "Aguardando NF" },
  { id: "pronto_producao", label: "Pronto Prod" },
  { id: "em_producao", label: "Em Producao" },
  { id: "produzido", label: "Produzido" },
  { id: "expedido", label: "Expedido" },
  { id: "erros", label: "Erros" },
] as const;

type PedidoRow = {
  id: string;
  numero: number;
  nome_cliente: string | null;
  linha_produto: string;
  status: string;
  forma_frete: string | null;
  itens_count: number;
  created_at: string;
  duplicado: boolean;
  nf_emitida: boolean;
  nf_autorizada: boolean;
};

export default function PedidosPage() {
  const [activeTab, setActiveTab] = useState("recebido");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 30;

  // Fetch tab counts
  const { data: stats } = useQuery({
    queryKey: ["pedidos-stats"],
    queryFn: async () => {
      const res = await fetch("/api/pedidos/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data = await res.json();
      return data.counts as Record<string, number>;
    },
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  // Build tabs with counts
  const tabs: Tab[] = PIPELINE_STAGES.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: stage.id === "erros" ? (stats?.erros ?? 0) : (stats?.[stage.id] ?? 0),
  }));

  // Determine which status(es) to query
  const statusParam =
    activeTab === "erros"
      ? "erro_fiscal,erro_enriquecimento,erro_producao"
      : activeTab;

  // Fetch orders for active tab
  const { data: ordersData, isFetching } = useQuery({
    queryKey: ["pedidos", activeTab, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });

      params.set("status", statusParam);

      if (search) params.set("busca", search);

      const res = await fetch(`/api/pedidos?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const orders: PedidoRow[] = ordersData?.data ?? [];
  const total = ordersData?.pagination?.total ?? 0;
  const totalPages = Math.ceil(total / perPage);

  function handleTabChange(tabId: string) {
    setActiveTab(tabId);
    setPage(1);
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Pedidos</h1>
        <span className="text-sm text-ink-faint tabular-nums">
          {total} {total === 1 ? "pedido" : "pedidos"}
        </span>
      </div>

      {/* Pipeline tabs */}
      <Tabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

      {/* Search bar */}
      <div className="relative">
        <Search
          size={17}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Buscar por cliente ou numero..."
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

      {/* Content */}
      {isFetching && !ordersData ? (
        <LoadingSpinner message="Carregando pedidos..." />
      ) : orders.length === 0 ? (
        <EmptyState
          message="Nenhum pedido nesta etapa"
          sub="Os pedidos aparecem aqui conforme avancam na esteira"
          icon={
            activeTab === "erros" ? (
              <AlertTriangle size={32} strokeWidth={1.5} />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {orders.map((pedido, i) => (
            <PedidoCard
              key={pedido.id}
              pedido={pedido}
              style={{ animationDelay: `${i * 30}ms` }}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line text-sm font-medium text-ink-muted hover:bg-paper disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
            Anterior
          </button>

          <span className="text-sm text-ink-faint tabular-nums">
            {page} / {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-line text-sm font-medium text-ink-muted hover:bg-paper disabled:opacity-30 transition-colors"
          >
            Proxima
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
