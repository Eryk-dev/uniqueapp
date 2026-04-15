"use client";

import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Truck,
  ChevronRight,
  Package,
  Plus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { FreightBadge, LineBadge } from "@/components/ui/status-badge";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

type Expedition = {
  id: string;
  lote_id: string | null;
  tiny_expedicao_id: number | null;
  forma_frete: string;
  nf_ids: number[];
  status: string;
  erro_detalhe: string | null;
  created_at: string;
};

type PendingGroup = {
  forma_frete: string;
  count: number;
  orders: {
    id: string;
    numero: number;
    nome_cliente: string | null;
    linha_produto: string;
    forma_frete: string | null;
    created_at: string;
  }[];
};

export default function ExpedicoesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pendentes");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["expedicoes"],
    queryFn: async () => {
      const res = await fetch("/api/expedicoes");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const expeditions: Expedition[] = data?.expeditions ?? [];
  const pendingGroups: PendingGroup[] = data?.pending_groups ?? [];

  const tabs: Tab[] = [
    { id: "pendentes", label: "Pendentes", count: pendingGroups.reduce((s, g) => s + g.count, 0) },
    { id: "criadas", label: "Criadas", count: expeditions.length },
  ];

  async function handleCreateExpedition(group: PendingGroup) {
    setCreatingGroup(group.forma_frete);
    try {
      const res = await fetch("/api/expedicoes/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forma_frete: group.forma_frete,
          pedido_ids: group.orders.map((o) => o.id),
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Erro ao criar expedicao");
      }

      toast.success(`Expedicao ${group.forma_frete} criada`);
      queryClient.invalidateQueries({ queryKey: ["expedicoes"] });
      queryClient.invalidateQueries({ queryKey: ["pedidos-stats"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setCreatingGroup(null);
    }
  }

  if (!data && isFetching) return <LoadingSpinner message="Carregando expedicoes..." />;

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-semibold text-ink">Expedicoes</h1>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "pendentes" ? (
        /* Pending groups */
        pendingGroups.length === 0 ? (
          <EmptyState
            message="Nenhum pedido pronto para expedicao"
            sub="Pedidos produzidos aparecem aqui agrupados por frete"
            icon={<Truck size={32} strokeWidth={1.5} />}
          />
        ) : (
          <div className="space-y-3">
            {pendingGroups.map((group) => {
              const isExpanded = expandedGroup === group.forma_frete;
              const isCreating = creatingGroup === group.forma_frete;

              return (
                <div
                  key={group.forma_frete}
                  className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden"
                >
                  {/* Group header */}
                  <button
                    onClick={() =>
                      setExpandedGroup(isExpanded ? null : group.forma_frete)
                    }
                    className="w-full flex items-center justify-between p-4 hover:bg-surface/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Truck size={20} className="text-ink-faint" />
                      <FreightBadge freight={group.forma_frete} />
                      <span className="text-base font-medium text-ink">
                        {group.count}{" "}
                        {group.count === 1 ? "pedido" : "pedidos"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCreateExpedition(group);
                        }}
                        disabled={isCreating}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
                      >
                        {isCreating ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Plus size={14} />
                        )}
                        Criar Expedicao
                      </button>
                      <ChevronRight
                        size={16}
                        className={cn(
                          "text-ink-faint transition-transform duration-200",
                          isExpanded && "rotate-90"
                        )}
                      />
                    </div>
                  </button>

                  {/* Expanded orders */}
                  {isExpanded && (
                    <div className="border-t border-line divide-y divide-line">
                      {group.orders.map((order) => (
                        <div
                          key={order.id}
                          onClick={() => router.push(`/pedidos/${order.id}`)}
                          className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface/50 cursor-pointer transition-colors"
                        >
                          <span className="font-mono text-sm font-bold text-ink">
                            #{order.numero}
                          </span>
                          <LineBadge
                            line={order.linha_produto?.toUpperCase()}
                          />
                          <span className="text-base text-ink truncate flex-1">
                            {order.nome_cliente || "Sem cliente"}
                          </span>
                          <span className="text-xs text-ink-faint">
                            {formatDate(order.created_at)}
                          </span>
                          <ChevronRight
                            size={16}
                            className="text-ink-faint"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* Created expeditions */
        expeditions.length === 0 ? (
          <EmptyState
            message="Nenhuma expedicao criada"
            icon={<Package size={32} strokeWidth={1.5} />}
          />
        ) : (
          <div className="space-y-2">
            {expeditions.map((exp, i) => (
              <div
                key={exp.id}
                onClick={() => router.push(`/expedicoes/${exp.id}`)}
                className="flex items-center gap-3 rounded-xl border border-line bg-paper p-4 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-md cursor-pointer transition-all animate-fade-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    exp.status === "criada"
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950"
                      : "bg-red-50 text-red-600 dark:bg-red-950"
                  )}
                >
                  {exp.status === "criada" ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertTriangle size={16} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FreightBadge freight={exp.forma_frete} />
                    {exp.tiny_expedicao_id && (
                      <a
                        href={`https://erp.olist.com/expedicao#edit/${exp.tiny_expedicao_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {exp.tiny_expedicao_id}
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-ink-muted">
                    {exp.nf_ids?.length ?? 0} NFs —{" "}
                    {formatDateTime(exp.created_at)}
                  </p>
                </div>

                <ChevronRight size={18} className="text-ink-faint" />
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
