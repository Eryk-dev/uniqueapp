import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { logWebhook, logError, safeHeaders } from '@/lib/logger';
import { ingestPedidoAprovado } from '@/lib/tiny/ingest';

// Gates de situacao (aprovada=3) e de canal (ECOMMERCE_MAP) moram em
// lib/tiny/ingest.ts — compartilhados com o polling fallback (lib/tiny/poller.ts).

interface TinyWebhookPayload {
  tipo: string;
  dados: {
    id: number | string;
    numero: number | string;
    data: string;
    idPedidoEcommerce?: string;
    codigoSituacao?: string;
    idContato?: number | string;
    idNotaFiscal?: number | string;
    nomeEcommerce?: string;
    cliente?: { nome: string; cpfCnpj?: string };
    formaEnvio?: { id: number | string; descricao: string };
  };
}

export async function POST(request: NextRequest) {
  const payload: TinyWebhookPayload = await request.json();
  const tinyPedidoId = Number(payload.dados?.id);
  const wh = await logWebhook({
    source: 'tiny-pedido',
    endpoint: '/api/webhooks/tiny-pedido',
    headers: safeHeaders(request),
    body: payload,
    tiny_pedido_id: tinyPedidoId || undefined,
    dedup_key: tinyPedidoId ? `tiny-pedido-${tinyPedidoId}` : undefined,
  });

  try {
    const dados = payload.dados;
    console.log(`[webhook:tiny-pedido] Recebido — tipo: ${payload.tipo}, id: ${dados?.id}, ecommerce: ${dados?.nomeEcommerce}`);

    if (wh.duplicate) {
      console.log(`[webhook:tiny-pedido] Pedido ${tinyPedidoId} — webhook duplicado (dedup_key), ignorado`);
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (!dados?.id) {
      console.log('[webhook:tiny-pedido] Ignorado — dados.id ausente');
      await wh.finish({ status: 'erro', status_code: 400, error_message: 'Missing dados.id' });
      return NextResponse.json({ error: 'Missing dados.id' }, { status: 400 });
    }

    // Only process Shopify orders (same filter as n8n workflow)
    if (dados.nomeEcommerce !== 'Shopify') {
      console.log(`[webhook:tiny-pedido] Ignorado — nomeEcommerce: ${dados.nomeEcommerce}`);
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true, reason: `nomeEcommerce: ${dados.nomeEcommerce}` } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    const supabase = createServerClient();

    // Guard re-processamento: se ja existe pedido pra esse tiny_pedido_id e ele
    // ja avancou alem de `recebido`/erro fiscal, NAO sobrescrever status nem
    // re-enfileirar fiscal_duplication. Esse webhook tambem chega como
    // `tipo: "atualizacao_pedido"` quando o operador mexe no pedido no Tiny
    // (ex: marcar como enviado) — sem esse guard, o upsert ressetava status
    // de pedidos ja expedidos pra `recebido` e duplicava NFs (incidente
    // 2026-05-15: 9 pedidos uniquekids ja expedidos em 06/05 ganharam NF
    // duplicada, expedicao do dia 18/05 falhou com "Nota fiscal ja expedida").
    const { data: pedidoExistente } = await supabase
      .from('pedidos')
      .select('id, status')
      .eq('tiny_pedido_id', tinyPedidoId)
      .maybeSingle();

    const reprocessavel = !pedidoExistente
      || pedidoExistente.status === 'recebido'
      || pedidoExistente.status === 'erro_fiscal';

    if (!reprocessavel) {
      await supabase.from('eventos').insert({
        pedido_id: pedidoExistente!.id,
        tipo: 'status_change',
        descricao: `Webhook ${payload.tipo} ignorado — pedido ja em ${pedidoExistente!.status}`,
        dados: { tiny_pedido_id: tinyPedidoId, tipo_webhook: payload.tipo, status_atual: pedidoExistente!.status },
        ator: 'sistema',
      });
      await wh.finish({
        status: 'ignorado',
        status_code: 200,
        response_body: { ignored: true, reason: `pedido ja em status ${pedidoExistente!.status}` },
        pedido_id: pedidoExistente!.id,
      });
      console.log(`[webhook:tiny-pedido] Pedido #${dados.numero} ignorado — ja em status ${pedidoExistente!.status}`);
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Ingestao compartilhada: fetchOrder + gate de situacao aprovada + gate de
    // canal + upsert + marcador UNQAPP + evento + job fiscal_duplication.
    const result = await ingestPedidoAprovado({
      tinyPedidoId,
      origem: 'webhook',
      webhookLogId: wh.id,
      webhookDados: {
        tipoWebhook: payload.tipo,
        numero: dados.numero,
        data: dados.data,
        idPedidoEcommerce: dados.idPedidoEcommerce,
        idContato: dados.idContato,
        nomeEcommerce: dados.nomeEcommerce,
        clienteNome: dados.cliente?.nome,
        formaEnvioDescricao: dados.formaEnvio?.descricao,
      },
    });

    if (result.outcome === 'ignorado') {
      console.log(`[webhook:tiny-pedido] Pedido #${dados.numero} ignorado — ${result.reason}`);
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true, reason: result.reason } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (result.outcome === 'erro') {
      await wh.finish({ status: 'erro', status_code: 500, error_message: result.reason });
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    await wh.finish({ status: 'sucesso', status_code: 200, pedido_id: result.pedidoId ?? undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await logError({
      source: 'webhook',
      category: 'infrastructure',
      message: `Webhook tiny-pedido falhou: ${message}`,
      error: err,
      tiny_pedido_id: tinyPedidoId || undefined,
      webhook_log_id: wh.id,
      request_path: '/api/webhooks/tiny-pedido',
    });
    await wh.finish({ status: 'erro', status_code: 500, error_message: message });
    console.error(`[webhook:tiny-pedido] ERRO: ${message}`);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
