import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  recebido: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  aguardando_nf: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  pronto_producao: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400",
  em_producao: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
  produzido: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  avulso_produzido: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-400",
  expedido: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  erro_fiscal: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  erro_enriquecimento: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  erro_producao: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

const STATUS_LABELS: Record<string, string> = {
  recebido: "Recebido",
  aguardando_nf: "Aguardando NF",
  pronto_producao: "Pronto Prod",
  em_producao: "Em Producao",
  produzido: "Produzido",
  avulso_produzido: "Avulso Prod",
  expedido: "Expedido",
  erro_fiscal: "Erro Fiscal",
  erro_enriquecimento: "Erro Enriq",
  erro_producao: "Erro Prod",
};

const LINE_STYLES: Record<string, string> = {
  UNIQUEBOX: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400",
  UNIQUEKIDS: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-zinc-100 text-zinc-600",
        className
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

interface LineBadgeProps {
  line: string;
  className?: string;
}

export function LineBadge({ line, className }: LineBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold tracking-wide",
        LINE_STYLES[line] ?? "bg-zinc-100 text-zinc-600",
        className
      )}
    >
      {line === "UNIQUEBOX" ? "BOX" : line === "UNIQUEKIDS" ? "KIDS" : line}
    </span>
  );
}

interface FreightBadgeProps {
  freight: string;
  className?: string;
}

const FREIGHT_STYLES: Record<string, string> = {
  Correios: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  Loggi: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400",
  Jadlog: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
  Braspress: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
  Retirada: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
};

export function FreightBadge({ freight, className }: FreightBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium",
        FREIGHT_STYLES[freight] ?? "bg-zinc-100 text-zinc-600",
        className
      )}
    >
      {freight || "-"}
    </span>
  );
}
