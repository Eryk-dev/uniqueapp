// ============================================================
// Romaneio de transportadora — montagem dos pendentes
//
// Uma linha de romaneio = uma NF = um volume/etiqueta. As NFs
// candidatas saem de `expedicoes` (criadas pelo Gerar Molde), cujo
// `forma_frete` e' o nome real da transportadora que o Tiny devolve
// em formaEnvio.nome — Loggi, Jadlog, Correios [Próprio]...
// (`pedidos.forma_frete` NAO serve: guarda a modalidade crua,
// "ECONÔMICA" / ".PACKAGE" / "SEDEX CONTRATO AG").
//
// "Pendente" = NF de expedicao FINALIZADA que ainda nao esta em nenhum
// romaneio. O UNIQUE em romaneio_itens.tiny_nf_id garante isso, entao
// pedido que a transportadora nao coletou hoje continua aparecendo
// amanha em vez de sumir com o filtro de data.
// ============================================================

import type { createServerClient } from "@/lib/supabase/server";

// Coluna final do kanban de producao (app/(dashboard)/producao): so' ai
// o pacote esta produzido, embalado e etiquetado — e' o que o motorista
// pode de fato levar e assinar. 'pendente'/'em_producao' ainda estao na
// bancada. (O 'criada' que aparece em lib/tiny/expedition.ts e' codigo
// morto: nem passa no CHECK atual da tabela.)
const STATUS_PRONTO = "finalizado";

// Modalidades sem motorista pra assinar romaneio.
const TRANSPORTADORAS_EXCLUIDAS = ["retirada", "avulso"];

export function isTransportadoraReal(formaFrete: string | null): boolean {
  const nome = (formaFrete ?? "").trim().toLowerCase();
  if (!nome) return true; // "Sem frete" aparece pro operador decidir, nao some calado
  return !TRANSPORTADORAS_EXCLUIDAS.some((t) => nome.includes(t));
}

// Janela de expedicoes consideradas. Precisa ser menor que o historico
// de romaneios (que nao tem janela) — senao NF antiga ja romaneada
// voltaria pra lista de pendentes.
const JANELA_DIAS = 60;

// Marco zero: tudo que foi expedido antes do lancamento da tela ja foi
// coletado pela transportadora no processo antigo (em papel). Sem esse
// piso, o primeiro acesso listaria ~600 volumes historicos como se
// estivessem esperando caminhao.
const INICIO_ROMANEIO = "2026-08-17T00:00:00-03:00";

// Supabase monta .in() na query string: lista grande estoura a URL e a
// query volta vazia SEM erro. Mesma defesa do /api/producao/gerar.
const CHUNK = 150;

