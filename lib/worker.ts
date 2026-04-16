/**
 * Execution worker — drains fila_execucao and processes jobs.
 *
 * Jobs are processed in FIFO order with exponential backoff on failure.
 * All Tiny API calls go through the rate limiter (lib/tiny/queue.ts).
 *
 * Usage:
 *   - kickWorker()     → starts singleton drain loop (idempotent)
 *   - processQueue(n)  → process up to n jobs (one-shot)
 */

import { createServerClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logger';
import { duplicateOrderForFiscal } from '@/lib/tiny/fiscal';
import { generateNFForOrder, applyNFMarkers } from '@/lib/tiny/nota-fiscal';
import { enrichOrder, saveEnrichmentResults } from '@/lib/tiny/enrichment';

const NF_MARKER_LABEL = process.env.TINY_NF_MARKER_LABEL ?? 'ecommerce';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FilaJob {
  id: string;
  pedido_id: string;
  tipo: 'fiscal_duplication' | 'enrichment';
  tentativas: number;
  max_tentativas: number;
}

export interface ProcessResult {
  processed: number;
  errors: number;
}

// ─── Job Execution ──────────────────────────────────────────────────────────

async function executeFiscalDuplication(pedidoId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: pedido } = await supabase
    .from('pedidos')
    .select('*')
    .eq('id', pedidoId)
    .single();

  if (!pedido) throw new Error('Pedido not found');

  // Idempotency: skip if already past recebido
  if (pedido.status !== 'recebido') return;

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

  // Step 5: Update status → aguardando_nf
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
}

async function executeEnrichment(pedidoId: string): Promise<void> {
  const supabase = createServerClient();

  const { data: pedido } = await supabase
    .from('pedidos')
    .select('*, notas_fiscais(*)')
    .eq('id', pedidoId)
    .single();

  if (!pedido) throw new Error('Pedido not found');

  // Idempotency
  if (pedido.status !== 'aguardando_nf') return;

  const nf = Array.isArray(pedido.notas_fiscais)
    ? pedido.notas_fiscais[0]
    : pedido.notas_fiscais;

  if (!nf?.tiny_nf_id) throw new Error('No NF found for pedido');

  const result = await enrichOrder(
    pedidoId,
    nf.tiny_nf_id,
    pedido.tiny_pedido_id,
    pedido.linha_produto
  );

  await saveEnrichmentResults(pedidoId, result);
}

async function executeJob(job: FilaJob): Promise<void> {
  switch (job.tipo) {
    case 'fiscal_duplication':
      await executeFiscalDuplication(job.pedido_id);
      break;
    case 'enrichment':
      await executeEnrichment(job.pedido_id);
      break;
    default:
      throw new Error(`Unknown job type: ${job.tipo}`);
  }
}

// ─── Queue Processor ────────────────────────────────────────────────────────

export async function processQueue(limit: number = 5): Promise<ProcessResult> {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  // Fetch pending jobs ready for execution
  const { data: jobs } = await supabase
    .from('fila_execucao')
    .select('id, pedido_id, tipo, tentativas, max_tentativas')
    .eq('status', 'pendente')
    .or(`proximo_retry_em.is.null,proximo_retry_em.lte.${now}`)
    .order('criado_em', { ascending: true })
    .limit(limit);

  if (!jobs?.length) {
    console.log('[worker] Fila vazia — nada para processar');
    return { processed: 0, errors: 0 };
  }

  console.log(`[worker] ${jobs.length} job(s) pendente(s)`);

  let processed = 0;
  let errors = 0;

  for (const job of jobs) {
    // Atomic claim: only update if still pendente
    const { data: claimed } = await supabase
      .from('fila_execucao')
      .update({ status: 'executando', atualizado_em: now })
      .eq('id', job.id)
      .eq('status', 'pendente')
      .select('id')
      .single();

    if (!claimed) {
      console.log(`[worker] Job ${job.id} já foi reivindicado por outro processo`);
      continue;
    }

    console.log(`[worker] Executando job ${job.tipo} (pedido: ${job.pedido_id})`);

    try {
      await executeJob(job as FilaJob);

      // Mark as concluido
      await supabase
        .from('fila_execucao')
        .update({
          status: 'concluido',
          executado_em: new Date().toISOString(),
        })
        .eq('id', job.id);

      console.log(`[worker] Job ${job.tipo} concluido com sucesso (pedido: ${job.pedido_id})`);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const tentativas = job.tentativas + 1;

      console.error(`[worker] Job ${job.tipo} ERRO (tentativa ${tentativas}/${job.max_tentativas}): ${message}`);

      if (tentativas >= job.max_tentativas) {
        // Final failure
        await supabase
          .from('fila_execucao')
          .update({ status: 'erro', erro: message, tentativas })
          .eq('id', job.id);

        // Update pedido status to error
        const errorStatus =
          job.tipo === 'fiscal_duplication' ? 'erro_fiscal' : 'erro_enriquecimento';
        await supabase
          .from('pedidos')
          .update({ status: errorStatus })
          .eq('id', job.pedido_id);

        await supabase.from('eventos').insert({
          pedido_id: job.pedido_id,
          tipo: 'erro',
          descricao: `Erro no job ${job.tipo} (tentativa ${tentativas}/${job.max_tentativas}): ${message}`,
          dados: { error: message, job_id: job.id },
          ator: 'sistema',
        });

        console.error(`[worker] Job ${job.tipo} FALHA FINAL — pedido marcado como ${errorStatus}`);
      } else {
        // Retry with exponential backoff: 30s, 60s, 120s (capped)
        const retryMs = Math.min(30_000 * Math.pow(2, tentativas - 1), 120_000);
        const proximoRetry = new Date(Date.now() + retryMs).toISOString();

        await supabase
          .from('fila_execucao')
          .update({
            status: 'pendente',
            tentativas,
            erro: message,
            proximo_retry_em: proximoRetry,
          })
          .eq('id', job.id);

        console.log(`[worker] Job ${job.tipo} reagendado — retry em ${retryMs / 1000}s`);
      }

      await logError({
        source: 'worker',
        category: 'external_api',
        message: `Job ${job.tipo} falhou (tentativa ${tentativas}): ${message}`,
        error: err,
        pedido_id: job.pedido_id,
        metadata: { job_id: job.id, tentativas, max: job.max_tentativas },
      });

      errors++;
    }
  }

  console.log(`[worker] Ciclo finalizado — processados: ${processed}, erros: ${errors}`);
  return { processed, errors };
}

// ─── Singleton Drain Loop ───────────────────────────────────────────────────

let _draining = false;

export async function kickWorker(): Promise<void> {
  if (_draining) return;
  _draining = true;

  try {
    while (true) {
      const result = await processQueue(5);
      if (result.processed === 0 && result.errors === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    _draining = false;
  }
}
