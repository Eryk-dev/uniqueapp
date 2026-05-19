import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { logWebhook, logError, safeHeaders } from '@/lib/logger';
import { fetchOrder } from '@/lib/tiny/client';
import { kickWorker } from '@/lib/worker';

// Ecommerce IDs from the full Tiny order → product line
const ECOMMERCE_MAP: Record<number, string> = {
  9163: 'uniquebox',
  7251: 'uniquekids',
};

// Default shipping: Loggi Econômica (most used — 79% of orders)
const DEFAULT_SHIPPING = {
  formaEnvio: { id: 929831281, nome: 'Loggi' },
  formaFrete: { id: 929831289, nome: 'ECONÔMICA' },
  transportadorId: 773511709,
  transportadorNome: 'Entrega comum',
};

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

    // Fetch full order from Tiny API to get ecommerce.id
    const tinyOrder = await fetchOrder(tinyPedidoId);
    const linhaProduto = ECOMMERCE_MAP[tinyOrder.ecommerce?.id ?? 0];

    if (!linhaProduto) {
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true, reason: `ecommerce.id desconhecido: ${tinyOrder.ecommerce?.id}` } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Parse date from DD/MM/YYYY to YYYY-MM-DD
    const dateParts = dados.data?.split('/');
    const dataPedido = dateParts?.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : new Date().toISOString().split('T')[0];

    // Upsert order (idempotent on tiny_pedido_id) — so executa quando
    // reprocessavel === true (pedido novo ou em estado de erro fiscal).
    const { error } = await supabase
      .from('pedidos')
      .upsert(
        {
          tiny_pedido_id: tinyPedidoId,
          numero: Number(dados.numero),
          data_pedido: dataPedido,
          id_pedido_ecommerce: dados.idPedidoEcommerce ?? tinyOrder.ecommerce?.numeroPedidoEcommerce ?? null,
          id_contato: Number(dados.idContato) || tinyOrder.cliente?.id || null,
          nome_ecommerce: dados.nomeEcommerce ?? 'Shopify',
          // Prioriza destinatario (enderecoEntrega.nomeDestinatario) — e' quem recebe.
          // Fallback pra cliente.nome (faturamento) quando Tiny apaga enderecoEntrega
          // (taxa adicional). Mesma logica do enrichment e da etiqueta DANFE.
          nome_cliente: tinyOrder.enderecoEntrega?.nomeDestinatario
            ?? tinyOrder.cliente?.nome
            ?? dados.cliente?.nome
            ?? null,
          linha_produto: linhaProduto,
          forma_frete: tinyOrder.transportador?.formaEnvio?.nome ?? dados.formaEnvio?.descricao ?? DEFAULT_SHIPPING.formaEnvio.nome,
          id_forma_envio: tinyOrder.transportador?.formaEnvio?.id ?? DEFAULT_SHIPPING.formaEnvio.id,
          id_forma_frete: tinyOrder.transportador?.formaFrete?.id ?? DEFAULT_SHIPPING.formaFrete.id,
          id_transportador: tinyOrder.transportador?.id ?? DEFAULT_SHIPPING.transportadorId,
          status: 'recebido',
        },
        { onConflict: 'tiny_pedido_id' }
      );

    if (error) {
      await logError({
        source: 'webhook',
        category: 'database',
        message: `Upsert pedido falhou: ${error.message}`,
        error,
        tiny_pedido_id: tinyPedidoId,
        webhook_log_id: wh.id,
        request_path: '/api/webhooks/tiny-pedido',
        metadata: { pg_error: error },
      });
      await wh.finish({ status: 'erro', status_code: 500, error_message: error.message });
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // Log event
    const { data: pedido } = await supabase
      .from('pedidos')
      .select('id')
      .eq('tiny_pedido_id', tinyPedidoId)
      .single();

    if (pedido) {
      await supabase.from('eventos').insert({
        pedido_id: pedido.id,
        tipo: 'status_change',
        descricao: `Pedido ${dados.numero} recebido via webhook (${linhaProduto})`,
        dados: { tiny_pedido_id: tinyPedidoId, tipo_webhook: payload.tipo, ecommerce_id: tinyOrder.ecommerce?.id },
        ator: 'sistema',
      });

      // Enqueue fiscal duplication job
      await supabase.from('fila_execucao').insert({
        pedido_id: pedido.id,
        tipo: 'fiscal_duplication',
      });
      console.log(`[webhook:tiny-pedido] Pedido #${dados.numero} salvo (${linhaProduto}) — job fiscal_duplication enfileirado`);

      // Kick worker (fire-and-forget)
      kickWorker().catch(() => {});
    }

    await wh.finish({ status: 'sucesso', status_code: 200, pedido_id: pedido?.id });
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