function chunked<T>(ids: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

async function selectInChunks<Row, Id>(
  ids: Id[],
  run: (chunk: Id[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const c of chunked(ids)) {
    const { data, error } = await run(c);
    if (error) throw new Error(error.message);
    if (data) rows.push(...data);
  }
  return rows;
}

export type ItemPendente = {
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

export type Pendentes = {
  itens: ItemPendente[];
  /** tiny_nf_id -> transportadora (forma_frete da expedicao) */
  transportadoraPorNf: Map<number, string>;
};

/**
 * Monta as NFs prontas pra coleta que ainda nao entraram em romaneio,
 * com os dados de pedido/NF ja resolvidos.
 */
export async function carregarPendentes(
  supabase: ReturnType<typeof createServerClient>
): Promise<Pendentes> {
  const janela = new Date(Date.now() - JANELA_DIAS * 24 * 60 * 60 * 1000);
  const inicio = new Date(INICIO_ROMANEIO);
  const desde = (janela > inicio ? janela : inicio).toISOString();

  const { data: expedicoes, error: expErr } = await supabase
    .from("expedicoes")
    .select("id, forma_frete, numero_expedicao, nf_ids, created_at")
    .eq("status", STATUS_PRONTO)
    .gte("created_at", desde)
    .order("created_at", { ascending: false });

  if (expErr) throw new Error(expErr.message);

  const transportadoraPorNf = new Map<number, string>();
  const expedicaoPorNf = new Map<
    number,
    { id: string; numero_expedicao: number | null; created_at: string }
  >();

  for (const exp of expedicoes ?? []) {
    if (!isTransportadoraReal(exp.forma_frete)) continue;
    for (const raw of exp.nf_ids ?? []) {
      // nf_ids e' bigint[]: o PostgREST devolve os elementos como string.
      const nfId = Number(raw);
      if (!Number.isFinite(nfId)) continue;
      // Expedicoes vem da mais recente pra mais antiga; se a mesma NF
      // aparecer 2x (reprocessamento), a primeira vista ganha.
      if (expedicaoPorNf.has(nfId)) continue;
      transportadoraPorNf.set(nfId, exp.forma_frete?.trim() || "Sem frete");
      expedicaoPorNf.set(nfId, {
        id: exp.id,
        numero_expedicao: exp.numero_expedicao,
        created_at: exp.created_at,
      });
    }
  }

  const nfIds = Array.from(expedicaoPorNf.keys());
  if (nfIds.length === 0) return { itens: [], transportadoraPorNf };

  // Remove o que ja foi romaneado
  const jaRomaneadas = await selectInChunks<{ tiny_nf_id: number }, number>(nfIds, (chunk) =>
    supabase.from("romaneio_itens").select("tiny_nf_id").in("tiny_nf_id", chunk)
  );
  const romaneadas = new Set(jaRomaneadas.map((r) => Number(r.tiny_nf_id)));
  const pendentesIds = nfIds.filter((id) => !romaneadas.has(id));
  if (pendentesIds.length === 0) return { itens: [], transportadoraPorNf };

  const nfs = await selectInChunks<
    { tiny_nf_id: number; numero_nf: number | null; pedido_id: string },
    number
  >(pendentesIds, (chunk) =>
    supabase.from("notas_fiscais").select("tiny_nf_id, numero_nf, pedido_id").in("tiny_nf_id", chunk)
  );

  const pedidoIds = Array.from(new Set(nfs.map((n) => n.pedido_id).filter(Boolean)));
  const pedidos = await selectInChunks<
    {
      id: string;
      numero: number;
      nome_cliente: string | null;
      linha_produto: string;
      cidade: string | null;
      uf: string | null;
    },
    string
  >(pedidoIds, (chunk) =>
    supabase
      .from("pedidos")
      .select("id, numero, nome_cliente, linha_produto, cidade, uf")
      .in("id", chunk)
  );
  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));

  const itens: ItemPendente[] = [];
  for (const nf of nfs) {
    const nfId = Number(nf.tiny_nf_id);
    const exp = expedicaoPorNf.get(nfId);
    if (!exp) continue;
    const pedido = nf.pedido_id ? pedidoPorId.get(nf.pedido_id) : undefined;
    itens.push({
      tiny_nf_id: nfId,
      numero_nf: nf.numero_nf,
      pedido_id: nf.pedido_id ?? null,
      numero_pedido: pedido?.numero ?? null,
      nome_cliente: pedido?.nome_cliente ?? null,
      linha_produto: pedido?.linha_produto ?? null,
      cidade: pedido?.cidade ?? null,
      uf: pedido?.uf ?? null,
      expedicao_id: exp.id,
      numero_expedicao: exp.numero_expedicao,
      expedido_em: exp.created_at,
    });
  }

  itens.sort((a, b) => (b.numero_nf ?? 0) - (a.numero_nf ?? 0));

  return { itens, transportadoraPorNf };
}

/** Agrupa os pendentes por transportadora, do maior grupo pro menor. */
export function agruparPorTransportadora({ itens, transportadoraPorNf }: Pendentes) {
  const grupos = new Map<string, ItemPendente[]>();
  for (const item of itens) {
    const transportadora = transportadoraPorNf.get(item.tiny_nf_id) ?? "Sem frete";
    const lista = grupos.get(transportadora) ?? [];
    lista.push(item);
    grupos.set(transportadora, lista);
  }

  return Array.from(grupos.entries())
    .map(([transportadora, lista]) => ({
      transportadora,
      total: lista.length,
      itens: lista,
    }))
    .sort((a, b) => b.total - a.total);
}
