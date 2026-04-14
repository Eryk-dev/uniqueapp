import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { enrichOrder, saveEnrichmentResults } from '@/lib/tiny/enrichment';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pedidoId: string = body.pedido_id ?? body.record?.id;

    if (!pedidoId) {
      return NextResponse.json({ error: 'Missing pedido_id' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch pedido with NF
    const { data: pedido } = await supabase
      .from('pedidos')
      .select('*, notas_fiscais(*)')
      .eq('id', pedidoId)
      .single();

    if (!pedido) {
      return NextResponse.json({ error: 'Pedido not found' }, { status: 404 });
    }

    // Idempotency: skip if already enriched or beyond
    if (!['aguardando_nf'].includes(pedido.status)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `Status is ${pedido.status}`,
      });
    }

    const nf = Array.isArray(pedido.notas_fiscais)
      ? pedido.notas_fiscais[0]
      : pedido.notas_fiscais;

    if (!nf?.tiny_nf_id) {
      return NextResponse.json({ error: 'No NF found for pedido' }, { status: 400 });
    }

    try {
      // Run enrichment
      const result = await enrichOrder(
        pedidoId,
        nf.tiny_nf_id,
        pedido.tiny_pedido_id,
        pedido.linha_produto
      );

      // Save results (updates status to pronto_producao)
      await saveEnrichmentResults(pedidoId, result);

      return NextResponse.json({
        ok: true,
        itens_count: result.items.length,
        nome_cliente: result.nomeCliente,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      await supabase
        .from('pedidos')
        .update({ status: 'erro_enriquecimento' })
        .eq('id', pedidoId);

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'erro',
        descricao: `Erro no enriquecimento: ${message}`,
        dados: { error: message },
        ator: 'sistema',
      });

      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    console.error('Enrichment error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
