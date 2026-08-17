/**
 * Ingestão compartilhada de eventos do Tiny — usada pelo webhook (caminho
 * primário) e pelo poller (fallback quando o webhook não chega).
 *
 * Extraído de app/api/webhooks/tiny-pedido/route.ts e
 * app/api/webhooks/nf-autorizada/route.ts em 2026-06-09 — a lógica de
 * gates/upsert/eventos/fila é a mesma, só muda a origem.
 */

import { createServerClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logger';
import { fetchOrder, setMarkers } from '@/lib/tiny/client';
import { extractCidadeUf } from '@/lib/tiny/endereco';
import { DEFAULT_SHIPPING } from '@/lib/tiny/shipping';
import { kickWorker } from '@/lib/worker';

// Ecommerce IDs from the full Tiny order → product line
export const ECOMMERCE_MAP: Record<number, string> = {
  9163: 'uniquebox',
  7251: 'uniquekids',
};

// So' ingerimos pedidos APROVADOS no Tiny (codigo de situacao = 3). "Aberta" (0)
// e demais estados pre-confirmacao nao sao pedidos confirmados/pagos ainda e nao
// devem entrar na plataforma.
export const SITUACAO_APROVADA = 3;

export type IngestOrigem = 'webhook' | 'polling';

export type IngestResult =
  | { outcome: 'ingerido'; pedidoId: string | null }
  | { outcome: 'ignorado'; reason: string }
  | { outcome: 'erro'; reason: string };

/** Campos do payload do webhook que têm precedência sobre o fetchOrder. */
export interface WebhookDados {
  tipoWebhook?: string;
  numero?: number | string;
  data?: string;
  idPedidoEcommerce?: string;
  idContato?: number | string;
  nomeEcommerce?: string;
  clienteNome?: string;
  formaEnvioDescricao?: string;
}

/**
 * Webhook manda DD/MM/YYYY; a API v3 (fetchOrder/listOrders) manda YYYY-MM-DD.
 * Fallback: hoje.
 */
export function parseDataPedido(data?: string): string {
  if (data?.includes('/')) {
    const parts = data.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  if (data && /^\d{4}-\d{2}-\d{2}/.test(data)) return data.slice(0, 10);
  return new Date().toISOString().split('T')[0];
}

/**
 * Ingere um pedido aprovado do Tiny: gates (situação + canal), upsert em
 * `pedidos`, marcador UNQAPP, evento e job fiscal_duplication.
 *
 * origem 'webhook': upsert sobrescreve (caller já validou o guard de
 * reprocessável — comportamento idêntico ao webhook original).
 * origem 'polling': INSERT-only (ignoreDuplicates) — se o webhook ingeriu o
 * pedido entre o check de existência do poller e aqui, o poller NÃO
 * sobrescreve status nem enfileira job duplicado (mesma classe do incidente
 * 2026-05-15 de NF duplicada).
 */
export async function ingestPedidoAprovado(opts: {
  tinyPedidoId: number;
  origem: IngestOrigem;
  webhookDados?: WebhookDados;
  webhookLogId?: string | null;
}): Promise<IngestResult> {
  const { tinyPedidoId, origem, webhookDados } = opts;
  const supabase = createServerClient();
  const errorSource = origem === 'webhook' ? 'webhook' : 'poller';
  const requestPath = origem === 'webhook' ? '/api/webhooks/tiny-pedido' : undefined;

  // Fetch full order from Tiny API to get ecommerce.id
  const tinyOrder = await fetchOrder(tinyPedidoId);

  // Gate de situacao: so' processa pedidos APROVADOS.
  if (tinyOrder.situacao !== SITUACAO_APROVADA) {
    return { outcome: 'ignorado', reason: `situacao nao aprovada: ${tinyOrder.situacao}` };
  }

  const linhaProduto = ECOMMERCE_MAP[tinyOrder.ecommerce?.id ?? 0];
  if (!linhaProduto) {
    return { outcome: 'ignorado', reason: `ecommerce.id desconhecido: ${tinyOrder.ecommerce?.id}` };
  }

  const row = {
    tiny_pedido_id: tinyPedidoId,
    numero: Number(webhookDados?.numero ?? tinyOrder.numeroPedido),
    data_pedido: parseDataPedido(webhookDados?.data ?? tinyOrder.data),
    id_pedido_ecommerce:
      webhookDados?.idPedidoEcommerce ?? tinyOrder.ecommerce?.numeroPedidoEcommerce ?? null,
    id_contato: Number(webhookDados?.idContato) || tinyOrder.cliente?.id || null,
    nome_ecommerce: webhookDados?.nomeEcommerce ?? 'Shopify',
    // Prioriza destinatario (enderecoEntrega.nomeDestinatario) — e' quem recebe.
    // Fallback pra cliente.nome (faturamento) quando Tiny apaga enderecoEntrega
    // (taxa adicional). Mesma logica do enrichment e da etiqueta DANFE.
    nome_cliente:
      tinyOrder.enderecoEntrega?.nomeDestinatario ??
      tinyOrder.cliente?.nome ??
      webhookDados?.clienteNome ??
      null,
    linha_produto: linhaProduto,
    // Cidade/UF do destinatario — usadas no romaneio de transportadora.
    // Sai de graca aqui porque o fetchOrder ja aconteceu.
    ...extractCidadeUf(tinyOrder),
    forma_frete:
      tinyOrder.transportador?.formaEnvio?.nome ??
      webhookDados?.formaEnvioDescricao ??
      DEFAULT_SHIPPING.formaEnvio.nome,
    id_forma_envio: tinyOrder.transportador?.formaEnvio?.id ?? DEFAULT_SHIPPING.formaEnvio.id,
    id_forma_frete: tinyOrder.transportador?.formaFrete?.id ?? DEFAULT_SHIPPING.formaFrete.id,
    id_transportador: tinyOrder.transportador?.id ?? DEFAULT_SHIPPING.transportadorId,
    status: 'recebido',
  };

  let pedidoId: string | null = null;

  if (origem === 'polling') {
    const { data: inserted, error } = await supabase
      .from('pedidos')
      .upsert(row, { onConflict: 'tiny_pedido_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle();

    if (error) {
      await logError({
        source: errorSource,
        category: 'database',
        message: `Insert pedido (polling) falhou: ${error.message}`,
        error,
        tiny_pedido_id: tinyPedidoId,
        metadata: { pg_error: error },
      });
      return { outcome: 'erro', reason: error.message };
    }

    if (!inserted) {
      // Webhook ganhou a corrida — nada a fazer.
      return { outcome: 'ignorado', reason: 'pedido ja existe (ingerido pelo webhook)' };
    }
    pedidoId = inserted.id;
  } else {
    const { error } = await supabase
      .from('pedidos')
      .upsert(row, { onConflict: 'tiny_pedido_id' });

    if (error) {
      await logError({
        source: errorSource,
        category: 'database',
        message: `Upsert pedido falhou: ${error.message}`,
        error,
        tiny_pedido_id: tinyPedidoId,
        webhook_log_id: opts.webhookLogId,
        request_path: requestPath,
        metadata: { pg_error: error },
      });
      return { outcome: 'erro', reason: error.message };
    }
  }

  // Tagueia o pedido como UNQAPP no Tiny — todo pedido que entra na plataforma
  // recebe esse marcador. POST /marcadores adiciona (nao substitui), entao nao
  // conflita com markers da duplicacao fiscal. Falha aqui NAO derruba a
  // ingestao (pedido ja foi salvo) — so' loga.
  try {
    await setMarkers(tinyPedidoId, ['UNQAPP']);
  } catch (markerErr) {
    await logError({
      source: errorSource,
      category: 'external_api',
      message: `Falha ao taguear pedido como UNQAPP: ${markerErr instanceof Error ? markerErr.message : 'erro desconhecido'}`,
      error: markerErr,
      tiny_pedido_id: tinyPedidoId,
      webhook_log_id: opts.webhookLogId,
      request_path: requestPath,
    });
  }

  if (!pedidoId) {
    const { data: pedido } = await supabase
      .from('pedidos')
      .select('id')
      .eq('tiny_pedido_id', tinyPedidoId)
      .single();
    pedidoId = pedido?.id ?? null;
  }

  if (pedidoId) {
    await supabase.from('eventos').insert({
      pedido_id: pedidoId,
      tipo: 'status_change',
      descricao:
        origem === 'webhook'
          ? `Pedido ${row.numero} recebido via webhook (${linhaProduto})`
          : `Pedido ${row.numero} recebido via polling fallback (${linhaProduto})`,
      dados: {
        tiny_pedido_id: tinyPedidoId,
        tipo_webhook: webhookDados?.tipoWebhook,
        ecommerce_id: tinyOrder.ecommerce?.id,
        origem,
      },
      ator: 'sistema',
    });

    // Enqueue fiscal duplication job. 23505 = job pendente duplicado bloqueado
    // pelo indice unico (uq_fila_job_ativo) — benigno, outro caminho ja enfileirou.
    const { error: filaError } = await supabase.from('fila_execucao').insert({
      pedido_id: pedidoId,
      tipo: 'fiscal_duplication',
    });
    if (filaError && filaError.code !== '23505') {
      await logError({
        source: errorSource,
        category: 'database',
        message: `Insert fila_execucao (fiscal_duplication) falhou: ${filaError.message}`,
        error: filaError,
        pedido_id: pedidoId,
        tiny_pedido_id: tinyPedidoId,
      });
    }
    console.log(
      `[ingest:${origem}] Pedido #${row.numero} salvo (${linhaProduto}) — job fiscal_duplication ${filaError ? (filaError.code === '23505' ? 'ja estava na fila' : 'FALHOU ao enfileirar') : 'enfileirado'}`
    );

    // Kick worker (fire-and-forget)
    kickWorker().catch(() => {});
  }

  return { outcome: 'ingerido', pedidoId };
}

/**
 * Marca uma NF como autorizada pela SEFAZ: update em `notas_fiscais`,
 * evento e job de enrichment. Idempotente: o update é condicionado a
 * `autorizada = false` — se webhook e poller correrem, só o primeiro
 * gera evento/job; o segundo retorna false sem efeito.
 */
export async function marcarNFAutorizada(opts: {
  nf: { id: string; pedido_id: string; tiny_nf_id: number; numero_nf: number | string | null };
  numero?: number | string | null;
  origem: IngestOrigem;
}): Promise<boolean> {
  const { nf, numero, origem } = opts;
  const supabase = createServerClient();

  const { data: updated } = await supabase
    .from('notas_fiscais')
    .update({
      autorizada: true,
      autorizada_at: new Date().toISOString(),
      numero_nf: numero ?? nf.numero_nf,
    })
    .eq('id', nf.id)
    .eq('autorizada', false)
    .select('id');

  // Outro caminho (webhook/poller) marcou primeiro — nada a fazer.
  if (!updated?.length) return false;

  // Log event (enrichment will set status to pronto_producao)
  await supabase.from('eventos').insert({
    pedido_id: nf.pedido_id,
    tipo: 'status_change',
    descricao: `NF ${numero ?? nf.tiny_nf_id} autorizada pela SEFAZ${origem === 'polling' ? ' (detectada via polling)' : ''}`,
    dados: { tiny_nf_id: nf.tiny_nf_id, numero_nf: numero, origem },
    ator: 'sistema',
  });

  // Enqueue enrichment job. 23505 = job pendente duplicado bloqueado pelo
  // indice unico (uq_fila_job_ativo) — benigno.
  const { error: filaError } = await supabase.from('fila_execucao').insert({
    pedido_id: nf.pedido_id,
    tipo: 'enrichment',
  });
  if (filaError && filaError.code !== '23505') {
    await logError({
      source: origem === 'webhook' ? 'webhook' : 'poller',
      category: 'database',
      message: `Insert fila_execucao (enrichment) falhou: ${filaError.message}`,
      error: filaError,
      pedido_id: nf.pedido_id,
    });
  }

  // Kick worker (fire-and-forget)
  kickWorker().catch(() => {});
  return true;
}
