"use client";

import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Clock,
  Cog,
  Download,
  FileText,
  Image,
  Loader2,
  PackageCheck,
  Tag,
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
  numero_expedicao: number | null;
  etiquetas_baixadas_em: string | null;
  conferencia_baixada_em: string | null;
  cnc_baixado_em: string | null;
  uv_baixado_em: string | null;
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

type LinhaFilter = "tudo" | "uniquebox" | "uniquekids";

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
  const [linhaFilter, setLinhaFilter] = useState<LinhaFilter>("tudo");

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

  const filterByLinha = useCallback(
    (items: KanbanExpedition[]) => {
      if (linhaFilter === "tudo") return items;
      return items.filter(
        (exp) => exp.lotes_producao?.linha_produto === linhaFilter
      );
    },
    [linhaFilter]
  );

  if (!data && isFetching)
    return <LoadingSpinner message="Carregando producao..." />;

  const columns: KanbanColumn[] = [
    {
      id: "pendente",
      label: "Pendente",
      icon: <Clock size={16} />,
      color: "text-amber-600 dark:text-amber-400",
      headerBg: "bg-amber-50 dark:bg-amber-950/40",
      items: filterByLinha(data?.pendente ?? []),
    },
    {
      id: "em_producao",
      label: "Em Producao",
      icon: <Cog size={16} />,
      color: "text-indigo-600 dark:text-indigo-400",
      headerBg: "bg-indigo-50 dark:bg-indigo-950/40",
      items: filterByLinha(data?.em_producao ?? []),
    },
    {
      id: "finalizado",
      label: "Finalizado",
      icon: <PackageCheck size={16} />,
      color: "text-emerald-600 dark:text-emerald-400",
      headerBg: "bg-emerald-50 dark:bg-emerald-950/40",
      items: filterByLinha(data?.finalizado ?? []),
    },
  ];

  const totalItems = columns.reduce((s, c) => s + c.items.length, 0);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink">Producao</h1>

        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          {(
            [
              { value: "tudo", label: "Tudo" },
              { value: "uniquebox", label: "UniqueBox" },
              { value: "uniquekids", label: "UniqueKids" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setLinhaFilter(opt.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                linhaFilter === opt.value
                  ? opt.value === "uniquebox"
                    ? "bg-indigo-100 text-indigo-700 shadow-sm dark:bg-indigo-950 dark:text-indigo-400"
                    : opt.value === "uniquekids"
                    ? "bg-orange-100 text-orange-700 shadow-sm dark:bg-orange-950 dark:text-orange-400"
                    : "bg-zinc-900 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-ink-muted hover:text-ink hover:bg-paper"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
  const queryClient = useQueryClient();
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

  const temSvg = exp.arquivos.some((a) => a.tipo === "svg");
  const temPng = exp.arquivos.some((a) => a.tipo === "png");

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
      {/* Title: EXP {numero} - {linha} */}
      {(exp.numero_expedicao || lote) && (
        <p className="text-xs font-semibold text-ink truncate">
          {exp.numero_expedicao ? `EXP ${exp.numero_expedicao}` : "EXP"}
          {lote ? ` - ${lote.linha_produto === "uniquebox" ? "Uniquebox" : "Uniquekids"}` : ""}
        </p>
      )}

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

      {/* Status-based action buttons */}
      {exp.status === "pendente" && (
        <DownloadActionButton
          expedition={exp}
          tipo="etiquetas-conferencia"
          onMarked={() => {
            queryClient.invalidateQueries({ queryKey: ["producao-kanban"] });
          }}
        />
      )}
      {exp.status === "em_producao" && (temSvg || temPng) && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {temSvg && (
            <DownloadActionButton
              expedition={exp}
              tipo="cnc"
              onMarked={() => {
                queryClient.invalidateQueries({ queryKey: ["producao-kanban"] });
              }}
            />
          )}
          {temPng && (
            <DownloadActionButton
              expedition={exp}
              tipo="uv"
              onMarked={() => {
                queryClient.invalidateQueries({ queryKey: ["producao-kanban"] });
              }}
            />
          )}
        </div>
      )}

      {/* File attachments — sempre lista os arquivos do banco + chip virtual de etiquetas */}
      {(hasFiles || exp.tiny_agrupamento_id) && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-line">
          {exp.arquivos.map((file) => (
            <FileChip key={file.id} file={file} />
          ))}
          {/* Chip virtual da etiqueta — sempre disponivel */}
          <EtiquetaChip expeditionId={exp.id} numeroExpedicao={exp.numero_expedicao} />
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
// Botao de acao por status (Pendente/Em producao)
// ──────────────────────────────────────────────

const ACTION_CONFIG: Record<
  "etiquetas-conferencia" | "cnc" | "uv",
  { label: string; downloadUrls: (expId: string) => string[]; doneFlag: keyof KanbanExpedition }
> = {
  "etiquetas-conferencia": {
    label: "Baixar etiquetas e conferência",
    downloadUrls: (id) => [`/api/expedicoes/${id}/etiquetas/pdf`, `/api/expedicoes/${id}/conferencia`],
    doneFlag: "etiquetas_baixadas_em",
  },
  cnc: {
    label: "Baixar CNC",
    downloadUrls: (id) => [`/api/expedicoes/${id}/cnc`],
    doneFlag: "cnc_baixado_em",
  },
  uv: {
    label: "Baixar UV",
    downloadUrls: (id) => [`/api/expedicoes/${id}/uv`],
    doneFlag: "uv_baixado_em",
  },
};

function DownloadActionButton({
  expedition,
  tipo,
  onMarked,
}: {
  expedition: KanbanExpedition;
  tipo: "etiquetas-conferencia" | "cnc" | "uv";
  onMarked: () => void;
}) {
  const cfg = ACTION_CONFIG[tipo];
  const isDone = !!expedition[cfg.doneFlag];
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone || loading) return;
    setLoading(true);
    try {
      // Baixa cada arquivo sequencialmente
      for (const url of cfg.downloadUrls(expedition.id)) {
        const res = await fetch(url);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Falha em ${url}`);
        }
        const blob = await res.blob();
        const disp = res.headers.get("Content-Disposition") ?? "";
        const m = disp.match(/filename="([^"]+)"/);
        const filename = m?.[1] ?? `download-${expedition.id}`;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      }

      // Marca como baixado
      const markRes = await fetch(`/api/expedicoes/${expedition.id}/marcar-download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo }),
      });
      if (!markRes.ok) {
        const data = await markRes.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao marcar");
      }

      toast.success(`${cfg.label.replace("Baixar ", "")} baixado`);
      onMarked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao baixar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isDone || loading}
      className={cn(
        "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all",
        isDone
          ? "bg-zinc-100 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600"
          : "bg-ink text-paper hover:opacity-90 active:scale-[0.97]",
        loading && "opacity-60"
      )}
    >
      {loading ? (
        <Loader2 size={12} className="animate-spin" />
      ) : isDone ? (
        <Check size={12} />
      ) : (
        <Download size={12} />
      )}
      {cfg.label}
    </button>
  );
}

// ──────────────────────────────────────────────
// Chip virtual da etiqueta (nao vem da tabela arquivos)
// ──────────────────────────────────────────────

function EtiquetaChip({
  expeditionId,
  numeroExpedicao,
}: {
  expeditionId: string;
  numeroExpedicao: number | null;
}) {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/expedicoes/${expeditionId}/etiquetas/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao buscar etiquetas");
      }
      const blob = await res.blob();
      const filename = numeroExpedicao
        ? `etiquetas-${numeroExpedicao}.pdf`
        : `etiquetas-${expeditionId}.pdf`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium transition-colors",
        "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
        "dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-400",
        loading && "opacity-60"
      )}
    >
      {loading ? <Loader2 size={10} className="animate-spin" /> : <Tag size={10} />}
      <span className="truncate max-w-[100px]">
        {numeroExpedicao ? `etiquetas-${numeroExpedicao}.pdf` : "etiquetas.pdf"}
      </span>
      <Download size={9} className="opacity-50" />
    </button>
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
