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

    // Classify UniqueBox orders: box, bloco, or box_bloco
    type PedidoWithRelations = (typeof pedidos)[number];

    const classifyOrder = (pedido: PedidoWithRelations): string => {
      if (pedido.linha_produto !== "uniquebox") return "normal";
      const items = (pedido.itens_producao as { modelo?: string }[]) ?? [];
      const hasBloco = items.some((i) => i.modelo?.toLowerCase().includes("bloco"));
      const hasBox = items.some((i) => !i.modelo?.toLowerCase().includes("bloco"));
      if (hasBloco && hasBox) return "box_bloco";
      if (hasBloco) return "bloco";
      return "normal";
    };

    // Group orders by (tipo_personalizacao, forma_frete, id_transportador, id_forma_envio)
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
      const key = `${tipo}|${p.forma_frete ?? "sem_frete"}|${p.id_transportador ?? 0}|${p.id_forma_envio ?? 0}`;
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

    for (const group of Object.values(groups)) {
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

      if (nfIds.length > 0) {
        try {
          const result = await createExpedition({
            idsNotasFiscais: nfIds,
          });
          tinyAgrupamentoId = result.id ?? null;

          // 2. Fetch expedition details to get identificacao (numero)
          if (tinyAgrupamentoId) {
            try {
              const details = await fetchExpedition(tinyAgrupamentoId);
              numeroExpedicao = details.identificacao ? parseInt(details.identificacao, 10) : null;
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
      const { data: expedition } = await supabase
        .from("expedicoes")
        .insert({
          lote_id: lote.id,
          tiny_agrupamento_id: tinyAgrupamentoId,
          tiny_expedicao_id: tinyAgrupamentoId,
          numero_expedicao: numeroExpedicao,
          forma_frete: group.forma_frete,
          id_forma_frete: group.id_forma_frete,
          id_transportador: group.id_transportador,
          nf_ids: nfIds,
          status: tinyError ? "erro" : "pendente",
          erro_detalhe: tinyError,
        })
        .select()
        .single();

      // 5. Cache labels in background (non-blocking)
      if (expedition?.id && tinyAgrupamentoId) {
        cacheExpeditionLabels(expedition.id, tinyAgrupamentoId).catch(() => {});
      }

      // 6. Update orders to em_producao
      await supabase
        .from("pedidos")
        .update({ status: "em_producao" })
        .in("id", groupPedidoIds);

      // Log event
      const tipoLabel = group.tipo_personalizacao === "bloco"
        ? " [BLOCO]"
        : group.tipo_personalizacao === "box_bloco"
        ? " [BOX+BLOCO]"
        : "";
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

    return NextResponse.json(
      {
        expeditions: createdExpeditions,
        total_expeditions: createdExpeditions.length,
        total_pedidos: pedidos.length,
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
