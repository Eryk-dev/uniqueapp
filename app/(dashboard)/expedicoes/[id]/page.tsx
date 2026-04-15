"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  ChevronLeft,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Download,
  FileText,
  Image,
  Loader2,
  Tag,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { FreightBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { PedidoCard } from "@/components/pedidos/pedido-card";
import { toast } from "sonner";

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
    placeholderData: keepPreviousData,
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

  const { expedition, orders, arquivos } = data;

  const statusConfig: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    pendente: { bg: "bg-amber-50 dark:bg-amber-950", text: "text-amber-700 dark:text-amber-400", icon: null },
    em_producao: { bg: "bg-indigo-50 dark:bg-indigo-950", text: "text-indigo-700 dark:text-indigo-400", icon: null },
    finalizado: { bg: "bg-emerald-50 dark:bg-emerald-950", text: "text-emerald-700 dark:text-emerald-400", icon: <CheckCircle2 size={12} /> },
    erro: { bg: "bg-red-50 dark:bg-red-950", text: "text-red-700 dark:text-red-400", icon: <AlertTriangle size={12} /> },
  };
  const sc = statusConfig[expedition.status] ?? statusConfig.pendente;

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
        {expedition.numero_expedicao && (
          <span className="text-sm font-semibold text-ink">EXP {expedition.numero_expedicao}</span>
        )}
        <FreightBadge freight={expedition.forma_frete} />
        <div className={cn("flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium", sc.bg, sc.text)}>
          {sc.icon}
          {expedition.status}
        </div>
      </div>

      {/* Action buttons */}
      <ActionButtons expeditionId={params.id as string} hasTinyAgrupamento={!!(expedition.tiny_agrupamento_id ?? expedition.tiny_expedicao_id)} />

      {/* Info card */}
      <div className="rounded-xl border border-line bg-paper p-4 shadow-sm">
        <div className="space-y-2 text-sm">
          <Row label="Tiny Agrupamento" value={
            (() => {
              const tinyId = expedition.tiny_agrupamento_id ?? expedition.tiny_expedicao_id;
              return tinyId ? (
                <a
                  href={`https://erp.olist.com/expedicao#edit/${tinyId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {tinyId}
                </a>
              ) : (
                <span className="font-mono text-[11px]">-</span>
              );
            })()
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

      {/* Files */}
      {arquivos?.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-3">
            Arquivos gerados ({arquivos.length})
          </h2>
          <div className="space-y-2">
            {arquivos.map((file: Record<string, unknown>) => {
              const isSvg = file.tipo === "svg";
              const Icon = isSvg ? Image : FileText;
              const sizeKb = Math.round((file.tamanho_bytes as number) / 1024);
              return (
                <a
                  key={file.id as string}
                  href={`/api/arquivos/${file.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center gap-3 rounded-xl border bg-paper p-3 shadow-sm hover:shadow-md transition-all",
                    isSvg ? "border-orange-200 dark:border-orange-900" : "border-blue-200 dark:border-blue-900"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    isSvg ? "bg-orange-50 text-orange-600 dark:bg-orange-950" : "bg-blue-50 text-blue-600 dark:bg-blue-950"
                  )}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{file.nome_arquivo as string}</p>
                    <p className="text-[10px] text-ink-faint">{sizeKb} KB — {(file.tipo as string).toUpperCase()}</p>
                  </div>
                  <Download size={14} className="text-ink-faint" />
                </a>
              );
            })}
          </div>
        </div>
      )}

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
                  itens_count: (order.itens_count as number) ?? 0,
                  created_at: order.created_at as string,
                  duplicado: order.duplicado as boolean,
                  nf_emitida: order.nf_emitida as boolean,
                  nf_autorizada: order.nf_autorizada as boolean,
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

function ActionButtons({
  expeditionId,
  hasTinyAgrupamento,
}: {
  expeditionId: string;
  hasTinyAgrupamento: boolean;
}) {
  const [loadingEtiquetas, setLoadingEtiquetas] = useState(false);

  const handleEtiquetas = async () => {
    setLoadingEtiquetas(true);
    try {
      const res = await fetch(`/api/expedicoes/${expeditionId}/etiquetas`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro");

      if (!data.urls?.length) {
        toast.error("Nenhuma etiqueta disponivel");
        return;
      }

      for (const url of data.urls) {
        window.open(url, "_blank");
      }
      toast.success(`${data.urls.length} etiqueta(s) baixada(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao buscar etiquetas");
    } finally {
      setLoadingEtiquetas(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={handleEtiquetas}
        disabled={!hasTinyAgrupamento || loadingEtiquetas}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
          hasTinyAgrupamento
            ? "bg-ink text-paper hover:opacity-90 active:scale-[0.97]"
            : "bg-zinc-100 text-zinc-400 cursor-not-allowed dark:bg-zinc-800"
        )}
      >
        {loadingEtiquetas ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} />}
        Baixar Etiquetas
      </button>
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
