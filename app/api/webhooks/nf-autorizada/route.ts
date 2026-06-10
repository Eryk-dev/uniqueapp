import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { logWebhook, logError, safeHeaders } from '@/lib/logger';
import { marcarNFAutorizada } from '@/lib/tiny/ingest';

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
    console.log(`[webhook:nf-autorizada] Recebido — tipo: ${payload.tipo}, nfId: ${tinyNfId}, numero: ${dados?.numero}`);

    if (wh.duplicate) {
      console.log(`[webhook:nf-autorizada] NF ${tinyNfId} — webhook duplicado (dedup_key), ignorado`);
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (!tinyNfId) {
      console.log('[webhook:nf-autorizada] Ignorado — idNotaFiscalTiny ausente');
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
      console.log(`[webhook:nf-autorizada] NF ${tinyNfId} nao encontrada no sistema — ignorado`);
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Idempotency: skip if already authorized
    if (nf.autorizada) {
      console.log(`[webhook:nf-autorizada] NF ${tinyNfId} ja autorizada — skip`);
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { skipped: true } });
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Update + evento + job enrichment + kick — compartilhado com o
    // polling fallback (lib/tiny/poller.ts).
    const marcou = await marcarNFAutorizada({
      nf: { id: nf.id, pedido_id: nf.pedido_id, tiny_nf_id: tinyNfId, numero_nf: nf.numero_nf },
      numero: dados.numero,
      origem: 'webhook',
    });

    console.log(
      marcou
        ? `[webhook:nf-autorizada] NF ${tinyNfId} autorizada — job enrichment enfileirado (pedido: ${nf.pedido_id})`
        : `[webhook:nf-autorizada] NF ${tinyNfId} ja marcada por outro caminho (race) — skip`
    );

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
    console.error(`[webhook:nf-autorizada] ERRO: ${message}`);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
