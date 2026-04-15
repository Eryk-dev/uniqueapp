import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchOrder } from '@/lib/tiny/client';

export async function POST() {
  const supabase = createServerClient();

  // Find pedidos that have itens without personalizacao
  const { data: pedidos } = await supabase
    .from('pedidos')
    .select('id, numero, tiny_pedido_id, linha_produto')
    .in('status', ['pronto_producao', 'em_producao', 'produzido', 'expedido']);

  if (!pedidos?.length) {
    return NextResponse.json({ ok: true, message: 'Nenhum pedido para backfill' });
  }

  const results: Array<{ numero: number; updated: number; skipped: number }> = [];

  for (const pedido of pedidos) {
    console.log(`[backfill] Processando pedido #${pedido.numero} (tiny: ${pedido.tiny_pedido_id})`);

    // Fetch full order from Tiny
    const tinyOrder = await fetchOrder(pedido.tiny_pedido_id);

    // Get existing itens_producao for this pedido
    const { data: itens } = await supabase
      .from('itens_producao')
      .select('id, modelo, personalizacao')
      .eq('pedido_id', pedido.id)
      .order('created_at', { ascending: true });

    if (!itens?.length || !tinyOrder.itens?.length) {
      console.log(`[backfill] Pedido #${pedido.numero} — sem itens, skip`);
      results.push({ numero: pedido.numero, updated: 0, skipped: itens?.length ?? 0 });
      continue;
    }

    // Build a flat list of Tiny items (expanded by quantity, same as enrichment does)
    const tinyItemsExpanded: Array<{ descricao: string; infoAdicional: string | null; sku: string | null }> = [];
    for (const entry of tinyOrder.itens) {
      const qty = entry.quantidade ?? 1;
      for (let i = 0; i < qty; i++) {
        tinyItemsExpanded.push({
          descricao: entry.produto?.descricao ?? '',
          infoAdicional: entry.infoAdicional?.trim() || null,
          sku: entry.produto?.sku ?? null,
        });
      }
    }

    let updated = 0;
    let skipped = 0;

    // Match by position (same order as enrichment created them)
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      const tinyItem = tinyItemsExpanded[i];

      if (!tinyItem?.infoAdicional) {
        skipped++;
        continue;
      }

      // Only update if personalizacao is currently null
      if (item.personalizacao) {
        skipped++;
        continue;
      }

      const { error } = await supabase
        .from('itens_producao')
        .update({
          personalizacao: tinyItem.infoAdicional,
          has_personalizacao: true,
        })
        .eq('id', item.id);

      if (error) {
        console.error(`[backfill] Erro ao atualizar item ${item.id}: ${error.message}`);
        skipped++;
      } else {
        console.log(`[backfill] Pedido #${pedido.numero} item "${item.modelo}" → "${tinyItem.infoAdicional}"`);
        updated++;
      }
    }

    results.push({ numero: pedido.numero, updated, skipped });
  }

  console.log(`[backfill] Concluido:`, results);
  return NextResponse.json({ ok: true, results });
}
