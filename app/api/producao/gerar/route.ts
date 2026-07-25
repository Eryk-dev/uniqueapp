import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";
import { createExpedition, fetchExpedition, completeExpedition } from "@/lib/tiny/client";
import { processUniqueBoxBatch, processUniqueKidsBatch } from "@/lib/generation";
import { cacheExpeditionLabels } from "@/lib/tiny/expedition";

const schema = z.object({
  pedido_ids: z.array(z.string().uuid()).min(1),
});

// ── Chunking de filtros .in() ───────────────────────────────────────────────
// O Supabase serializa o filtro .in() na URL (GET) ou no corpo/URL do PATCH.
// Com ~200+ UUIDs a URL passa do limite do gateway (~8KB) e a query volta vazia
// (sem erro) — foi o que travava o Gerar Molde com 500 pedidos: a busca
// principal voltava [] e a rota retornava 400 "Nenhum pedido valido encontrado".
// Quebra a lista em lotes seguros (~150 ids ~= 6KB) e concatena os resultados.
const IN_CHUNK_SIZE = 150;

function chunkIds<T>(ids: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    out.push(ids.slice(i, i + IN_CHUNK_SIZE));
  }
  return out;
}

async function selectInChunks<Row>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const c of chunkIds(ids)) {
    const { data, error } = await run(c);
    if (error) throw new Error(error.message);
    if (data) rows.push(...data);
  }
  return rows;
}

/**
 * Verifica se pedidos com itens de bloco têm fotos em erro/pendente.
 * Retorna lista detalhada se houver problema, ou null se tudo OK.
 */
async function checkBlocoFotosReady(
  pedidoIds: string[],
  supabase: ReturnType<typeof createServerClient>
): Promise<{
  itens: Array<{
    item_id: string;
    pedido_id: string;
    fotos_erro: number;
    fotos_pendente: number;
  }>;
} | null> {
  const data = await selectInChunks<{
    id: string;
    pedido_id: string;
    fotos_bloco: Array<{ status: string }>;
  }>(pedidoIds, (c) =>
    supabase
      .from('itens_producao')
      .select('id, pedido_id, fotos_bloco(status)')
      .in('pedido_id', c)
      .ilike('modelo', '%bloco%')
  );

  const problems: Array<{
    item_id: string;
    pedido_id: string;
    fotos_erro: number;
    fotos_pendente: number;
  }> = [];

  for (const item of data ?? []) {
    const fotos = (item.fotos_bloco as Array<{ status: string }>) ?? [];
    const erro = fotos.filter((f) => f.status === 'erro').length;
    const pendente = fotos.filter((f) => f.status === 'pendente').length;

    if (erro > 0 || pendente > 0) {
      problems.push({
        item_id: item.id,
        pedido_id: item.pedido_id,
        fotos_erro: erro,
        fotos_pendente: pendente,
      });
    }
  }

  return problems.length > 0 ? { itens: problems } : null;
}

/**
 * Defesa contra parsing falhado em personalizacao. Pedido com MENOS linhas em
 * fotos_bloco do que blocos (itens) indica que o parser do enrichment nao
 * extraiu alguma URL (formato exotico, label invalido, valor truncado em
 * posicao 1, etc) — sem esse gate o bloco entra no agrupamento Tiny mas some
 * da folha de conferencia e do PNG da chapa (cliente recebe pacote vazio).
 * Exp 4739/4742 (2026-05-27): 5 UB325 sumiram porque o Shopify mandou
 * "Foto: <url>" singular e a regex `Foto N:` nao casava.
 *
 * Balanco POR PEDIDO (nao por item): em pedido qty>1 o Tiny duplica a
 * personalizacao nos N itens e o dedup do enrichment concentra as fotos em
 * menos itens (item1=2 fotos, item2=0). A chapa renderiza 1 bloco por linha de
 * foto, entao o que importa e' total_fotos == total_blocos no pedido — item
 * vazio cujo irmao cobre as fotos e' esperado, nao anomalia.
 */
