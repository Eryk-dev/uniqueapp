import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { createServerClient } from "@/lib/supabase/server";
import { fetchOrder } from "@/lib/tiny/client";
import { extractCidadeUf } from "@/lib/tiny/endereco";
import {
  agruparPorTransportadora,
  buscarRastreio,
  carregarPendentes,
  type ItemPendente,
} from "@/lib/romaneio";

/**
 * GET /api/romaneios
 * Pendentes agrupados por transportadora + historico de romaneios.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const supabase = createServerClient();

  try {
    const pendentes = agruparPorTransportadora(await carregarPendentes(supabase));

    const { data: romaneios, error: romErr } = await supabase
      .from("romaneios")
      .select("id, numero, transportadora, total_volumes, observacoes, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (romErr) throw new Error(romErr.message);

    return NextResponse.json({ pendentes, romaneios: romaneios ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[romaneios] GET falhou:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Teto de buscas no Tiny por romaneio pra completar cidade/UF de pedido
// antigo (importado antes das colunas existirem). O rate limiter serializa
// em ~1.1s por chamada, entao isso e' o custo maximo de latencia aceito;
// o resto sai com cidade vazia. Pedidos novos ja chegam preenchidos pelo
// ingest/enrichment — e ha scripts/backfill-cidade-uf.ts pro passado.
const MAX_LOOKUPS_TINY = 25;

/**
 * Completa cidade/UF faltantes buscando o pedido no Tiny, e persiste em
 * `pedidos` pra nao repetir a busca. Best-effort: falha nao derruba o
 * romaneio.
 */
async function completarCidadeUf(
  itens: ItemPendente[],
  supabase: ReturnType<typeof createServerClient>
): Promise<void> {
  const semCidade = itens.filter((i) => !i.cidade && i.pedido_id);
  if (semCidade.length === 0) return;

  const pedidoIds = Array.from(new Set(semCidade.map((i) => i.pedido_id!))).slice(
    0,
    MAX_LOOKUPS_TINY
  );

  const { data: pedidos } = await supabase
    .from("pedidos")
    .select("id, tiny_pedido_id")
    .in("id", pedidoIds);

  await Promise.all(
    (pedidos ?? []).map(async (p) => {
      try {
        const order = await fetchOrder(p.tiny_pedido_id);
        const { cidade, uf } = extractCidadeUf(order);
        if (!cidade && !uf) return;

        await supabase.from("pedidos").update({ cidade, uf }).eq("id", p.id);
        for (const item of itens) {
          if (item.pedido_id === p.id) {
            item.cidade = cidade;
            item.uf = uf;
          }
        }
      } catch (err) {
        console.warn(`[romaneios] cidade/UF do pedido ${p.id} falhou (non-fatal):`, err);
      }
    })
  );
}

/**
 * POST /api/romaneios
 * Body: { transportadora: string, tiny_nf_ids: number[], observacoes?: string }
 *
 * Fecha um romaneio com as NFs marcadas. Os dados impressos sao snapshot:
 * a folha assinada nao pode mudar se o pedido for editado depois.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const user = authResult;

  const supabase = createServerClient();

  let body: { transportadora?: string; tiny_nf_ids?: number[]; observacoes?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const transportadora = body.transportadora?.trim();
  const nfIdsPedidos = Array.from(
    new Set((body.tiny_nf_ids ?? []).map(Number).filter(Boolean))
  );

  if (!transportadora) {
    return NextResponse.json({ error: "transportadora obrigatoria" }, { status: 400 });
  }
  if (nfIdsPedidos.length === 0) {
    return NextResponse.json({ error: "Nenhum pedido selecionado" }, { status: 400 });
  }

  try {
    // Re-resolve server-side: o payload do cliente so diz QUAIS NFs, nunca
    // o conteudo que vai impresso.
    const { itens, transportadoraPorNf } = await carregarPendentes(supabase);
    const porNf = new Map(itens.map((i) => [i.tiny_nf_id, i]));

    const selecionados: ItemPendente[] = [];
    const ignorados: number[] = [];
    for (const nfId of nfIdsPedidos) {
      const item = porNf.get(nfId);
      // Fora da transportadora do romaneio ou ja romaneada (corrida entre
      // duas abas) — ignora em vez de misturar assinatura de motorista.
      if (!item || transportadoraPorNf.get(nfId) !== transportadora) {
        ignorados.push(nfId);
        continue;
      }
      selecionados.push(item);
    }

    if (selecionados.length === 0) {
      return NextResponse.json(
        {
          error:
            "Nenhum dos pedidos selecionados esta disponivel — podem ter entrado em outro romaneio.",
          ignorados,
        },
        { status: 409 }
      );
    }

    // Rastreio + cidade em paralelo — sao chamadas Tiny independentes.
    const [rastreioPorNf] = await Promise.all([
      buscarRastreio(selecionados),
      completarCidadeUf(selecionados, supabase),
    ]);

    for (const item of selecionados) {
      const r = rastreioPorNf.get(item.tiny_nf_id);
      item.codigo_rastreio = r?.codigo ?? null;
      item.url_rastreio = r?.url ?? null;
    }

    const semRastreio = selecionados.filter((i) => !i.codigo_rastreio).length;

    const { data: romaneio, error: romErr } = await supabase
      .from("romaneios")
      .insert({
        transportadora,
        total_volumes: selecionados.length,
        observacoes: body.observacoes?.trim() || null,
        criado_por: user.id,
      })
      .select("id, numero, transportadora, total_volumes, observacoes, created_at")
      .single();

    if (romErr || !romaneio) {
      throw new Error(romErr?.message ?? "Falha ao criar romaneio");
    }

    const { error: itensErr } = await supabase.from("romaneio_itens").insert(
      selecionados.map((item) => ({
        romaneio_id: romaneio.id,
        pedido_id: item.pedido_id,
        expedicao_id: item.expedicao_id,
        tiny_nf_id: item.tiny_nf_id,
        numero_nf: item.numero_nf,
        numero_pedido: item.numero_pedido,
        nome_cliente: item.nome_cliente,
        linha_produto: item.linha_produto,
        numero_expedicao: item.numero_expedicao,
        cidade: item.cidade,
        uf: item.uf,
        codigo_rastreio: item.codigo_rastreio,
        url_rastreio: item.url_rastreio,
      }))
    );

    if (itensErr) {
      // Sem itens o romaneio nao existe de fato — nao deixa cabecalho orfao
      // (nem queima numero de sequencia com folha vazia).
      await supabase.from("romaneios").delete().eq("id", romaneio.id);
      const duplicada = itensErr.code === "23505";
      return NextResponse.json(
        {
          error: duplicada
            ? "Algum pedido ja entrou em outro romaneio — recarregue a lista."
            : itensErr.message,
        },
        { status: duplicada ? 409 : 500 }
      );
    }

    await supabase.from("eventos").insert({
      tipo: "romaneio_criado",
      descricao: `Romaneio ${romaneio.numero} — ${transportadora} — ${selecionados.length} volumes`,
      dados: {
        romaneio_id: romaneio.id,
        numero: romaneio.numero,
        transportadora,
        tiny_nf_ids: selecionados.map((i) => i.tiny_nf_id),
        ignorados,
        sem_rastreio: semRastreio,
      },
      ator: user.username,
    });

    return NextResponse.json({
      romaneio,
      itens: selecionados,
      ignorados,
      sem_rastreio: semRastreio,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[romaneios] POST falhou:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
