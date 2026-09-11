import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
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
      // Step 1: Generate NF modelo 55 no proprio pedido importado do Shopify.
      // Se o Tiny ja emitiu a NF sozinho, adota a existente (ver nota-fiscal.ts).
      const { nfId, adotada } = await generateNFForOrder(pedido.tiny_pedido_id);

      // Step 2: Save NF record. 23505 = a NF ja esta registrada (re-execucao
      // do job apos falha parcial) — benigno. Outro erro tem que estourar:
      // seguir pra aguardando_nf sem linha em notas_fiscais quebra o
      // enrichment depois ("No NF found for pedido").
      const { error: nfError } = await supabase.from('notas_fiscais').insert({
        pedido_id: pedidoId,
        tiny_nf_id: nfId,
        modelo: '55',
      });
      if (nfError && nfError.code !== '23505') {
        throw new Error(`Insert notas_fiscais falhou: ${nfError.message}`);
      }

      // Step 3: Apply markers
      if (NF_MARKER_LABEL) {
        await applyNFMarkers(pedido.tiny_pedido_id, nfId, NF_MARKER_LABEL);
      }

      // Step 4: Update to aguardando_nf (waiting for SEFAZ authorization)
      await supabase
        .from('pedidos')
        .update({ status: 'aguardando_nf' })
        .eq('id', pedidoId);

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'status_change',
        descricao: adotada
          ? `NF ${nfId} ja existia no Tiny — adotada, aguardando autorizacao SEFAZ`
          : `NF gerada — NF ID: ${nfId}, aguardando autorizacao SEFAZ`,
        dados: { tiny_nf_id: nfId, adotada },
        ator: 'sistema',
      });

      return NextResponse.json({ ok: true, nf_id: nfId, adotada });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      await supabase
        .from('pedidos')
        .update({ status: 'erro_fiscal' })
        .eq('id', pedidoId);

      await supabase.from('eventos').insert({
        pedido_id: pedidoId,
        tipo: 'erro',
        descricao: `Erro na emissao da NF: ${message}`,
        dados: { error: message },
        ator: 'sistema',
      });

      await logError({
        source: 'job',
        category: 'external_api',
        message: `Emissao da NF falhou: ${message}`,
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
