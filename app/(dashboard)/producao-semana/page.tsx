"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Printer } from "lucide-react";
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

  // Só produtos com sugestão de produção (> 0).
  const allRows = useMemo(
    () => (data?.rows ?? []).filter((r) => r.sugestao > 0),
    [data]
  );

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

  const itensParaProduzir = rows.filter((r) => sugestaoDe(r) > 0);

  function esc(s: string) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function imprimirPDF() {
    const win = window.open("", "_blank");
    if (!win) return;

    const dataStr = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    });

    const corpo = itensParaProduzir
      .map(
        (r) => `<tr>
          <td class="sku">${r.sku ? esc(r.sku) : "—"}</td>
          <td>${esc(r.modelo)}</td>
          <td class="qtd">${sugestaoDe(r)}</td>
          <td class="chk"></td>
        </tr>`
      )
      .join("");

    win.document.write(`<!doctype html><html lang="pt-BR"><head>
      <meta charset="utf-8" />
      <title>Produção da Semana — ${dataStr}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Arial, sans-serif; color: #18181b; margin: 32px; }
        h1 { font-size: 18px; margin: 0 0 2px; }
        .sub { font-size: 12px; color: #71717a; margin: 0 0 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #e4e4e7; }
        th { font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: #71717a; border-bottom: 2px solid #18181b; }
        .sku { font-family: ui-monospace, monospace; font-size: 12px; color: #52525b; white-space: nowrap; }
        .qtd { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
        th.qtd { text-align: right; }
        .chk { width: 28px; }
        .chk::before { content: ""; display: inline-block; width: 16px; height: 16px; border: 1.5px solid #a1a1aa; border-radius: 3px; vertical-align: middle; }
        @media print { body { margin: 12mm; } }
      </style></head><body>
      <h1>Produção da Semana</h1>
      <p class="sub">Lista para produzir — gerada em ${dataStr} · ${itensParaProduzir.length} itens${
        linha === "todos" ? "" : ` · ${linha}`
      }</p>
      <table>
        <thead><tr><th>SKU</th><th>Modelo</th><th class="qtd">Qtd</th><th></th></tr></thead>
        <tbody>${corpo}</tbody>
      </table>
      <script>window.onload = function(){ window.print(); }<\/script>
    </body></html>`);
    win.document.close();
  }

  if (!data && isFetching)
    return <LoadingSpinner message="Carregando consumo..." />;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Produção da Semana</h1>
        <button
          onClick={imprimirPDF}
          disabled={itensParaProduzir.length === 0}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
        >
          <Printer size={14} />
          Imprimir lista (PDF)
        </button>
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
