"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Clock,
  Cog,
  PackageCheck,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { FreightBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type KanbanExpedition = {
  id: string;
  forma_frete: string;
  nf_ids: number[];
  status: string;
  created_at: string;
  lotes_producao: {
    id: string;
    status: string;
    linha_produto: string;
    total_itens: number;
    itens_sucesso: number;
    itens_erro: number;
    completed_at: string | null;
  } | null;
};

type KanbanColumn = {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  headerBg: string;
  items: KanbanExpedition[];
};

// ──────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────

export default function ProducaoPage() {
  const router = useRouter();

  const { data, isFetching } = useQuery({
    queryKey: ["producao-kanban"],
    queryFn: async () => {
      const res = await fetch("/api/producao/expedicoes");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 8_000,
    placeholderData: keepPreviousData,
  });

  if (!data && isFetching) return <LoadingSpinner message="Carregando producao..." />;

  const columns: KanbanColumn[] = [
    {
      id: "pendente",
      label: "Pendente",
      icon: <Clock size={16} />,
      color: "text-amber-600 dark:text-amber-400",
      headerBg: "bg-amber-50 dark:bg-amber-950/40",
      items: data?.pendente ?? [],
    },
    {
      id: "em_producao",
      label: "Em Producao",
      icon: <Cog size={16} className="animate-spin-slow" />,
      color: "text-indigo-600 dark:text-indigo-400",
      headerBg: "bg-indigo-50 dark:bg-indigo-950/40",
      items: data?.em_producao ?? [],
    },
    {
      id: "finalizado",
      label: "Finalizado",
      icon: <PackageCheck size={16} />,
      color: "text-emerald-600 dark:text-emerald-400",
      headerBg: "bg-emerald-50 dark:bg-emerald-950/40",
      items: data?.pronto ?? [],
    },
  ];

  const totalItems = columns.reduce((s, c) => s + c.items.length, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-semibold text-ink">Producao</h1>

      {totalItems === 0 ? (
        <EmptyState
          message="Nenhuma expedicao em producao"
          sub="Selecione pedidos na tela de Selecao para iniciar a producao"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {columns.map((col) => (
            <div key={col.id} className="flex flex-col min-h-[200px]">
              {/* Column header */}
              <div
                className={cn(
                  "flex items-center gap-2 px-4 py-3 rounded-t-xl border border-b-0 border-line",
                  col.headerBg
                )}
              >
                <span className={col.color}>{col.icon}</span>
                <h2 className="text-sm font-semibold text-ink">{col.label}</h2>
                <span className="ml-auto tabular-nums text-xs font-medium px-2 py-0.5 rounded-md bg-paper/80 text-ink-muted border border-line/50">
                  {col.items.length}
                </span>
              </div>

              {/* Column body */}
              <div className="flex-1 rounded-b-xl border border-line bg-surface/30 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
                {col.items.length === 0 ? (
                  <p className="text-center text-xs text-ink-faint py-8">
                    Nenhuma expedicao
                  </p>
                ) : (
                  col.items.map((exp, i) => (
                    <ExpeditionCard
                      key={exp.id}
                      expedition={exp}
                      index={i}
                      onClick={() => router.push(`/expedicoes/${exp.id}`)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// Expedition card
// ──────────────────────────────────────────────

function ExpeditionCard({
  expedition: exp,
  index,
  onClick,
}: {
  expedition: KanbanExpedition;
  index: number;
  onClick: () => void;
}) {
  const lote = exp.lotes_producao;
  const isProcessing = lote?.status === "processando";
  const isDone = lote?.status === "concluido";
  const hasError =
    lote?.status === "erro_parcial" || (lote && lote.itens_erro > 0);

  const progress = lote
    ? Math.round(
        ((lote.itens_sucesso + lote.itens_erro) /
          Math.max(lote.total_itens, 1)) *
          100
      )
    : 0;

  return (
    <div
      onClick={onClick}
      className="group relative flex items-center gap-3 rounded-xl border border-line bg-paper shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-md cursor-pointer transition-all animate-fade-in p-3"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Status indicator */}
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
          isDone && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950",
          isProcessing && "bg-indigo-50 text-indigo-600 dark:bg-indigo-950",
          hasError && "bg-red-50 text-red-600 dark:bg-red-950",
          !lote && "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
        )}
      >
        {isDone ? (
          <CheckCircle2 size={16} />
        ) : hasError ? (
          <AlertTriangle size={16} />
        ) : isProcessing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Play size={16} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <FreightBadge freight={exp.forma_frete} />
          {lote && (
            <span
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                lote.linha_produto === "uniquebox"
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400"
                  : "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400"
              )}
            >
              {lote.linha_produto === "uniquebox" ? "BOX" : "KIDS"}
            </span>
          )}
          <span className="text-[10px] text-ink-faint">
            {exp.nf_ids?.length ?? 0} pedidos
          </span>
        </div>

        {/* Progress bar */}
        {lote && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  hasError
                    ? "bg-danger"
                    : isDone
                    ? "bg-success"
                    : "bg-indigo-500"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[10px] text-ink-faint tabular-nums whitespace-nowrap">
              {lote.itens_sucesso}/{lote.total_itens}
              {lote.itens_erro > 0 && (
                <span className="text-danger ml-0.5">
                  ({lote.itens_erro} erro)
                </span>
              )}
            </span>
          </div>
        )}

        <p className="text-[10px] text-ink-faint mt-1">
          {formatDateTime(exp.created_at)}
        </p>
      </div>

      <ChevronRight
        size={14}
        className="text-ink-faint group-hover:text-ink transition-colors flex-shrink-0"
      />
    </div>
  );
}
