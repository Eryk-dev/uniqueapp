"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search, X, Download, Eye } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";

export default function ArquivosPage() {
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["arquivos", typeFilter, search],
    queryFn: async () => {
      const res = await fetch("/api/arquivos/browse");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const batches = (data?.batches ?? []) as Array<{
    id: string;
    linha_produto: string;
    status: string;
    created_at: string;
    arquivos: Array<{
      id: string;
      tipo: string;
      nome_arquivo: string;
    }>;
  }>;

  const filtered = batches
    .map((b) => ({
      ...b,
      arquivos: b.arquivos.filter((f) => {
        if (typeFilter && f.tipo !== typeFilter) return false;
        if (search && !f.nome_arquivo.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    }))
    .filter((b) => b.arquivos.length > 0);

  const tabs: Tab[] = [
    { id: "", label: "Todos" },
    { id: "svg", label: "SVG" },
    { id: "pdf", label: "PDF" },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-lg font-semibold text-ink">Arquivos</h1>

      <Tabs tabs={tabs} activeTab={typeFilter} onChange={setTypeFilter} />

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome..."
          className="w-full rounded-xl border border-line bg-paper pl-9 pr-9 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink">
            <X size={15} />
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner message="Carregando arquivos..." />
      ) : filtered.length === 0 ? (
        <EmptyState message="Nenhum arquivo encontrado" icon={<FileText size={32} strokeWidth={1.5} />} />
      ) : (
        <div className="space-y-4">
          {filtered.map((batch) => (
            <div key={batch.id} className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-surface/50">
                <span className="font-mono text-[11px] text-ink-faint">
                  Lote {batch.id.slice(0, 8)}
                </span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                  batch.linha_produto === "uniquebox"
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-orange-100 text-orange-700"
                )}>
                  {batch.linha_produto === "uniquebox" ? "BOX" : "KIDS"}
                </span>
                <span className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] font-medium",
                  batch.status === "concluido"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                )}>
                  {batch.status}
                </span>
                <span className="text-[11px] text-ink-faint ml-auto">
                  {formatDate(batch.created_at)}
                </span>
              </div>

              <div className="divide-y divide-line">
                {batch.arquivos.map((f) => (
                  <div key={f.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                        f.tipo === "svg" ? "bg-violet-100 text-violet-700" : "bg-red-100 text-red-700"
                      )}>
                        {f.tipo}
                      </span>
                      <span className="text-sm text-ink truncate font-mono text-[11px]">
                        {f.nome_arquivo}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <a href={`/api/arquivos/${f.id}/view`} target="_blank" className="p-1.5 rounded-lg text-ink-faint hover:text-info hover:bg-blue-50 transition-colors">
                        <Eye size={14} />
                      </a>
                      <a href={`/api/arquivos/${f.id}/download`} className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors">
                        <Download size={14} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
