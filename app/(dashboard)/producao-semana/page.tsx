"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";

type Row = {
  key: string;
  sku: string | null;
  modelo: string;
  linha_produto: string;
  ultima_semana: number;
  media_4: number;
  media_8: number;
  sugestao: number;
  parcial: number;
  sparkline: number[];
};

type Report = {
  generated_at: string;
  current_week_start: string;
  week_starts: string[];
  rows: Row[];
};

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-0.5 h-7" title={values.join(" · ")}>
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            "w-1.5 rounded-sm",
            i === values.length - 1 ? "bg-ink" : "bg-zinc-300 dark:bg-zinc-600"
          )}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export default function ProducaoSemanaPage() {
  const [linha, setLinha] = useState("todos");
  // Sugestões editadas pelo operador (sobrepõem a sugestão automática).
  const [edited, setEdited] = useState<Record<string, number>>({});

  const { data, isFetching } = useQuery<Report>({
    queryKey: ["producao-semana"],
    queryFn: async () => {
      const res = await fetch("/api/producao-semana");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const allRows = data?.rows ?? [];

  const counts = useMemo(
    () => ({
      todos: allRows.length,
      uniquebox: allRows.filter((r) => r.linha_produto === "uniquebox").length,
      uniquekids: allRows.filter((r) => r.linha_produto === "uniquekids").length,
    }),
    [allRows]
  );

  const rows = useMemo(
    () =>
      linha === "todos"
        ? allRows
        : allRows.filter((r) => r.linha_produto === linha),
    [allRows, linha]
  );

  const tabs: Tab[] = [
    { id: "todos", label: "Todos", count: counts.todos },
    { id: "uniquebox", label: "UniqueBox", count: counts.uniquebox },
    { id: "uniquekids", label: "UniqueKids", count: counts.uniquekids },
  ];

  const sugestaoDe = (r: Row) =>
    edited[r.key] !== undefined ? edited[r.key] : r.sugestao;

  function exportarCSV() {
    const header = [
      "SKU",
      "Modelo",
      "Linha",
      "Ultima semana",
      "Media 4 sem",
      "Media 8 sem",
      "Sugestao",
    ];
    const lines = rows.map((r) =>
      [
        r.sku ?? "",
        `"${r.modelo.replace(/"/g, '""')}"`,
        r.linha_produto,
        r.ultima_semana,
        r.media_4,
        r.media_8,
        sugestaoDe(r),
      ].join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `producao-semana-${data?.current_week_start ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!data && isFetching)
    return <LoadingSpinner message="Carregando consumo..." />;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Produção da Semana</h1>
        <button
          onClick={exportarCSV}
          disabled={rows.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
        >
          <Download size={14} />
          Exportar lista
        </button>
      </div>

      {/* Aviso de leitura */}
      <div className="flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 text-sm text-amber-900 dark:text-amber-200">
        <Info size={16} className="mt-0.5 flex-shrink-0" />
        <p>
          A <strong>sugestão</strong> parte da{" "}
          <strong>última semana completa</strong> e é{" "}
          <strong>editável</strong>. Perto de datas comemorativas (Dia dos
          Namorados, Mães, casamento) a demanda muda de 30× numa semana —
          confira a tendência das 8 semanas no gráfico e ajuste à mão. Histórico
          desde abr/2026, sem comparação ano a ano ainda.
        </p>
      </div>

      <Tabs tabs={tabs} activeTab={linha} onChange={setLinha} />

      {rows.length === 0 ? (
        <EmptyState
          message="Sem consumo no período"
          icon={<BarChart3 size={32} strokeWidth={1.5} />}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-paper shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-faint">
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">Modelo</th>
                <th className="px-4 py-3 font-medium">8 semanas</th>
                <th className="px-4 py-3 font-medium text-right">Últ. sem.</th>
                <th className="px-4 py-3 font-medium text-right">Méd. 4s</th>
                <th className="px-4 py-3 font-medium text-right">Méd. 8s</th>
                <th className="px-4 py-3 font-medium text-right">Sugestão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="hover:bg-surface/50 transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-muted whitespace-nowrap">
                    {r.sku ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-ink max-w-[280px] truncate">
                    {r.modelo}
                  </td>
                  <td className="px-4 py-2.5">
                    <Sparkline values={r.sparkline} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                    {r.ultima_semana}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {r.media_4}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">
                    {r.media_8}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <input
                      type="number"
                      min={0}
                      value={sugestaoDe(r)}
                      onChange={(e) =>
                        setEdited((prev) => ({
                          ...prev,
                          [r.key]: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className={cn(
                        "w-16 rounded-lg border border-line bg-surface px-2 py-1 text-right tabular-nums font-medium text-ink focus:border-ink focus:outline-none",
                        edited[r.key] !== undefined && "border-ink bg-paper"
                      )}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
