import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { logWebhook, logError, safeHeaders } from '@/lib/logger';
import { kickWorker } from '@/lib/worker';

// Log de TODA request (qualquer metodo, incluindo ping de validacao sem body)
// — console (logs do EasyPanel) + webhook_logs. Instrumentacao incidente 09/06.
async function logHit(request: NextRequest, raw: string) {
  const meta = {
    method: request.method,
    ua: request.headers.get('user-agent') ?? '?',
    ip: request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? '?',
    len: raw.length,
  };
  console.log(`[webhook:nf-autorizada] HIT ${JSON.stringify(meta)} raw=${raw.slice(0, 500) || '(vazio)'}`);
  await logWebhook({
    source: 'nf-autorizada',
    endpoint: '/api/webhooks/nf-autorizada',
    method: request.method,
    headers: safeHeaders(request),
    body: { _raw: raw.slice(0, 2000), _meta: meta },
  }).then((wh) => wh.finish({ status: 'ignorado', status_code: 200, response_body: { probe: true } }))
    .catch((e) => console.error(`[webhook:nf-autorizada] logHit falhou: ${e?.message}`));
}

export async function GET(request: NextRequest) {
  await logHit(request, '');
  return NextResponse.json({ ok: true });
}

export async function HEAD(request: NextRequest) {
  await logHit(request, '');
  return new NextResponse(null, { status: 200 });
}

export async function OPTIONS(request: NextRequest) {
  await logHit(request, '');
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let payload;
  try {
    payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') throw new Error('payload nao-objeto');
  } catch {
    // Tiny manda ping SEM body ao salvar/validar o webhook no painel — sem esse
    // guard, request.json() estoura 500 e o Tiny desativa a notificacao.
    await logHit(request, raw);
    return NextResponse.json({ ok: true, ping: true });
  }
  console.log(`[webhook:nf-autorizada] POST ua="${request.headers.get('user-agent')}" ip=${request.headers.get('x-real-ip') ?? '?'} body=${raw.slice(0, 300)}`);
  const dados = payload?.dados;
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
      // 200 (nao 400): resposta nao-2xx conta como falha de entrega no Tiny e
      // falhas consecutivas desativam a notificacao.
      console.log('[webhook:nf-autorizada] Ignorado — idNotaFiscalTiny ausente');
      await wh.finish({ status: 'ignorado', status_code: 200, response_body: { ignored: true, reason: 'Missing dados.idNotaFiscalTiny' } });
      return NextResponse.json({ ok: true, ignored: true });
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

    console.log(`[webhook:nf-autorizada] NF ${tinyNfId} autorizada — job enrichment enfileirado (pedido: ${nf.pedido_id})`);

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
    console.error(`[webhook:nf-autorizada] ERRO: ${message}`);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
