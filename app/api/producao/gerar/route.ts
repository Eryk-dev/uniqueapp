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
  const { data, error } = await supabase
    .from('itens_producao')
    .select('id, pedido_id, fotos_bloco(status)')
    .in('pedido_id', pedidoIds)
    .ilike('modelo', '%bloco%');

  if (error) throw new Error(`Gate check failed: ${error.message}`);

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

    // Fetch orders with their items and NFs
    const { data: pedidos, error } = await supabase
      .from("pedidos")
      .select("*, itens_producao(*), notas_fiscais(tiny_nf_id)")
      .in("id", parsed.data.pedido_ids)
      .eq("status", "pronto_producao");

    if (error || !pedidos?.length) {
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
    };
    const skippedById = new Map<string, PedidoSkipped>();

    if (pedidoIdsComBloco.length > 0) {
      const problem = await checkBlocoFotosReady(pedidoIdsComBloco, supabase);
      if (problem) {
        const pedidoMap = new Map(pedidos.map((p) => [p.id, p]));
        for (const it of problem.itens) {
          if (skippedById.has(it.pedido_id)) {
            const cur = skippedById.get(it.pedido_id)!;
            cur.fotos_erro += it.fotos_erro;
            cur.fotos_pendente += it.fotos_pendente;
            continue;
          }
          const p = pedidoMap.get(it.pedido_id);
          skippedById.set(it.pedido_id, {
            pedido_id: it.pedido_id,
            numero: (p?.numero as number | null) ?? null,
            nome_cliente: (p?.nome_cliente as string | null) ?? null,
            fotos_erro: it.fotos_erro,
            fotos_pendente: it.fotos_pendente,
          });
        }

        // Remove pedidos problematicos dos grupos. Se um grupo zerar, descarta.
        for (const key of Object.keys(groups)) {
          const g = groups[key]!;
          g.pedidos = g.pedidos.filter((p) => !skippedById.has(p.id));
          if (g.pedidos.length === 0) delete groups[key];
        }

        if (Object.keys(groups).length === 0) {
          return NextResponse.json(
            {
              error: 'fotos_com_problema',
              message: 'Todos os pedidos selecionados têm fotos em erro ou pendente.',
              skipped: Array.from(skippedById.values()),
            },
            { status: 409 }
          );
        }
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
      const { data: fotosRows } = await supabase
        .from('fotos_bloco')
        .select('itens_producao!inner(pedido_id)')
        .eq('status', 'baixada')
        .in('itens_producao.pedido_id', pedidoIdsRestantesComBloco);
      for (const row of fotosRows ?? []) {
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

    for (const group of expandedGroups) {
      const groupPedidoIds = group.pedidos.map((p) => p.id);
      const allItems = group.pedidos.flatMap((p) =>
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

      // 1. Create agrupamento in Tiny
      let tinyAgrupamentoId: number | null = null;
      let numeroExpedicao: number | null = null;
      let tinyError: string | null = null;
      let nfIdsOrdenados: number[] = nfIds;
      let formaFreteReal: string | null = null;

      if (nfIds.length > 0) {
        try {
          const result = await createExpedition({
            idsNotasFiscais: nfIds,
          });
          tinyAgrupamentoId = result.id ?? null;

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
                  if (nfIds.includes(id) && !seen.has(id)) {
                    seen.add(id);
                    ordered.push(id);
                  }
                }
                for (const id of nfIds) {
                  if (!seen.has(id)) ordered.push(id);
                }
                nfIdsOrdenados = ordered;
              }
            } catch (err) {
              console.warn("[producao/gerar] Erro ao obter numero da expedicao (non-fatal):", err);
            }
          }

          // 3. Conclude agrupamento in Tiny
          if (tinyAgrupamentoId) {
            try {
              await completeExpedition(tinyAgrupamentoId);
            } catch (err) {
              // 400 is expected for some shipping methods (e.g. Mercado Envios)
              console.warn("[producao/gerar] Erro ao concluir agrupamento (non-fatal):", err);
            }
          }
        } catch (err) {
          tinyError = err instanceof Error ? err.message : "Erro Tiny API";
          console.error("[producao/gerar] Erro ao criar agrupamento:", tinyError);
        }
      }

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
        await supabase
          .from("itens_producao")
          .update({ lote_id: lote.id })
          .in(
            "id",
            allItems.map((i: { id: string }) => i.id)
          );
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

      // 6. Update orders to em_producao
      await supabase
        .from("pedidos")
        .update({ status: "em_producao" })
        .in("id", groupPedidoIds);

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
        descricao: `Expedicao ${group.forma_frete}${tipoLabel} criada: ${group.pedidos.length} pedidos, ${allItems.length} itens${tinyAgrupamentoId ? ` (Tiny: ${tinyAgrupamentoId})` : ""}`,
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
        pedidos_count: group.pedidos.length,
        itens_count: allItems.length,
        tiny_agrupamento_id: tinyAgrupamentoId,
      });
    }

    const skipped = Array.from(skippedById.values());
    return NextResponse.json(
      {
        expeditions: createdExpeditions,
        total_expeditions: createdExpeditions.length,
        total_pedidos: pedidos.length - skipped.length,
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
