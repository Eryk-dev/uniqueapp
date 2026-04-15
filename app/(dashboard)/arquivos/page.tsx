"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  FileText,
  Search,
  X,
  Download,
  Eye,
  ExternalLink,
  User,
  Hash,
  ShoppingBag,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";

interface BatchPedido {
  nome_cliente: string | null;
  id_pedido_ecommerce: string | null;
  numero: number;
  numero_nf: number | null;
}

interface BatchData {
  id: string;
  linha_produto: string;
  status: string;
  created_at: string;
  expedicao_id: string | null;
  pedidos: BatchPedido[];
  arquivos: Array<{
    id: string;
    tipo: string;
    nome_arquivo: string;
  }>;
}

export default function ArquivosPage() {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ["arquivos", typeFilter, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/arquivos/browse?${params}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const batches = (data?.batches ?? []) as BatchData[];

  const filtered = batches
    .map((b) => ({
      ...b,
      arquivos: typeFilter
        ? b.arquivos.filter((f) => f.tipo === typeFilter)
        : b.arquivos,
    }))
    .filter((b) => b.arquivos.length > 0);

  const handlePreview = useCallback(async (fileId: string) => {
    try {
      const res = await fetch(`/api/arquivos/${fileId}/view`);
      if (res.ok) {
        const data = await res.json();
        window.open(data.url, "_blank");
      }
    } catch {
      // silently fail
    }
  }, []);

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
        <Search
          size={15}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por cliente, nota fiscal, pedido Shopify ou nome do arquivo..."
          className="w-full rounded-xl border border-line bg-paper pl-9 pr-9 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-zinc-400 focus:outline-none transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {isLoading ? (
        <LoadingSpinner message="Carregando arquivos..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          message="Nenhum arquivo encontrado"
          icon={<FileText size={32} strokeWidth={1.5} />}
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((batch) => (
            <div
              key={batch.id}
              className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden"
            >
              {/* Batch header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-surface/50">
                <span className="font-mono text-[11px] text-ink-faint">
                  Lote {batch.id.slice(0, 8)}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                    batch.linha_produto === "uniquebox"
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-orange-100 text-orange-700"
                  )}
                >
                  {batch.linha_produto === "uniquebox" ? "BOX" : "KIDS"}
                </span>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    batch.status === "concluido"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-50 text-amber-700"
                  )}
                >
                  {batch.status}
                </span>
                <span className="text-[11px] text-ink-faint ml-auto">
                  {formatDate(batch.created_at)}
                </span>
                {batch.expedicao_id && (
                  <button
                    onClick={() =>
                      router.push(`/expedicoes/${batch.expedicao_id}`)
                    }
                    className="ml-1 p-1 rounded-lg text-ink-faint hover:text-info hover:bg-blue-50 transition-colors"
                    title="Ir para expedição"
                  >
                    <ExternalLink size={13} />
                  </button>
                )}
              </div>

              {/* Pedido info row */}
              {batch.pedidos.length > 0 && (
                <div className="px-4 py-2 border-b border-line bg-surface/30 flex flex-wrap gap-x-5 gap-y-1">
                  {batch.pedidos.slice(0, 5).map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 text-[11px] text-ink-muted"
                    >
                      {p.nome_cliente && (
                        <span className="flex items-center gap-1">
                          <User size={11} className="text-ink-faint" />
                          {p.nome_cliente}
                        </span>
                      )}
                      {p.numero_nf && (
                        <span className="flex items-center gap-1">
                          <Hash size={11} className="text-ink-faint" />
                          NF {p.numero_nf}
                        </span>
                      )}
                      {p.id_pedido_ecommerce && (
                        <span className="flex items-center gap-1">
                          <ShoppingBag size={11} className="text-ink-faint" />
                          {p.id_pedido_ecommerce}
                        </span>
                      )}
                    </div>
                  ))}
                  {batch.pedidos.length > 5 && (
                    <span className="text-[11px] text-ink-faint">
                      e mais {batch.pedidos.length - 5} pedidos
                    </span>
                  )}
                </div>
              )}

              {/* File rows */}
              <div className="divide-y divide-line">
                {batch.arquivos.map((f) => (
                  <div
                    key={f.id}
                    className={cn(
                      "flex items-center justify-between px-4 py-2.5",
                      batch.expedicao_id &&
                        "cursor-pointer hover:bg-surface/50 transition-colors"
                    )}
                    onClick={() => {
                      if (batch.expedicao_id) {
                        router.push(`/expedicoes/${batch.expedicao_id}`);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase",
                          f.tipo === "svg"
                            ? "bg-violet-100 text-violet-700"
                            : "bg-red-100 text-red-700"
                        )}
                      >
                        {f.tipo}
                      </span>
                      <span className="text-sm text-ink truncate font-mono text-[11px]">
                        {f.nome_arquivo}
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handlePreview(f.id)}
                        className="p-1.5 rounded-lg text-ink-faint hover:text-info hover:bg-blue-50 transition-colors"
                        title="Visualizar"
                      >
                        <Eye size={14} />
                      </button>
                      <a
                        href={`/api/arquivos/${f.id}/download`}
                        className="p-1.5 rounded-lg text-ink-faint hover:text-ink hover:bg-surface transition-colors"
                        title="Download"
                      >
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
