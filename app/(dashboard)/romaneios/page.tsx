"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Truck,
  ChevronRight,
  ClipboardList,
  Printer,
  Loader2,
  Trash2,
} from "lucide-react";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { FreightBadge, LineBadge } from "@/components/ui/status-badge";
import { Tabs, type Tab } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { EMITENTE } from "@/lib/emitente";
import { toast } from "sonner";

type ItemPendente = {
  tiny_nf_id: number;
  numero_nf: number | null;
  pedido_id: string | null;
  numero_pedido: number | null;
  nome_cliente: string | null;
  linha_produto: string | null;
  cidade: string | null;
  uf: string | null;
  expedicao_id: string;
  numero_expedicao: number | null;
  expedido_em: string;
};

type GrupoPendente = {
  transportadora: string;
  total: number;
  itens: ItemPendente[];
};

type Romaneio = {
  id: string;
  numero: number;
  transportadora: string;
  total_volumes: number;
  observacoes: string | null;
  created_at: string;
};

/** Linha impressa — vale tanto pro romaneio novo quanto pra reimpressao. */
type LinhaImpressa = {
  numero_nf: number | null;
  numero_pedido: number | null;
  nome_cliente: string | null;
  linha_produto: string | null;
  cidade: string | null;
  uf: string | null;
  numero_expedicao: number | null;
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Abre a folha do romaneio numa aba e dispara o print.
 * Mesmo caminho da Produção da Semana — HTML + window.print(), sem
 * gerar PDF no servidor.
 */
function imprimirRomaneio(
  romaneio: { numero: number; transportadora: string; created_at: string; observacoes?: string | null },
  itens: LinhaImpressa[]
) {
  const win = window.open("", "_blank");
  if (!win) {
    toast.error("Libere pop-ups pra imprimir o romaneio");
    return;
  }

  const dataStr = new Date(romaneio.created_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  const numeroStr = String(romaneio.numero).padStart(5, "0");

  const corpo = itens
    .map((item, i) => {
      const cidadeUf = [item.cidade, item.uf].filter(Boolean).join(" - ");
      const linha =
        item.linha_produto === "uniquekids"
          ? "KIDS"
          : item.linha_produto === "uniquebox"
          ? "BOX"
          : "—";
      return `<tr>
        <td class="idx">${i + 1}</td>
        <td class="mono">${item.numero_nf ?? "—"}</td>
        <td class="mono">${item.numero_pedido ? `#${item.numero_pedido}` : "—"}</td>
        <td>${esc(item.nome_cliente ?? "—")}</td>
        <td>${cidadeUf ? esc(cidadeUf) : "—"}</td>
        <td class="linha">${linha}</td>
        <td class="mono">${item.numero_expedicao ?? "—"}</td>
        <td class="chk"></td>
      </tr>`;
    })
    .join("");

  win.document.write(`<!doctype html><html lang="pt-BR"><head>
    <meta charset="utf-8" />
    <title>Romaneio ${numeroStr} — ${esc(romaneio.transportadora)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Arial, sans-serif; color: #18181b; margin: 28px; }
      header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
               border-bottom: 2px solid #18181b; padding-bottom: 10px; margin-bottom: 14px; }
      .emitente { font-size: 12px; line-height: 1.5; }
      .emitente strong { font-size: 14px; }
      .titulo { text-align: right; }
      .titulo h1 { font-size: 15px; margin: 0 0 2px; letter-spacing: .04em; }
      .titulo .num { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
      .meta { display: flex; gap: 28px; font-size: 13px; margin-bottom: 14px; }
      .meta .rot { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #71717a; display: block; }
      .meta .val { font-weight: 600; }
      .obs { font-size: 12px; color: #52525b; margin: 0 0 14px; padding: 8px 10px; background: #fafafa;
             border-left: 3px solid #d4d4d8; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e4e4e7; }
      th { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: #71717a;
           border-bottom: 1.5px solid #18181b; }
      .mono { font-family: ui-monospace, monospace; white-space: nowrap; }
      .idx { width: 26px; color: #a1a1aa; font-variant-numeric: tabular-nums; }
      .linha { font-size: 10px; font-weight: 700; letter-spacing: .04em; color: #52525b; }
      .chk { width: 26px; }
      .chk::before { content: ""; display: inline-block; width: 14px; height: 14px;
                     border: 1.5px solid #a1a1aa; border-radius: 3px; vertical-align: middle; }
      .total { margin-top: 12px; font-size: 14px; font-weight: 700; }
      .assinatura { margin-top: 34px; border-top: 1px solid #e4e4e7; padding-top: 14px;
                    page-break-inside: avoid; }
      .assinatura p { font-size: 12px; margin: 0 0 26px; }
      .linhas { display: flex; gap: 26px; font-size: 11px; color: #71717a; }
      .linhas div { border-top: 1px solid #18181b; padding-top: 4px; }
      .l-nome { flex: 2; } .l-doc { flex: 1; } .l-ass { flex: 2; } .l-data { flex: 1; }
      @media print { body { margin: 12mm; } thead { display: table-header-group; } }
    </style></head><body>
    <header>
      <div class="emitente">
        <strong>${EMITENTE.razaoSocial}</strong><br />
        CNPJ ${EMITENTE.cnpj} · IE ${EMITENTE.ie}<br />
        ${EMITENTE.cidadeUf} · CEP ${EMITENTE.cep}
      </div>
      <div class="titulo">
        <h1>ROMANEIO DE ENTREGA</h1>
        <div class="num">Nº ${numeroStr}</div>
      </div>
    </header>

    <div class="meta">
      <div><span class="rot">Transportadora</span><span class="val">${esc(
        romaneio.transportadora
      )}</span></div>
      <div><span class="rot">Data de emissão</span><span class="val">${dataStr}</span></div>
      <div><span class="rot">Volumes</span><span class="val">${itens.length}</span></div>
    </div>

    ${romaneio.observacoes ? `<p class="obs">${esc(romaneio.observacoes)}</p>` : ""}

    <table>
      <thead><tr>
        <th></th><th>NF</th><th>Pedido</th><th>Destinatário</th>
        <th>Cidade / UF</th><th>Linha</th><th>Exp</th><th></th>
      </tr></thead>
      <tbody>${corpo}</tbody>
    </table>

    <p class="total">Total de volumes: ${itens.length}</p>

    <div class="assinatura">
      <p>Declaro ter recebido da ${EMITENTE.razaoSocial} os ${itens.length} volume(s)
         relacionados neste romaneio, em perfeitas condições aparentes.</p>
      <div class="linhas">
        <div class="l-nome">Nome legível</div>
        <div class="l-doc">RG / CPF</div>
        <div class="l-ass">Assinatura</div>
        <div class="l-data">Data</div>
      </div>
    </div>

    <script>window.onload = function(){ window.print(); }<\/script>
  </body></html>`);
  win.document.close();
}

export default function RomaneiosPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pendentes");
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  // Tudo vem marcado; desmarcar e' a excecao (o caso normal e' a
  // transportadora levar o dia inteiro). Guardar so' os desmarcados
  // sobrevive ao refetch de 15s sem re-selecionar nada na mao.
  const [desmarcados, setDesmarcados] = useState<Set<number>>(new Set());
  const [gerando, setGerando] = useState<string | null>(null);
  const [imprimindo, setImprimindo] = useState<string | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["romaneios"],
    queryFn: async () => {
      const res = await fetch("/api/romaneios");
      if (!res.ok) throw new Error("Falha ao carregar romaneios");
      return res.json();
    },
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });

  const pendentes: GrupoPendente[] = useMemo(() => data?.pendentes ?? [], [data]);
  const romaneios: Romaneio[] = data?.romaneios ?? [];

  const totalPendente = pendentes.reduce((s, g) => s + g.total, 0);

  const tabs: Tab[] = [
    { id: "pendentes", label: "Pendentes", count: totalPendente },
    { id: "romaneios", label: "Romaneios", count: romaneios.length },
  ];

  const selecionadosDo = (grupo: GrupoPendente) =>
    grupo.itens.filter((i) => !desmarcados.has(i.tiny_nf_id));

  function toggleItem(nfId: number) {
    setDesmarcados((prev) => {
      const next = new Set(prev);
      if (next.has(nfId)) next.delete(nfId);
      else next.add(nfId);
      return next;
    });
  }

  function toggleGrupo(grupo: GrupoPendente) {
    const todosMarcados = selecionadosDo(grupo).length === grupo.itens.length;
    setDesmarcados((prev) => {
      const next = new Set(prev);
      for (const item of grupo.itens) {
        if (todosMarcados) next.add(item.tiny_nf_id);
        else next.delete(item.tiny_nf_id);
      }
      return next;
    });
  }

  async function gerarRomaneio(grupo: GrupoPendente) {
    const selecionados = selecionadosDo(grupo);
    if (selecionados.length === 0) return;

    setGerando(grupo.transportadora);
    try {
      const res = await fetch("/api/romaneios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transportadora: grupo.transportadora,
          tiny_nf_ids: selecionados.map((i) => i.tiny_nf_id),
        }),
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Erro ao gerar romaneio");

      imprimirRomaneio(payload.romaneio, payload.itens);

      const ignorados: number[] = payload.ignorados ?? [];
      toast.success(
        `Romaneio ${payload.romaneio.numero} — ${payload.itens.length} volumes` +
          (ignorados.length ? ` (${ignorados.length} já romaneado(s), fora)` : "")
      );

      // Os itens saíram de pendentes; o estado de desmarcados que sobrar
      // referencia NFs que não existem mais nessa lista.
      setDesmarcados(new Set());
      queryClient.invalidateQueries({ queryKey: ["romaneios"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setGerando(null);
    }
  }

  async function reimprimir(romaneio: Romaneio) {
    setImprimindo(romaneio.id);
    try {
      const res = await fetch(`/api/romaneios/${romaneio.id}`);
      if (!res.ok) throw new Error("Falha ao carregar romaneio");
      const payload = await res.json();
      imprimirRomaneio(payload.romaneio, payload.itens);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setImprimindo(null);
    }
  }

  async function excluir(romaneio: Romaneio) {
    const ok = window.confirm(
      `Excluir o romaneio ${romaneio.numero} (${romaneio.transportadora})?\n\n` +
        `Os ${romaneio.total_volumes} pedidos voltam pra lista de pendentes.`
    );
    if (!ok) return;

    try {
      const res = await fetch(`/api/romaneios/${romaneio.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Erro ao excluir");
      }
      toast.success(`Romaneio ${romaneio.numero} excluído`);
      queryClient.invalidateQueries({ queryKey: ["romaneios"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro");
    }
  }

  if (!data && isFetching) return <LoadingSpinner message="Carregando romaneios..." />;

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-semibold text-ink">Romaneios</h1>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "pendentes" ? (
        pendentes.length === 0 ? (
          <EmptyState
            message="Nenhum pedido aguardando coleta"
            sub="Pedidos entram aqui quando a expedição chega em Finalizado na Produção"
            icon={<Truck size={32} strokeWidth={1.5} />}
          />
        ) : (
          <div className="space-y-3">
            {pendentes.map((grupo) => {
              const aberto = grupoAberto === grupo.transportadora;
              const selecionados = selecionadosDo(grupo);
              const isGerando = gerando === grupo.transportadora;
              const todosMarcados = selecionados.length === grupo.itens.length;

              return (
                <div
                  key={grupo.transportadora}
                  className="rounded-xl border border-line bg-paper shadow-sm overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 p-4">
                    <button
                      onClick={() =>
                        setGrupoAberto(aberto ? null : grupo.transportadora)
                      }
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <Truck size={20} className="text-ink-faint flex-shrink-0" />
                      <FreightBadge freight={grupo.transportadora} />
                      <span className="text-base font-medium text-ink">
                        {grupo.total} {grupo.total === 1 ? "pedido" : "pedidos"}
                      </span>
                      {selecionados.length !== grupo.total && (
                        <span className="text-xs text-ink-faint">
                          {selecionados.length} marcado
                          {selecionados.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </button>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => gerarRomaneio(grupo)}
                        disabled={isGerando || selecionados.length === 0}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-sm font-medium hover:opacity-90 active:scale-[0.97] disabled:opacity-50 transition-all"
                      >
                        {isGerando ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Printer size={14} />
                        )}
                        Gerar romaneio ({selecionados.length})
                      </button>
                      <button
                        onClick={() =>
                          setGrupoAberto(aberto ? null : grupo.transportadora)
                        }
                        className="p-1"
                      >
                        <ChevronRight
                          size={16}
                          className={cn(
                            "text-ink-faint transition-transform duration-200",
                            aberto && "rotate-90"
                          )}
                        />
                      </button>
                    </div>
                  </div>

                  {aberto && (
                    <div className="border-t border-line">
                      <label className="flex items-center gap-3 px-4 py-2.5 bg-surface/50 text-xs font-medium text-ink-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={todosMarcados}
                          onChange={() => toggleGrupo(grupo)}
                          className="w-4 h-4 rounded border-line accent-zinc-900"
                        />
                        {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
                      </label>

                      <div className="divide-y divide-line">
                        {grupo.itens.map((item) => {
                          const marcado = !desmarcados.has(item.tiny_nf_id);
                          const cidadeUf = [item.cidade, item.uf]
                            .filter(Boolean)
                            .join(" - ");
                          return (
                            <label
                              key={item.tiny_nf_id}
                              className={cn(
                                "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-surface/50",
                                !marcado && "opacity-45"
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                onChange={() => toggleItem(item.tiny_nf_id)}
                                className="w-4 h-4 rounded border-line accent-zinc-900 flex-shrink-0"
                              />
                              <span className="font-mono text-sm text-ink-muted w-16 flex-shrink-0">
                                {item.numero_nf ? `NF ${item.numero_nf}` : "—"}
                              </span>
                              <span className="font-mono text-sm font-bold text-ink w-20 flex-shrink-0">
                                {item.numero_pedido ? `#${item.numero_pedido}` : "—"}
                              </span>
                              {item.linha_produto && (
                                <LineBadge
                                  line={item.linha_produto.toUpperCase()}
                                />
                              )}
                              <span className="text-sm text-ink truncate flex-1">
                                {item.nome_cliente || "Sem cliente"}
                              </span>
                              <span className="text-xs text-ink-muted hidden sm:block w-40 truncate">
                                {cidadeUf || "—"}
                              </span>
                              <span className="text-xs text-ink-faint hidden md:block">
                                Exp {item.numero_expedicao ?? "—"} ·{" "}
                                {formatDate(item.expedido_em)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : romaneios.length === 0 ? (
        <EmptyState
          message="Nenhum romaneio gerado"
          icon={<ClipboardList size={32} strokeWidth={1.5} />}
        />
      ) : (
        <div className="space-y-2">
          {romaneios.map((romaneio, i) => (
            <div
              key={romaneio.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-paper p-4 shadow-sm animate-fade-in"
              style={{ animationDelay: `${i * 30}ms` }}
            >
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 font-mono text-sm font-bold text-ink">
                {romaneio.numero}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <FreightBadge freight={romaneio.transportadora} />
                </div>
                <p className="text-sm text-ink-muted">
                  {romaneio.total_volumes}{" "}
                  {romaneio.total_volumes === 1 ? "volume" : "volumes"} —{" "}
                  {formatDateTime(romaneio.created_at)}
                </p>
              </div>

              <button
                onClick={() => reimprimir(romaneio)}
                disabled={imprimindo === romaneio.id}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-sm font-medium text-ink hover:bg-surface disabled:opacity-50 transition-colors"
              >
                {imprimindo === romaneio.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Printer size={14} />
                )}
                Imprimir
              </button>
              <button
                onClick={() => excluir(romaneio)}
                title="Excluir romaneio e devolver os pedidos pra pendentes"
                className="p-2 rounded-lg text-ink-faint hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
