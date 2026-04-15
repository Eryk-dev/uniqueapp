"use client";

import { useRouter } from "next/navigation";
import { Package, Columns3, PlusCircle, FileBox } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery, keepPreviousData } from "@tanstack/react-query";

const MODULES = [
  {
    href: "/pedidos",
    label: "Pedidos",
    description: "Esteira de pedidos por etapa",
    icon: Package,
    color: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
    accent: "group-hover:border-blue-300 dark:group-hover:border-blue-700",
    statKey: "total_pedidos",
  },
  {
    href: "/gerar-molde",
    label: "Gerar Molde",
    description: "Selecao de pedidos e geracao de moldes",
    icon: FileBox,
    color: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950 dark:text-cyan-400",
    accent: "group-hover:border-cyan-300 dark:group-hover:border-cyan-700",
    statKey: "pronto_producao",
  },
  {
    href: "/producao",
    label: "Producao",
    description: "Kanban de expedicoes em producao",
    icon: Columns3,
    color: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400",
    accent: "group-hover:border-indigo-300 dark:group-hover:border-indigo-700",
    statKey: "em_producao",
  },
  {
    href: "/avulso",
    label: "Avulso",
    description: "Criar pedidos manuais",
    icon: PlusCircle,
    color: "bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400",
    accent: "group-hover:border-orange-300 dark:group-hover:border-orange-700",
    statKey: null,
  },
];

export default function HomePage() {
  const router = useRouter();

  const { data: stats } = useQuery({
    queryKey: ["pedidos-stats"],
    queryFn: async () => {
      const res = await fetch("/api/pedidos/stats");
      if (!res.ok) return {};
      const data = await res.json();
      return data.counts as Record<string, number>;
    },
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">UNIQUE</h1>
        <p className="text-sm text-ink-muted mt-1">
          Selecione o modulo
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
        {MODULES.map((mod) => {
          const count = mod.statKey && stats ? stats[mod.statKey] : null;

          return (
            <button
              key={mod.href}
              onClick={() => router.push(mod.href)}
              className={cn(
                "group relative flex items-start gap-4 p-5 rounded-xl border border-line bg-paper shadow-sm",
                "hover:shadow-md transition-all duration-200 text-left",
                mod.accent
              )}
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                  mod.color
                )}
              >
                <mod.icon size={20} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">
                    {mod.label}
                  </h2>
                  {count != null && count > 0 && (
                    <span className="tabular-nums text-xs font-medium px-2 py-0.5 rounded-md bg-zinc-100 text-ink-muted dark:bg-zinc-800">
                      {count}
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-muted mt-0.5">
                  {mod.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