async function checkBlocoFotosAusentes(
  pedidoIds: string[],
  supabase: ReturnType<typeof createServerClient>
): Promise<{
  pedidos: Array<{ pedido_id: string; faltam: number }>;
} | null> {
  const data = await selectInChunks<{
    id: string;
    pedido_id: string;
    fotos_bloco: Array<{ id: string }>;
  }>(pedidoIds, (c) =>
    supabase
      .from('itens_producao')
      .select('id, pedido_id, fotos_bloco(id)')
      .in('pedido_id', c)
      .ilike('modelo', '%bloco%')
  );

  const porPedido = new Map<string, { blocos: number; fotos: number }>();
  for (const item of data ?? []) {
    const fotos = (item.fotos_bloco as Array<{ id: string }>) ?? [];
    const cur = porPedido.get(item.pedido_id) ?? { blocos: 0, fotos: 0 };
    cur.blocos += 1;
    cur.fotos += fotos.length;
    porPedido.set(item.pedido_id, cur);
  }

  const problems: Array<{ pedido_id: string; faltam: number }> = [];
  porPedido.forEach((v, pid) => {
    if (v.fotos < v.blocos) problems.push({ pedido_id: pid, faltam: v.blocos - v.fotos });
  });

  return problems.length > 0 ? { pedidos: problems } : null;
}

/**
 * Invariante UB325/326/327: 1 bloco = 1 foto. Pedido com MAIS linhas em
 * fotos_bloco do que blocos (itens) indica anomalia do app de personalizacao
 * do Shopify (cliente fez upload duplicado, ou multiplos slots por engano).
 * Sem esse gate, cada foto extra vira 1 slot no PNG da chapa — exp 4708/NF
 * 44851 saiu com 4 blocos quando eram 2 pedidos = 2 blocos.
 *
 * Balanco POR PEDIDO (ver checkBlocoFotosAusentes): em pedido qty>1 o dedup
 * concentra as fotos em menos itens, entao comparar >1 por item dava falso
 * positivo. O certo e' total_fotos > total_blocos no pedido.
 */
async function checkBlocoFotosExcedentes(
  pedidoIds: string[],
  supabase: ReturnType<typeof createServerClient>
): Promise<{
  pedidos: Array<{ pedido_id: string; fotos_extras: number }>;
} | null> {
  const data = await selectInChunks<{
    id: string;
    pedido_id: string;
    fotos_bloco: Array<{ id: string }>;
  }>(pedidoIds, (c) =>
    supabase
      .from('itens_producao')
      .select('id, pedido_id, fotos_bloco(id)')
      .in('pedido_id', c)
      .ilike('modelo', '%bloco%')
  );

  const porPedido = new Map<string, { blocos: number; fotos: number }>();
  for (const item of data ?? []) {
    const fotos = (item.fotos_bloco as Array<{ id: string }>) ?? [];
    const cur = porPedido.get(item.pedido_id) ?? { blocos: 0, fotos: 0 };
    cur.blocos += 1;
    cur.fotos += fotos.length;
    porPedido.set(item.pedido_id, cur);
  }

  const problems: Array<{ pedido_id: string; fotos_extras: number }> = [];
  porPedido.forEach((v, pid) => {
    if (v.fotos > v.blocos) problems.push({ pedido_id: pid, fotos_extras: v.fotos - v.blocos });
  });

  return problems.length > 0 ? { pedidos: problems } : null;
}

/**
 * Extrai os ids de NF que o Tiny rejeitou com "já foi expedida" do corpo de
 * erro de um POST /expedicao 400. O Tiny devolve:
 *   {"mensagem":"Ocorreram erros de validação",
 *    "detalhes":[{"campo":"idsNotasFiscais[15]",
 *                 "mensagem":"Nota fiscal com id '857154393' já foi expedida"}]}
 * e rejeita o agrupamento INTEIRO de forma atomica. Pode listar uma ou varias
 * NFs. Retorna [] quando o erro nao e' desse tipo (= nao recuperavel por
 * auto-skip). Causa: NF expedida manualmente no Tiny fora do uniqueapp
 * (incidentes recorrentes Carlos/Mauro/Edivanio/Pedro).
 */
