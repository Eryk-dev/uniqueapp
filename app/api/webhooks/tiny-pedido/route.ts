import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { logWebhook, logError, safeHeaders } from '@/lib/logger';

// Ecommerce IDs that map to our product lines
const ECOMMERCE_MAP: Record<string, string> = {
  '9163': 'uniquebox', // Shopify UniqueBox
  '7251': 'uniquekids', // Shopify UniqueKids
};

interface TinyWebhookPayload {
  tipo: string;
  dados: {
    id: number;
    numero: number;
    data: string;
    idPedidoEcommerce?: string;
    codigoSituacao?: string;
    idContato?: number;
    idNotaFiscal?: number;
    nomeEcommerce?: string;
    idEcommerce?: number;
  };
}

export async function POST(request: NextRequest) {
  const payload: TinyWebhookPayload = await request.json();
  const wh = await logWebhook({
    source: 'tiny-pedido',
    endpoint: '/api/webhooks/tiny-pedido',
    headers: safeHeaders(request),
    body: payload,
    tiny_pedido_id: payload.dados?.id,
    dedup_key: payload.dados?.id ? `tiny-pedido-${payload.dados.id}` : undefined,
  });

  try {
    const dados = payload.dados;

    if (!dados?.id) {
      await wh.finish({ status: 'erro', status_code: 400, error_message: 'Missing dados.id' });
      return NextResponse.json({ error: 'Missing dados.id' }, { status: 400 });
    }

    // Determine product line from ecommerce ID
    const idEcommerce = String(dados.idEcommerce ?? '');
    const linhaProduto = ECOMMERCE_MAP[idEcommerce];

    // Ignore non-Shopify orders (e.g., Mercado Livre)
    if (!linhaProduto) {
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true } });
      return NextResponse.json({ ok: true, ignored: true });
    }

    // Parse date from DD/MM/YYYY to YYYY-MM-DD
    const dateParts = dados.data?.split('/');
    const dataPedido = dateParts?.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : new Date().toISOString().split('T')[0];

    const supabase = createServerClient();

    // Upsert order (idempotent on tiny_pedido_id)
    const { error } = await supabase
      .from('pedidos')
      .upsert(
        {
          tiny_pedido_id: dados.id,
          numero: dados.numero,
          data_pedido: dataPedido,
          id_pedido_ecommerce: dados.idPedidoEcommerce ?? null,
          id_contato: dados.idContato ?? null,
          nome_ecommerce: dados.nomeEcommerce ?? 'Shopify',
          linha_produto: linhaProduto,
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
        tiny_pedido_id: dados.id,
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
      .eq('tiny_pedido_id', dados.id)
      .single();

    if (pedido) {
      await supabase.from('eventos').insert({
        pedido_id: pedido.id,
        tipo: 'status_change',
        descricao: `Pedido ${dados.numero} recebido via webhook (${linhaProduto})`,
        dados: { tiny_pedido_id: dados.id, tipo_webhook: payload.tipo },
        ator: 'sistema',
      });
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
      tiny_pedido_id: payload.dados?.id,
      webhook_log_id: wh.id,
      request_path: '/api/webhooks/tiny-pedido',
    });
    await wh.finish({ status: 'erro', status_code: 500, error_message: message });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
