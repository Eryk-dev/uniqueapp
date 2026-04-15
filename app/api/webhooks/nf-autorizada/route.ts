import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { logWebhook, logError, safeHeaders } from '@/lib/logger';
import { kickWorker } from '@/lib/worker';

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const dados = payload.dados;
  // Tiny NF webhook uses 'idNotaFiscalTiny', not 'id'
  const tinyNfId = Number(dados?.idNotaFiscalTiny ?? dados?.id);

  const wh = await logWebhook({
    source: 'nf-autorizada',
    endpoint: '/api/webhooks/nf-autorizada',
    headers: safeHeaders(request),
    body: payload,
    dedup_key: tinyNfId ? `nf-autorizada-${tinyNfId}` : undefined,
  });

  try {
    if (!tinyNfId) {
      await wh.finish({ status: 'erro', status_code: 400, error_message: 'Missing dados.idNotaFiscalTiny' });
      return NextResponse.json({ error: 'Missing dados.idNotaFiscalTiny' }, { status: 400 });
    }
    const supabase = createServerClient();

    // Find NF record
    const { data: nf } = await supabase
      .from('notas_fiscais')
      .select('*, pedidos(*)')
      .eq('tiny_nf_id', tinyNfId)
      .single();

    if (!nf) {
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Idempotency: skip if already authorized
    if (nf.autorizada) {
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { skipped: true } });
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Update NF as authorized
    await supabase
      .from('notas_fiscais')
      .update({
        autorizada: true,
        autorizada_at: new Date().toISOString(),
        numero_nf: dados.numero ?? nf.numero_nf,
      })
      .eq('id', nf.id);

    // Log event (enrichment will set status to pronto_producao)
    await supabase.from('eventos').insert({
      pedido_id: nf.pedido_id,
      tipo: 'status_change',
      descricao: `NF ${dados.numero ?? tinyNfId} autorizada pela SEFAZ`,
      dados: { tiny_nf_id: tinyNfId, numero_nf: dados.numero },
      ator: 'sistema',
    });

    // Enqueue enrichment job
    await supabase.from('fila_execucao').insert({
      pedido_id: nf.pedido_id,
      tipo: 'enrichment',
    });

    // Kick worker (fire-and-forget)
    kickWorker().catch(() => {});

    await wh.finish({ status: 'sucesso', status_code: 200, pedido_id: nf.pedido_id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logError({
      source: 'webhook',
      category: 'infrastructure',
      message: `Webhook nf-autorizada falhou: ${message}`,
      error: err,
      webhook_log_id: wh.id,
      request_path: '/api/webhooks/nf-autorizada',
    });
    await wh.finish({ status: 'erro', status_code: 500, error_message: message });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