function parseNfsJaExpedidas(errMsg: string): number[] {
  const jsonStart = errMsg.indexOf("{");
  if (jsonStart === -1) return [];
  try {
    const parsed = JSON.parse(errMsg.slice(jsonStart));
    const detalhes = Array.isArray(parsed?.detalhes) ? parsed.detalhes : [];
    const ids: number[] = [];
    for (const d of detalhes) {
      const msg = String((d as { mensagem?: unknown })?.mensagem ?? "");
      const m = msg.match(/id\s+'?(\d+)'?\s+j[áa] foi expedida/i);
      if (m) ids.push(Number(m[1]));
    }
    return ids;
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "pedido_ids deve ser um array de UUIDs" },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Fetch orders with their items and NFs (chunked — ver selectInChunks)
    const pedidos = await selectInChunks(parsed.data.pedido_ids, (c) =>
      supabase
        .from("pedidos")
        .select("*, itens_producao(*), notas_fiscais(tiny_nf_id)")
        .in("id", c)
        .eq("status", "pronto_producao")
    );

    if (!pedidos.length) {
      return NextResponse.json(
        { error: "Nenhum pedido valido encontrado" },
        { status: 400 }
      );
    }

    // Classify UniqueBox orders considerando os 3 tamanhos de bloco (UB325 P,
    // UB326 M, UB327 G). Item com modelo contendo "bloco" mas sem
    // tamanho_bloco preenchido (pedido legado anterior a essa coluna) e'
    // tratado como P por default — preserva comportamento dos UB325 antigos.
    type PedidoWithRelations = (typeof pedidos)[number];
    type ItemRow = { modelo?: string | null; tamanho_bloco?: 'P' | 'M' | 'G' | null };

    const itemBlocoSize = (i: ItemRow): 'P' | 'M' | 'G' | null => {
      if (i.tamanho_bloco) return i.tamanho_bloco;
      return i.modelo?.toLowerCase().includes('bloco') ? 'P' : null;
    };

    const classifyOrder = (pedido: PedidoWithRelations): string => {
      if (pedido.linha_produto !== "uniquebox") return "uniquekids";
      const items = (pedido.itens_producao as ItemRow[]) ?? [];
      const sizes = new Set<'P' | 'M' | 'G'>();
      let hasBox = false;
      for (const it of items) {
        const size = itemBlocoSize(it);
        if (size) sizes.add(size);
        else hasBox = true;
      }
      if (sizes.size === 0) return "uniquebox";
      if (sizes.size > 1) return "bloco_misto";
      const size = Array.from(sizes)[0]!;
      return hasBox ? `box_bloco_${size}` : `bloco_${size}`;
    };

    const isBlocoTipo = (tipo: string) =>
      tipo.startsWith("bloco_") || tipo.startsWith("box_bloco_");

    // Group orders by (tipo_personalizacao, forma_frete, id_transportador, id_forma_envio).
    // bloco_misto: chave inclui pedido_id pra isolar (1 expedicao por pedido).
    const groups: Record<
      string,
      {
        forma_frete: string;
        id_transportador: number | null;
        id_forma_envio: number | null;
        id_forma_frete: number | null;
        tipo_personalizacao: string;
        pedidos: PedidoWithRelations[];
      }
    > = {};

    for (const p of pedidos) {
      const tipo = classifyOrder(p);
      const isolation = tipo === "bloco_misto" ? `|${p.id}` : "";
      const key = `${p.linha_produto}|${tipo}|${p.forma_frete ?? "sem_frete"}|${p.id_transportador ?? 0}|${p.id_forma_envio ?? 0}${isolation}`;
      if (!groups[key]) {
        groups[key] = {
          forma_frete: p.forma_frete ?? "Sem frete",
          id_transportador: p.id_transportador,
          id_forma_envio: p.id_forma_envio,
          id_forma_frete: p.id_forma_frete,
          tipo_personalizacao: tipo,
          pedidos: [],
        };
      }
      groups[key].pedidos.push(p);
    }

    const createdExpeditions = [];

    // GATE — pedidos com bloco que tem foto em erro/pendente sao PULADOS,
    // o resto segue. Se nada sobrar, devolve erro 409 com a lista.
    const pedidoIdsComBloco = Object.values(groups)
      .filter((g) => isBlocoTipo(g.tipo_personalizacao) || g.tipo_personalizacao === "bloco_misto")
      .flatMap((g) => g.pedidos.map((p) => p.id));

    type PedidoSkipped = {
      pedido_id: string;
      numero: number | null;
      nome_cliente: string | null;
      fotos_erro: number;
      fotos_pendente: number;
      fotos_excedentes: number;
      fotos_ausentes: number;
      nf_ja_expedida: number;
    };
    const skippedById = new Map<string, PedidoSkipped>();
    const pedidoMap = new Map(pedidos.map((p) => [p.id, p]));

    const ensureSkipped = (pid: string): PedidoSkipped => {
      const existing = skippedById.get(pid);
      if (existing) return existing;
      const p = pedidoMap.get(pid);
      const created: PedidoSkipped = {
        pedido_id: pid,
        numero: (p?.numero as number | null) ?? null,
        nome_cliente: (p?.nome_cliente as string | null) ?? null,
        fotos_erro: 0,
        fotos_pendente: 0,
        fotos_excedentes: 0,
        fotos_ausentes: 0,
        nf_ja_expedida: 0,
      };
      skippedById.set(pid, created);
      return created;
    };

    const dropSkippedFromGroups = () => {
      for (const key of Object.keys(groups)) {
        const g = groups[key]!;
        g.pedidos = g.pedidos.filter((p) => !skippedById.has(p.id));
        if (g.pedidos.length === 0) delete groups[key];
      }
    };

    if (pedidoIdsComBloco.length > 0) {
      const problem = await checkBlocoFotosReady(pedidoIdsComBloco, supabase);
      if (problem) {
        for (const it of problem.itens) {
          const cur = ensureSkipped(it.pedido_id);
          cur.fotos_erro += it.fotos_erro;
          cur.fotos_pendente += it.fotos_pendente;
        }
        dropSkippedFromGroups();
      }

      // Gate fotos ausentes — item de bloco com zero linhas em fotos_bloco
      // (parser nao extraiu URL). Roda apos o gate ready porque pedidos com
      // fotos em pendente/erro ja foram filtrados.
      const restantesComBloco = pedidoIdsComBloco.filter((pid) => !skippedById.has(pid));
      if (restantesComBloco.length > 0) {
        const ausentes = await checkBlocoFotosAusentes(restantesComBloco, supabase);
        if (ausentes) {
          for (const p of ausentes.pedidos) {
            ensureSkipped(p.pedido_id).fotos_ausentes += p.faltam;
          }
          dropSkippedFromGroups();
        }
      }
    }

    // Gate fotos excedentes — roda sobre os pedidos com bloco que sobraram apos
    // o gate de fotos ready. UB325/326/327 sempre 1 foto por bloco; >1 indica
    // anomalia (upload duplicado no app de personalizacao Shopify).
    const pedidoIdsParaCheckExcedentes = Object.values(groups)
      .filter((g) => isBlocoTipo(g.tipo_personalizacao) || g.tipo_personalizacao === 'bloco_misto')
      .flatMap((g) => g.pedidos.map((p) => p.id));

    if (pedidoIdsParaCheckExcedentes.length > 0) {
      const exced = await checkBlocoFotosExcedentes(pedidoIdsParaCheckExcedentes, supabase);
      if (exced) {
        for (const p of exced.pedidos) {
          ensureSkipped(p.pedido_id).fotos_excedentes += p.fotos_extras;
        }
        dropSkippedFromGroups();
      }
    }

    if (skippedById.size > 0 && Object.keys(groups).length === 0) {
      return NextResponse.json(
        {
          error: 'fotos_com_problema',
          message: 'Todos os pedidos selecionados têm anomalias de fotos (pendente, erro ou excedente).',
          skipped: Array.from(skippedById.values()),
        },
        { status: 409 }
      );
    }

    // ─── Claim atomico — protege contra double-submit ──────────────────────
    // UPDATE..WHERE status='pronto_producao' RETURNING id captura, num unico
    // statement com row-level lock, somente os pedidos que ainda estao
    // disponiveis. Duas requests paralelas com os mesmos pedido_ids: a primeira
    // ganha o lock; a segunda re-avalia o WHERE pos-commit (status ja virou
    // em_producao) e retorna 0 linhas, ignorando o pedido.
    const pedidoIdsAClaim = Object.values(groups).flatMap((g) =>
      g.pedidos.map((p) => p.id)
    );

    const claimedIds = new Set<string>();
    let claimError: { message: string } | null = null;
    for (const c of chunkIds(pedidoIdsAClaim)) {
      const { data: claimed, error } = await supabase
        .from('pedidos')
        .update({ status: 'em_producao' })
        .in('id', c)
        .eq('status', 'pronto_producao')
        .select('id');
      if (error) {
        claimError = error;
        break;
      }
      for (const row of claimed ?? []) claimedIds.add((row as { id: string }).id);
    }

    if (claimError) {
      return NextResponse.json(
        { error: `Falha ao claimar pedidos: ${claimError.message}` },
        { status: 500 }
      );
    }

    if (claimedIds.size < pedidoIdsAClaim.length) {
      for (const key of Object.keys(groups)) {
        const g = groups[key]!;
        g.pedidos = g.pedidos.filter((p) => claimedIds.has(p.id));
        if (g.pedidos.length === 0) delete groups[key];
      }

      if (Object.keys(groups).length === 0) {
        return NextResponse.json(
          {
            expeditions: [],
            total_expeditions: 0,
            total_pedidos: 0,
            skipped: Array.from(skippedById.values()),
          },
          { status: 202 }
        );
      }
    }

    // ─── Divide grupos com bloco em sub-grupos de ate 30 fotos ─────────────
    // Limite operacional: 30 fotos por chapa fisica = 30 fotos por expedicao
    // Tiny. Sem isso, expedicoes grandes geravam multiplas chapas e
    // dificultavam a separacao na producao.
    // - So aplica em grupos cujo tipo envolve bloco (bloco_*, box_bloco_*,
    //   bloco_misto). Pedidos so de box (uniquebox) e kids ficam sem limite.
    // - Mantem ordem original dentro do grupo (criada em groups[key].pedidos).
    // - Nao divide um pedido entre 2 expedicoes (cliente recebe pedido inteiro).
    const FOTOS_POR_EXPEDICAO = 30;

    type GroupValue = (typeof groups)[string];
    const isBlocoGroup = (g: GroupValue) =>
      isBlocoTipo(g.tipo_personalizacao) || g.tipo_personalizacao === 'bloco_misto';

    // Conta fotos baixadas por pedido (so dos pedidos que sobraram apos o gate).
    const pedidoIdsRestantesComBloco = Object.values(groups)
      .filter(isBlocoGroup)
      .flatMap((g) => g.pedidos.map((p) => p.id));

    const fotosPorPedido = new Map<string, number>();
    if (pedidoIdsRestantesComBloco.length > 0) {
      const fotosRows = await selectInChunks(pedidoIdsRestantesComBloco, (c) =>
        supabase
          .from('fotos_bloco')
          .select('itens_producao!inner(pedido_id)')
          .eq('status', 'baixada')
          .in('itens_producao.pedido_id', c)
      );
      for (const row of fotosRows) {
        const rel = (row as { itens_producao?: unknown }).itens_producao;
        const pid = Array.isArray(rel)
          ? (rel[0] as { pedido_id?: string } | undefined)?.pedido_id
          : (rel as { pedido_id?: string } | undefined)?.pedido_id;
        if (pid) fotosPorPedido.set(pid, (fotosPorPedido.get(pid) ?? 0) + 1);
      }
    }

    const expandedGroups: GroupValue[] = [];
    for (const group of Object.values(groups)) {
      if (!isBlocoGroup(group)) {
        expandedGroups.push(group);
        continue;
      }
      let chunk: GroupValue = { ...group, pedidos: [] };
      let chunkFotos = 0;
      for (const p of group.pedidos) {
        const fotos = fotosPorPedido.get(p.id) ?? 0;
        if (chunk.pedidos.length > 0 && chunkFotos + fotos > FOTOS_POR_EXPEDICAO) {
          expandedGroups.push(chunk);
          chunk = { ...group, pedidos: [] };
          chunkFotos = 0;
        }
        chunk.pedidos.push(p);
        chunkFotos += fotos;
      }
      if (chunk.pedidos.length > 0) expandedGroups.push(chunk);
    }

    // ─── Divide grupos so-box em sub-grupos de ate 28 personalizadas ──────
    // Cada chapa SVG (molde_28.svg) renderiza 28 mensagens personalizadas.
    // Sem o limite, expedicoes grandes geravam multiplos SVGs por lote — a
    // operacao precisa de 1 chapa fisica por expedicao.
    // - So aplica em tipo === "uniquebox" (box puro). Grupos com bloco ja
    //   foram divididos acima pelo limite de fotos.
    // - Conta itens com personalizacao nao-vazia (so esses ocupam slot do SVG).
    // - Mantem pedido inteiro (cliente recebe tudo numa expedicao).
    // - Pedido sozinho com >28 personalizados passa intacto (gera 2 SVGs);
    //   nao temos como dividir pedido entre expedicoes.
    const BOX_POR_EXPEDICAO = 28;
    const isBoxOnlyGroup = (g: GroupValue) =>
      g.tipo_personalizacao === 'uniquebox';

    const splitBoxGroups: GroupValue[] = [];
    for (const group of expandedGroups) {
      if (!isBoxOnlyGroup(group)) {
        splitBoxGroups.push(group);
        continue;
      }
      let chunk: GroupValue = { ...group, pedidos: [] };
      let chunkBox = 0;
      for (const p of group.pedidos) {
        const personalizadas = (
          (p.itens_producao as Array<{ personalizacao?: string | null }>) ?? []
        ).filter((i) => !!(i.personalizacao && i.personalizacao.trim())).length;
        if (chunk.pedidos.length > 0 && chunkBox + personalizadas > BOX_POR_EXPEDICAO) {
          splitBoxGroups.push(chunk);
          chunk = { ...group, pedidos: [] };
          chunkBox = 0;
        }
        chunk.pedidos.push(p);
        chunkBox += personalizadas;
      }
      if (chunk.pedidos.length > 0) splitBoxGroups.push(chunk);
    }

    for (const group of splitBoxGroups) {
      let allItems = group.pedidos.flatMap((p) =>
        (p.itens_producao ?? []).filter(
          (i: { status: string }) => i.status === "pendente"
        )
      );

      const linhaProduto = group.pedidos[0].linha_produto;

      // Get real NF IDs from notas_fiscais
      const nfIds = group.pedidos
        .flatMap((p) =>
          ((p as Record<string, unknown>).notas_fiscais as { tiny_nf_id: number }[] | null) ?? []
        )
        .map((nf) => nf.tiny_nf_id)
        .filter(Boolean);

      // 1. Create agrupamento in Tiny — com auto-skip de NF ja expedida.
      //    O Tiny rejeita o agrupamento INTEIRO de forma atomica quando uma NF
      //    ja foi expedida manualmente nele fora do uniqueapp (incidentes
      //    recorrentes Carlos/Mauro/Edivanio/Pedro). Em vez de travar a
      //    expedicao toda, removemos a(s) NF(s) culpada(s), marcamos o pedido
      //    como expedido + skipped, e re-tentamos. A geracao da chapa roda
      //    depois (triggerProduction), entao o item removido nao entra na chapa.
      let tinyAgrupamentoId: number | null = null;
      let numeroExpedicao: number | null = null;
      let tinyError: string | null = null;
      let nfIdsOrdenados: number[] = nfIds;
      let formaFreteReal: string | null = null;

      // Mapa NF -> pedido pra auto-skip
      const nfToPedido = new Map<number, PedidoWithRelations>();
      for (const p of group.pedidos) {
        const nfs =
          ((p as Record<string, unknown>).notas_fiscais as { tiny_nf_id: number }[] | null) ?? [];
        for (const nf of nfs) if (nf.tiny_nf_id) nfToPedido.set(nf.tiny_nf_id, p);
      }

      // Forma de frete explicita no agrupamento. Desde a remocao do clone
      // fiscal (2026-07-25) a NF sai do pedido importado do Shopify, que as
      // vezes chega sem transportador — antes o clone forcava DEFAULT_SHIPPING
      // e o agrupamento nunca saia "Sem frete" (sem etiqueta, incidentes
      // #47770/#47911). `id_forma_frete` no DB ja carrega esse fallback.
      // So' informamos quando TODOS os pedidos do grupo concordam: a chave de
      // agrupamento usa o *nome* da forma de frete, e a Unique tem multiplas
      // configs Loggi com ids distintos sob o mesmo nome — num grupo misto
      // qualquer id escolhido estaria errado pra parte dele, entao deixamos o
      // Tiny decidir como fazia antes.
      const idsFreteGrupo = group.pedidos.map((p) => p.id_forma_frete);
      const formaFreteAgrupamento =
        idsFreteGrupo.every((id) => !!id) && new Set(idsFreteGrupo).size === 1
          ? idsFreteGrupo[0]
          : null;

      let nfsParaEnviar = [...nfIds];
      // teto defensivo: no pior caso removemos todas as NFs uma a uma
      for (let attempt = 0; attempt <= nfIds.length && nfsParaEnviar.length > 0; attempt++) {
        try {
          const result = await createExpedition({
            idsNotasFiscais: nfsParaEnviar,
            ...(formaFreteAgrupamento && {
              logistica: { formaFrete: { id: formaFreteAgrupamento } },
            }),
          });
          tinyAgrupamentoId = result.id ?? null;
          nfIdsOrdenados = nfsParaEnviar;
          tinyError = null;

          // 2. Fetch expedition details to get identificacao (numero) e ordem das etiquetas
          if (tinyAgrupamentoId) {
            try {
              const details = await fetchExpedition(tinyAgrupamentoId);
              numeroExpedicao = details.identificacao ? parseInt(details.identificacao, 10) : null;
              const nomeReal = (details.formaEnvio?.nome ?? "").trim();
              if (nomeReal) formaFreteReal = nomeReal;

              const ordemTiny = (details.expedicoes ?? [])
                .map((e) => e.idObjeto)
                .filter((id): id is number => typeof id === "number");
              if (ordemTiny.length) {
                const seen = new Set<number>();
                const ordered: number[] = [];
                for (const id of ordemTiny) {
                  if (nfsParaEnviar.includes(id) && !seen.has(id)) {
                    seen.add(id);
                    ordered.push(id);
                  }
                }
                for (const id of nfsParaEnviar) {
                  if (!seen.has(id)) ordered.push(id);
                }
                nfIdsOrdenados = ordered;
              }
            } catch (err) {
              console.warn("[producao/gerar] Erro ao obter numero da expedicao (non-fatal):", err);
            }

            // 3. Conclude agrupamento in Tiny
            try {
              await completeExpedition(tinyAgrupamentoId);
            } catch (err) {
              // 400 is expected for some shipping methods (e.g. Mercado Envios)
              console.warn("[producao/gerar] Erro ao concluir agrupamento (non-fatal):", err);
            }
          }
          break; // sucesso
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erro Tiny API";
          const jaExpedidas = parseNfsJaExpedidas(msg).filter((nf) => nfsParaEnviar.includes(nf));
          if (jaExpedidas.length === 0) {
            // erro nao recuperavel por auto-skip — registra e sai
            tinyError = msg;
            console.error("[producao/gerar] Erro ao criar agrupamento:", tinyError);
            break;
          }
          // remove NFs ja expedidas, marca pedidos como expedido + skipped, re-tenta
          for (const nf of jaExpedidas) {
            const ped = nfToPedido.get(nf);
            if (ped) {
              ensureSkipped(ped.id).nf_ja_expedida += 1;
              await supabase.from("pedidos").update({ status: "expedido" }).eq("id", ped.id);
              // Pedido inteiro saiu do agrupamento — tira TODAS as NFs dele (nao
              // so a reportada), pra nao deixar pedido meio-dentro/meio-fora.
              const pedNfs =
                ((ped as Record<string, unknown>).notas_fiscais as { tiny_nf_id: number }[] | null) ?? [];
              const pedNfIds = new Set(pedNfs.map((n) => n.tiny_nf_id));
              pedNfIds.add(nf);
              nfsParaEnviar = nfsParaEnviar.filter((n) => !pedNfIds.has(n));
            } else {
              nfsParaEnviar = nfsParaEnviar.filter((n) => n !== nf);
            }
          }
          console.warn(
            `[producao/gerar] NF(s) ja expedidas fora do app, re-tentando sem: ${jaExpedidas.join(", ")}`
          );
        }
      }

      // Se TODAS as NFs do grupo ja haviam sido expedidas, nao ha o que produzir
      // — os pedidos ja foram marcados expedido + skipped. Pula o grupo inteiro.
      if (nfsParaEnviar.length === 0) {
        continue;
      }

      // Remove itens dos pedidos auto-skipados deste grupo — nao entram na chapa.
      allItems = allItems.filter(
        (i: { pedido_id: string }) => !skippedById.has(i.pedido_id)
      );
      const pedidosRestantes = group.pedidos.filter((p) => !skippedById.has(p.id));
      const groupPedidoIds = pedidosRestantes.map((p) => p.id);

      // 3. Create production batch (lote)
      const { data: lote, error: loteError } = await supabase
        .from("lotes_producao")
        .insert({
          linha_produto: linhaProduto,
          total_itens: allItems.length,
          criado_por: authResult.id,
        })
        .select()
        .single();

      if (loteError || !lote) {
        console.error("[producao/gerar] Erro ao criar lote:", loteError?.message);
        continue;
      }

      // Assign items to batch
      if (allItems.length > 0) {
        for (const c of chunkIds(allItems.map((i: { id: string }) => i.id))) {
          await supabase
            .from("itens_producao")
            .update({ lote_id: lote.id })
            .in("id", c);
        }
      }

      // 4. Create expedition record (always pendente — operator controls kanban)
      const formaFreteFinal = formaFreteReal ?? group.forma_frete;
      const { data: expedition } = await supabase
        .from("expedicoes")
        .insert({
          lote_id: lote.id,
          tiny_agrupamento_id: tinyAgrupamentoId,
          tiny_expedicao_id: tinyAgrupamentoId,
          numero_expedicao: numeroExpedicao,
          forma_frete: formaFreteFinal,
          id_forma_frete: group.id_forma_frete,
          id_transportador: group.id_transportador,
          nf_ids: nfIdsOrdenados,
          status: tinyError ? "erro" : "pendente",
          erro_detalhe: tinyError,
        })
        .select()
        .single();

      // 5. Cache labels in background (non-blocking)
      // forceFallback sempre — fluxo consolidado do Tiny tem ordem propria
      // que nao bate com fetchExpedition().expedicoes[] (= nf_ids/conferencia).
      if (expedition?.id && tinyAgrupamentoId) {
        cacheExpeditionLabels(expedition.id, tinyAgrupamentoId, { forceFallback: true }).catch(() => {});
      }

      // Log event
      const tipoLabelMap: Record<string, string> = {
        uniquebox: " [BOX]",
        uniquekids: " [KIDS]",
        bloco_P: " [BLOCO P]",
        bloco_M: " [BLOCO M]",
        bloco_G: " [BLOCO G]",
        box_bloco_P: " [BOX+BLOCO P]",
        box_bloco_M: " [BOX+BLOCO M]",
        box_bloco_G: " [BOX+BLOCO G]",
        bloco_misto: " [BLOCO MISTO]",
      };
      const tipoLabel = tipoLabelMap[group.tipo_personalizacao] ?? "";
      await supabase.from("eventos").insert({
        lote_id: lote.id,
        tipo: "status_change",
        descricao: `Expedicao ${group.forma_frete}${tipoLabel} criada: ${pedidosRestantes.length} pedidos, ${allItems.length} itens${tinyAgrupamentoId ? ` (Tiny: ${tinyAgrupamentoId})` : ""}`,
        dados: {
          pedido_ids: groupPedidoIds,
          forma_frete: group.forma_frete,
          tipo_personalizacao: group.tipo_personalizacao,
          expedition_id: expedition?.id,
          tiny_agrupamento_id: tinyAgrupamentoId,
        },
        ator: authResult.id,
      });

      // 6. Trigger file generation asynchronously
      triggerProduction(lote.id, linhaProduto, supabase);

      createdExpeditions.push({
        expedition_id: expedition?.id,
        lote_id: lote.id,
        forma_frete: group.forma_frete,
        tipo_personalizacao: group.tipo_personalizacao,
        pedidos_count: pedidosRestantes.length,
        itens_count: allItems.length,
        tiny_agrupamento_id: tinyAgrupamentoId,
      });
    }

    const skipped = Array.from(skippedById.values());
    return NextResponse.json(
      {
        expeditions: createdExpeditions,
        total_expeditions: createdExpeditions.length,
        total_pedidos: createdExpeditions.reduce(
          (acc, e) => acc + e.pedidos_count,
          0
        ),
        skipped,
      },
      { status: 202 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function triggerProduction(
  loteId: string,
  linhaProduto: string,
  supabase: ReturnType<typeof createServerClient>
) {
  const fn =
    linhaProduto === "uniquebox" ? processUniqueBoxBatch : processUniqueKidsBatch;

  fn(loteId).catch(async (err) => {
    const message = err instanceof Error ? err.message : "Unknown error";

    await supabase
      .from("lotes_producao")
      .update({
        status: "erro_parcial",
        completed_at: new Date().toISOString(),
      })
      .eq("id", loteId);

    await supabase.from("eventos").insert({
      lote_id: loteId,
      tipo: "erro",
      descricao: `Erro na producao: ${message}`,
      dados: { error: message },
      ator: "sistema",
    });
  });
}
