import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { duplicateOrderForFiscal } from '@/lib/tiny/fiscal';
import { generateNFForOrder, applyNFMarkers } from '@/lib/tiny/nota-fiscal';
import { logError } from '@/lib/logger';

// Marker label for fiscal duplication
const NF_MARKER_LABEL = process.env.TINY_NF_MARKER_LABEL ?? 'ecommerce';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const pedidoId: string = body.pedido_id ?? body.record?.id;

    if (!pedidoId) {
      return NextResponse.json({ error: 'Missing pedido_id' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Fetch the order
    const { data: pedido, error: fetchError } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', pedidoId)
      .single();

    if (fetchError || !pedido) {
      return NextResponse.json({ error: 'Pedido not found' }, { status: 404 });
    }

    // Idempotency: skip if already past recebido
    if (pedido.status !== 'recebido') {
      return NextResponse.json({ ok: true, skipped: true, reason: `Status is ${pedido.status}` });
    }

    try {
      // Step 1: Duplicate order at 38%
      const { clonedOrderId, clonedOrderNumber } = await duplicateOrderForFiscal(
        pedido.tiny_pedido_id
      );

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'api_call',
        descricao: `Pedido clonado (1/2 NF): ${clonedOrderNumber} (${clonedOrderId})`,
        dados: { cloned_order_id: clonedOrderId, cloned_order_number: clonedOrderNumber },
        ator: 'sistema',
      });

      // Step 2: Generate NF modelo 55
      const { nfId } = await generateNFForOrder(clonedOrderId);

      // Step 3: Save NF record
      await supabase.from('notas_fiscais').insert({
        pedido_id: pedidoId,
        tiny_nf_id: nfId,
        tiny_pedido_clone_id: clonedOrderId,
        modelo: '55',
      });

      // Step 4: Apply markers
      if (NF_MARKER_LABEL) {
        await applyNFMarkers(pedido.tiny_pedido_id, clonedOrderId, nfId, NF_MARKER_LABEL);
      }

      // Step 5: Update to aguardando_nf (waiting for SEFAZ authorization)
      await supabase
        .from('pedidos')
        .update({ status: 'aguardando_nf' })
        .eq('id', pedidoId);

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'status_change',
        descricao: `NF gerada — NF ID: ${nfId}, aguardando autorizacao SEFAZ`,
        dados: { tiny_nf_id: nfId },
        ator: 'sistema',
      });

      return NextResponse.json({ ok: true, nf_id: nfId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      await supabase
        .from('pedidos')
        .update({ status: 'erro_fiscal' })
        .eq('id', pedidoId);

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'erro',
        descricao: `Erro na duplicacao fiscal: ${message}`,
        dados: { error: message },
        ator: 'sistema',
      });

      await logError({
        source: 'job',
        category: 'external_api',
        message: `Duplicacao fiscal falhou: ${message}`,
        error: err,
        pedido_id: pedidoId,
        tiny_pedido_id: pedido.tiny_pedido_id,
        request_path: '/api/jobs/fiscal-duplication',
      });

      return NextResponse.json({ error: message }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logError({
      source: 'job',
      category: 'infrastructure',
      message: `Job fiscal-duplication falhou: ${message}`,
      error: err,
      request_path: '/api/jobs/fiscal-duplication',
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
