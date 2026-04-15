"use client";

import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  Cog,
  Download,
  FileText,
  Image,
  PackageCheck,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { FreightBadge } from "@/components/ui/status-badge";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
import { useCallback, useState } from "react";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Arquivo = {
  id: string;
  tipo: string;
  nome_arquivo: string;
  storage_path: string;
  storage_bucket: string;
  tamanho_bytes: number;
};

type KanbanExpedition = {
  id: string;
  forma_frete: string;
  nf_ids: number[];
  status: string;
  erro_detalhe: string | null;
  created_at: string;
  tiny_agrupamento_id: number | null;
  arquivos: Arquivo[];
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

type ColumnId = "pendente" | "em_producao" | "finalizado";

type KanbanColumn = {
  id: ColumnId;
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
  const queryClient = useQueryClient();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnId | null>(null);

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

  const updateStatus = useCallback(
    async (expeditionId: string, status: ColumnId) => {
      try {
        const res = await fetch(`/api/producao/expedicoes/${expeditionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error("Falha ao atualizar");
        queryClient.invalidateQueries({ queryKey: ["producao-kanban"] });
        queryClient.invalidateQueries({ queryKey: ["pedidos-stats"] });
        if (status === "finalizado") {
          toast.success("Producao finalizada");
        }
      } catch {
        toast.error("Erro ao mover expedição");
      }
    },
    [queryClient]
  );

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colId: ColumnId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(colId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, colId: ColumnId) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      setDraggingId(null);
      setDropTarget(null);
      if (id) updateStatus(id, colId);
    },
    [updateStatus]
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  if (!data && isFetching)
    return <LoadingSpinner message="Carregando producao..." />;

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
      icon: <Cog size={16} />,
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
      items: data?.finalizado ?? [],
    },
  ];

  const totalItems = columns.reduce((s, c) => s + c.items.length, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-semibold text-ink">Producao</h1>

      {totalItems === 0 ? (
        <EmptyState
          message="Nenhuma expedicao em producao"
          sub="Selecione pedidos na tela de Gerar Molde para iniciar"
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {columns.map((col) => (
            <div
              key={col.id}
              className="flex flex-col min-h-[200px]"
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.id)}
            >
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
              <div
                className={cn(
                  "flex-1 rounded-b-xl border border-line bg-surface/30 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)] transition-colors",
                  dropTarget === col.id &&
                    draggingId &&
                    "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-700"
                )}
              >
                {col.items.length === 0 ? (
                  <p className="text-center text-xs text-ink-faint py-8">
                    {dropTarget === col.id
                      ? "Solte aqui"
                      : "Nenhuma expedicao"}
                  </p>
                ) : (
                  col.items.map((exp, i) => (
                    <ExpeditionCard
                      key={exp.id}
                      expedition={exp}
                      index={i}
                      isDragging={draggingId === exp.id}
                      onDragStart={(e) => handleDragStart(e, exp.id)}
                      onDragEnd={handleDragEnd}
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
// Expedition card with file attachments
// ──────────────────────────────────────────────

function ExpeditionCard({
  expedition: exp,
  index,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  expedition: KanbanExpedition;
  index: number;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
}) {
  const lote = exp.lotes_producao;
  const hasError = exp.status === "erro" || exp.erro_detalhe;
  const hasFiles = exp.arquivos.length > 0;

  const progress = lote
    ? Math.round(
        ((lote.itens_sucesso + lote.itens_erro) /
          Math.max(lote.total_itens, 1)) *
          100
      )
    : 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border border-line bg-paper shadow-sm hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-md cursor-grab active:cursor-grabbing transition-all animate-fade-in p-3",
        isDragging && "opacity-40 scale-95",
        hasError && "border-red-200 dark:border-red-900"
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Top row: freight + line + count */}
      <div className="flex items-center gap-2">
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
        {hasError && (
          <AlertTriangle size={12} className="text-red-500 ml-auto" />
        )}
      </div>

      {/* Progress bar */}
      {lote && lote.total_itens > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                lote.itens_erro > 0
                  ? "bg-danger"
                  : progress === 100
                  ? "bg-success"
                  : "bg-indigo-500"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[10px] text-ink-faint tabular-nums whitespace-nowrap">
            {lote.itens_sucesso}/{lote.total_itens}
          </span>
        </div>
      )}

      {/* Error detail */}
      {exp.erro_detalhe && (
        <p className="text-[10px] text-red-500 truncate">{exp.erro_detalhe}</p>
      )}

      {/* File attachments */}
      {hasFiles && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-line">
          {exp.arquivos.map((file) => (
            <FileChip key={file.id} file={file} />
          ))}
        </div>
      )}

      {/* Footer: date */}
      <p className="text-[10px] text-ink-faint">
        {formatDateTime(exp.created_at)}
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────
// File attachment chip
// ──────────────────────────────────────────────

function FileChip({ file }: { file: Arquivo }) {
  const isSvg = file.tipo === "svg";
  const Icon = isSvg ? Image : FileText;
  const sizeKb = Math.round(file.tamanho_bytes / 1024);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(`/api/arquivos/${file.id}/download`, "_blank");
  };

  return (
    <button
      onClick={handleDownload}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-colors",
        isSvg
          ? "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-400"
          : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-400"
      )}
    >
      <Icon size={10} />
      <span className="truncate max-w-[100px]">{file.nome_arquivo}</span>
      <span className="text-[9px] opacity-60">{sizeKb}KB</span>
      <Download size={9} className="opacity-50" />
    </button>
  );
}
