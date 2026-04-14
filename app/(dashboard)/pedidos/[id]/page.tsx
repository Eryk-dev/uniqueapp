"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  RefreshCw,
  Package,
  FileText,
  Truck,
  Clock,
  Download,
  Eye,
  Pen,
  Type,
  CheckCircle2,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { StatusBadge, LineBadge, FreightBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
import { useState } from "react";
import type { PedidoDetail } from "@/lib/types";

// ──────────────────────────────────────────────
// Timeline helpers
// ──────────────────────────────────────────────

const EVENT_ICONS: Record<string, typeof Clock> = {
  status_change: CheckCircle2,
  api_call: Zap,
  file_generated: FileText,
  erro: AlertTriangle,
  expedicao_criada: CheckCircle2,
};

const EVENT_COLORS: Record<string, string> = {
  status_change: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  api_call: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  file_generated: "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400",
  erro: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  expedicao_criada: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
};

// ──────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────

export default function PedidoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  const {
    data: detail,
    isLoading,
    error,
  } = useQuery<PedidoDetail>({
    queryKey: ["pedido-detail", params.id],
    queryFn: async () => {
      const res = await fetch(`/api/pedidos/${params.id}`);
      if (!res.ok) throw new Error("Pedido nao encontrado");
      return res.json();
    },
  });

  async function handleRetry() {
    if (!detail?.lote || !detail.itens) return;
    const failedItems = detail.itens.filter((i) => i.status === "erro");
    if (!failedItems.length) return;

    setRetrying(true);
    try {
      const res = await fetch("/api/producao/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lote_id: detail.lote.id,
          item_ids: failedItems.map((i) => i.id),
        }),
      });
      if (!res.ok) throw new Error("Falha ao reprocessar");
      toast.success("Itens reenviados para producao");
      queryClient.invalidateQueries({ queryKey: ["pedido-detail", params.id] });
    } catch {
      toast.error("Erro ao reprocessar itens");
    } finally {
      setRetrying(false);
    }
  }

  if (isLoading) return <LoadingSpinner message="Carregando pedido..." />;

  if (error || !detail) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
        >
          <ChevronLeft size={16} />
          Voltar
        </button>
        <EmptyState message="Pedido nao encontrado" />
      </div>
    );
  }

  const { pedido, nota_fiscal, itens, lote, expedicao, arquivos, eventos } = detail;
  const hasFailedItems = itens.some((i) => i.status === "erro");
  const isBox = pedido.linha_produto?.toUpperCase() === "UNIQUEBOX";

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-mono text-lg font-bold">#{pedido.numero}</span>
          <LineBadge line={pedido.linha_produto?.toUpperCase()} />
          <StatusBadge status={pedido.status} />
        </div>

        {hasFailedItems && lote && (
          <button
            onClick={handleRetry}
            disabled={retrying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-all"
          >
            <RefreshCw size={13} className={cn(retrying && "animate-spin")} />
            {retrying ? "Reenviando..." : "Reprocessar Erros"}
          </button>
        )}
      </div>

      {/* Info cards grid */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Pedido info */}
        <div className="rounded-xl border border-line bg-paper p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Package size={15} className="text-ink-faint" />
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
              Pedido
            </h3>
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Cliente" value={pedido.nome_cliente || "-"} />
            <Row label="E-commerce" value={pedido.nome_ecommerce} />
            <Row label="Frete" value={<FreightBadge freight={pedido.forma_frete || "-"} />} />
            <Row label="Data" value={formatDate(pedido.data_pedido || pedido.created_at)} />
            <Row label="Tiny ID" value={<span className="font-mono text-[11px]">{pedido.tiny_pedido_id}</span>} />
          </div>
        </div>

        {/* NF info */}
        <div className="rounded-xl border border-line bg-paper p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={15} className="text-ink-faint" />
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
              Nota Fiscal
            </h3>
          </div>
          {nota_fiscal ? (
            <div className="space-y-2 text-sm">
              <Row label="Numero NF" value={nota_fiscal.numero_nf?.toString() ?? "-"} />
              <Row label="Modelo" value={nota_fiscal.modelo} />
              <Row
                label="Duplicado"
                value={
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded-full",
                    nota_fiscal.tiny_pedido_clone_id
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                      : "bg-zinc-100 text-zinc-500"
                  )}>
                    {nota_fiscal.tiny_pedido_clone_id ? "Sim" : "Nao"}
                  </span>
                }
              />
              <Row
                label="Status"
                value={
                  nota_fiscal.autorizada ? (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                      Autorizada
                    </span>
                  ) : (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                      Aguardando SEFAZ
                    </span>
                  )
                }
              />
              {nota_fiscal.autorizada_at && (
                <Row label="Autorizada em" value={formatDateTime(nota_fiscal.autorizada_at)} />
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-faint">Sem NF vinculada</p>
          )}
        </div>
      </div>

      {/* Items with personalization */}
      {itens.length > 0 && (
        <div className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-surface/50">
            <Package size={15} className="text-ink-faint" />
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
              Itens &amp; Personalizacao
            </h3>
            <span className="text-xs text-ink-faint">({itens.length})</span>
          </div>
          <div className="divide-y divide-line">
            {itens.map((item, i) => (
              <div key={item.id} className="flex items-start gap-3 px-5 py-3.5">
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold",
                    isBox
                      ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
                      : "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
                  )}
                >
                  {i + 1}
                </div>

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
                    <div className="flex items-start gap-1.5">
                      <Pen size={12} className="text-indigo-500 mt-0.5 flex-shrink-0" />
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

                  {item.erro_detalhe && (
                    <p className="text-xs text-danger mt-1">
                      {item.erro_detalhe}
                    </p>
                  )}
                </div>

                <span
                  className={cn(
                    "text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0",
                    item.status === "produzido" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40",
                    item.status === "pendente" && "bg-zinc-100 text-zinc-500 dark:bg-zinc-800",
                    item.status === "erro" && "bg-red-100 text-red-700 dark:bg-red-900/40"
                  )}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files */}
      {arquivos.length > 0 && (
        <div className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-surface/50">
            <FileText size={15} className="text-ink-faint" />
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
              Arquivos
            </h3>
            <span className="text-xs text-ink-faint">({arquivos.length})</span>
          </div>
          <div className="divide-y divide-line">
            {arquivos.map((arquivo) => (
              <div key={arquivo.id} className="px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                      arquivo.tipo === "svg"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40"
                        : "bg-red-100 text-red-700 dark:bg-red-900/40"
                    )}
                  >
                    {arquivo.tipo}
                  </span>
                  <span className="text-sm text-ink truncate font-mono text-[11px]">
                    {arquivo.nome_arquivo}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={`/api/arquivos/${arquivo.id}/view`}
                    target="_blank"
                    className="p-1.5 rounded-lg text-ink-faint hover:text-info hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors"
                  >
                    <Eye size={14} />
                  </a>
                  <a
                    href={`/api/arquivos/${arquivo.id}/download`}
                    className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors"
                  >
                    <Download size={14} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expedition */}
      {expedicao && (
        <div className="rounded-xl border border-line bg-paper p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Truck size={15} className="text-ink-faint" />
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
              Expedicao
            </h3>
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Frete" value={<FreightBadge freight={expedicao.forma_frete} />} />
            <Row label="Tiny ID" value={<span className="font-mono text-[11px]">{expedicao.tiny_expedicao_id ?? "-"}</span>} />
            <Row label="NFs" value={expedicao.nf_ids?.join(", ") || "-"} />
            <Row
              label="Status"
              value={
                expedicao.status === "criada" ? (
                  <span className="text-success font-medium">Criada</span>
                ) : (
                  <span className="text-danger font-medium">Erro</span>
                )
              }
            />
          </div>
        </div>
      )}

      {/* History timeline */}
      {eventos.length > 0 && (
        <div className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-line bg-surface/50">
            <Clock size={15} className="text-ink-faint" />
            <h3 className="text-xs font-semibold text-ink-faint uppercase tracking-wider">
              Historico
            </h3>
          </div>
          <div className="px-5 py-4">
            <div className="space-y-0">
              {eventos.map((ev, i) => {
                const Icon = EVENT_ICONS[ev.tipo] ?? Clock;
                const colorClass = EVENT_COLORS[ev.tipo] ?? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
                const isLast = i === eventos.length - 1;

                return (
                  <div key={ev.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0", colorClass)}>
                        <Icon size={12} />
                      </div>
                      {!isLast && <div className="w-px flex-1 bg-line min-h-[16px]" />}
                    </div>
                    <div className="pb-3 min-w-0">
                      <p className="text-sm text-ink leading-snug">{ev.descricao}</p>
                      <p className="text-[10px] text-ink-faint mt-0.5">
                        {formatDateTime(ev.created_at)}
                        {ev.ator !== "sistema" && ` — ${ev.ator}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
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
