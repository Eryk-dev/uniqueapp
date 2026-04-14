"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  History,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Zap,
  FileText,
  Pen,
  Type,
} from "lucide-react";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import {
  StatusBadge,
  LineBadge,
  FreightBadge,
} from "@/components/ui/status-badge";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface PedidoCardProps {
  pedido: {
    id: string;
    numero: number;
    nome_cliente: string | null;
    linha_produto: string;
    status: string;
    forma_frete: string | null;
    itens_count: number;
    created_at: string;
    duplicado?: boolean;
    nf_emitida?: boolean;
    nf_autorizada?: boolean;
  };
  style?: React.CSSProperties;
}

type ItemProducao = {
  id: string;
  modelo: string;
  molde: string | null;
  fonte: string | null;
  personalizacao: string | null;
  has_personalizacao: boolean;
};

type Evento = {
  id: string;
  tipo: string;
  descricao: string;
  ator: string;
  created_at: string;
};

// ──────────────────────────────────────────────
// Step indicator dot
// ──────────────────────────────────────────────

function StepDot({
  letter,
  status,
  title,
}: {
  letter: string;
  status: "pending" | "in_progress" | "done";
  title: string;
}) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold leading-none",
        status === "done" &&
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
        status === "in_progress" &&
          "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
        status === "pending" &&
          "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600"
      )}
      title={title}
    >
      {letter}
    </span>
  );
}

// ──────────────────────────────────────────────
// Items panel (chevron expand)
// ──────────────────────────────────────────────

function ItemsPanel({ pedidoId }: { pedidoId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["pedido-detail", pedidoId],
    queryFn: async () => {
      const res = await fetch(`/api/pedidos/${pedidoId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const itens: ItemProducao[] = data?.itens ?? [];

  if (isLoading) {
    return <p className="text-xs text-ink-faint py-3">Carregando itens...</p>;
  }

  if (itens.length === 0) {
    return <p className="text-xs text-ink-faint py-3">Nenhum item encontrado</p>;
  }

  return (
    <div className="space-y-2">
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
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────
// History timeline (clock expand)
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

function HistoryTimeline({ pedidoId }: { pedidoId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["pedido-detail", pedidoId],
    queryFn: async () => {
      const res = await fetch(`/api/pedidos/${pedidoId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const eventos: Evento[] = data?.eventos ?? [];

  if (isLoading) {
    return <p className="text-xs text-ink-faint py-3">Carregando historico...</p>;
  }

  if (eventos.length === 0) {
    return <p className="text-xs text-ink-faint py-3">Nenhum evento registrado</p>;
  }

  return (
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
  );
}

// ──────────────────────────────────────────────
// Main card
// ──────────────────────────────────────────────

export function PedidoCard({ pedido, style }: PedidoCardProps) {
  const router = useRouter();
  const [itemsOpen, setItemsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isBox = pedido.linha_produto?.toUpperCase() === "UNIQUEBOX";

  const dStatus: "pending" | "done" = pedido.duplicado ? "done" : "pending";
  const nStatus: "pending" | "in_progress" | "done" = pedido.nf_autorizada
    ? "done"
    : pedido.nf_emitida
    ? "in_progress"
    : "pending";

  return (
    <div
      style={style}
      className={cn(
        "group relative rounded-xl border border-line bg-paper shadow-sm",
        "transition-all duration-150 animate-fade-in",
        (itemsOpen || historyOpen)
          ? "border-zinc-300 dark:border-zinc-600 shadow-md"
          : "hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-md"
      )}
    >
      {/* Left color strip */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl",
          isBox ? "bg-uniquebox" : "bg-uniquekids"
        )}
      />

      {/* Main row */}
      <div className="flex items-center gap-3 py-4 pl-5 pr-3">
        {/* Clickable body → navigate to detail */}
        <div
          onClick={() => router.push(`/pedidos/${pedido.id}`)}
          className="flex-1 min-w-0 cursor-pointer"
        >
          <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
            <span className="font-mono text-sm font-bold text-ink">
              #{pedido.numero}
            </span>
            <LineBadge line={pedido.linha_produto?.toUpperCase()} />
            <StatusBadge status={pedido.status} />
          </div>

          <p className="text-base text-ink truncate">
            {pedido.nome_cliente || "Sem cliente"}
          </p>

          <div className="flex items-center gap-2.5 mt-2 flex-wrap">
            <FreightBadge freight={pedido.forma_frete || "-"} />
            <span className="text-xs text-ink-faint">
              {pedido.itens_count} {pedido.itens_count === 1 ? "item" : "itens"}
            </span>
            <span className="text-xs text-ink-faint">
              {formatDate(pedido.created_at)}
            </span>
          </div>
        </div>

        {/* Right side: dots + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Step indicators */}
          <div className="hidden sm:flex items-center gap-1" aria-label="Etapas do pedido">
            <StepDot
              letter="D"
              status={dStatus}
              title={pedido.duplicado ? "Pedido duplicado" : "Duplicacao pendente"}
            />
            <StepDot
              letter="N"
              status={nStatus}
              title={
                pedido.nf_autorizada
                  ? "NF autorizada"
                  : pedido.nf_emitida
                  ? "NF emitida — aguardando SEFAZ"
                  : "NF pendente"
              }
            />
          </div>

          {/* History toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHistoryOpen((v) => !v);
              if (!historyOpen) setItemsOpen(false);
            }}
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition-colors",
              historyOpen
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-ink-faint hover:text-ink hover:bg-surface"
            )}
            title="Ver historico"
          >
            <History size={14} />
          </button>

          {/* Items chevron toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setItemsOpen((v) => !v);
              if (!itemsOpen) setHistoryOpen(false);
            }}
            className={cn(
              "shrink-0 rounded-lg p-1.5 transition-colors",
              itemsOpen
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-ink-faint hover:text-ink hover:bg-surface"
            )}
            title="Ver itens"
          >
            <ChevronDown
              size={14}
              className={cn(
                "transition-transform duration-200",
                itemsOpen && "rotate-180"
              )}
            />
          </button>
        </div>
      </div>

      {/* Expanded: items + personalization */}
      {itemsOpen && (
        <div className="border-t border-line px-5 py-4 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-b-xl">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-3">
            Itens &amp; Personalizacao
          </p>
          <ItemsPanel pedidoId={pedido.id} />
        </div>
      )}

      {/* Expanded: history timeline */}
      {historyOpen && (
        <div className="border-t border-line px-5 py-4 bg-zinc-50/50 dark:bg-zinc-900/30 rounded-b-xl">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-3">
            Historico
          </p>
          <HistoryTimeline pedidoId={pedido.id} />
        </div>
      )}
    </div>
  );
}
