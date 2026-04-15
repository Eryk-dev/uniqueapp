"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Truck,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { FreightBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { PedidoCard } from "@/components/pedidos/pedido-card";

export default function ExpeditionDetailPage() {
  const params = useParams();
  const router = useRouter();

  const { data, isFetching, error } = useQuery({
    queryKey: ["expedicao", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/expedicoes/${params.id}`);
      if (!res.ok) throw new Error("Expedicao nao encontrada");
      return res.json();
    },
    placeholderData: (prev: any) => prev,
  });

  if (!data && isFetching) return <LoadingSpinner message="Carregando expedicao..." />;

  if (error || !data?.expedition) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
        >
          <ChevronLeft size={16} />
          Voltar
        </button>
        <EmptyState message="Expedicao nao encontrada" />
      </div>
    );
  }

  const { expedition, orders } = data;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-1 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <Truck size={18} className="text-ink-faint" />
        <FreightBadge freight={expedition.forma_frete} />
        <div
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium",
            expedition.status === "criada"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400"
          )}
        >
          {expedition.status === "criada" ? (
            <CheckCircle2 size={12} />
          ) : (
            <AlertTriangle size={12} />
          )}
          {expedition.status}
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-xl border border-line bg-paper p-4 shadow-sm">
        <div className="space-y-2 text-sm">
          <Row label="Tiny Expedicao" value={
            <span className="font-mono text-[11px]">
              {expedition.tiny_expedicao_id ?? "-"}
            </span>
          } />
          <Row label="NFs" value={expedition.nf_ids?.join(", ") || "-"} />
          <Row label="Criada em" value={formatDateTime(expedition.created_at)} />
          {expedition.erro_detalhe && (
            <Row
              label="Erro"
              value={
                <span className="text-danger text-xs">
                  {expedition.erro_detalhe}
                </span>
              }
            />
          )}
        </div>
      </div>

      {/* Orders in this expedition */}
      <div>
        <h2 className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-3">
          Pedidos nesta expedicao ({orders?.length ?? 0})
        </h2>

        {orders?.length > 0 ? (
          <div className="space-y-2">
            {orders.map((order: Record<string, unknown>, i: number) => (
              <PedidoCard
                key={order.id as string}
                pedido={{
                  id: order.id as string,
                  numero: order.numero as number,
                  nome_cliente: (order.nome_cliente as string) ?? null,
                  linha_produto: (order.linha_produto as string) ?? "",
                  status: (order.status as string) ?? "",
                  forma_frete: (order.forma_frete as string) ?? null,
                  itens_count: 0,
                  created_at: order.created_at as string,
                }}
                style={{ animationDelay: `${i * 30}ms` }}
              />
            ))}
          </div>
        ) : (
          <EmptyState message="Nenhum pedido encontrado nesta expedicao" />
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-ink-faint text-xs">{label}</span>
      <span className="text-ink text-sm text-right">{value}</span>
    </div>
  );
}
