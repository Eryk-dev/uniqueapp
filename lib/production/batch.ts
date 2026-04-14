import { createServerClient } from '@/lib/supabase/server';
import { processUniqueBoxBatch, processUniqueKidsBatch } from '@/lib/generation';
import type { LinhaProduto } from '@/lib/types';

export async function createProductionBatch(
  pedidoIds: string[],
  userId: string
): Promise<{ loteId: string; totalItens: number }> {
  const supabase = createServerClient();

  // Fetch orders and their items
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('*, itens_producao(*)')
    .in('id', pedidoIds)
    .in('status', ['pronto_producao']);

  if (error || !pedidos?.length) {
    throw new Error('No valid orders found for production');
  }

  // All orders must be same product line
  const linhas = new Set(pedidos.map((p) => p.linha_produto));
  if (linhas.size > 1) {
    throw new Error('All orders must be the same product line');
  }

  const linhaProduto: LinhaProduto = pedidos[0].linha_produto;

  // Collect all pending items
  const allItems = pedidos.flatMap((p) =>
    (p.itens_producao ?? []).filter(
      (i: { status: string }) => i.status === 'pendente'
    )
  );

  if (allItems.length === 0) {
    throw new Error('No pending items found for production');
  }

  // Create batch record
  const { data: lote, error: loteError } = await supabase
    .from('lotes_producao')
    .insert({
      linha_produto: linhaProduto,
      total_itens: allItems.length,
      criado_por: userId,
    })
    .select()
    .single();

  if (loteError || !lote) {
    throw new Error('Failed to create batch record');
  }

  // Assign items to batch
  await supabase
    .from('itens_producao')
    .update({ lote_id: lote.id })
    .in(
      'id',
      allItems.map((i: { id: string }) => i.id)
    );

  // Update orders to em_producao
  await supabase
    .from('pedidos')
    .update({ status: 'em_producao' })
    .in('id', pedidoIds);

  // Log event
  await supabase.from('eventos').insert({
    lote_id: lote.id,
    tipo: 'status_change',
    descricao: `Lote de producao criado: ${allItems.length} itens (${linhaProduto})`,
    dados: { pedido_ids: pedidoIds, total_itens: allItems.length },
    ator: userId,
  });

  // Trigger production asynchronously
  triggerProduction(lote.id, linhaProduto).catch((err) => {
    console.error('Production trigger failed:', err);
  });

  return { loteId: lote.id, totalItens: allItems.length };
}

async function triggerProduction(loteId: string, linhaProduto: LinhaProduto) {
  try {
    if (linhaProduto === 'uniquebox') {
      await processUniqueBoxBatch(loteId);
    } else {
      await processUniqueKidsBatch(loteId);
    }
  } catch (err) {
    const supabase = createServerClient();
    const message = err instanceof Error ? err.message : 'Unknown error';

    await supabase
      .from('lotes_producao')
      .update({ status: 'erro_parcial', completed_at: new Date().toISOString() })
      .eq('id', loteId);

    await supabase.from('eventos').insert({
      lote_id: loteId,
      tipo: 'erro',
      descricao: `Erro na producao: ${message}`,
      dados: { error: message },
      ator: 'sistema',
    });
  }
}

export async function retryFailedItems(
  loteId: string,
  itemIds: string[]
): Promise<void> {
  const supabase = createServerClient();

  // Reset failed items to pendente
  await supabase
    .from('itens_producao')
    .update({ status: 'pendente', erro_detalhe: null })
    .in('id', itemIds);

  // Get batch info
  const { data: lote } = await supabase
    .from('lotes_producao')
    .select('*')
    .eq('id', loteId)
    .single();

  if (!lote) throw new Error('Batch not found');

  // Update batch status back to processando
  await supabase
    .from('lotes_producao')
    .update({ status: 'processando', completed_at: null })
    .eq('id', loteId);

  // Trigger production again
  triggerProduction(loteId, lote.linha_produto as LinhaProduto).catch((err) => {
    console.error('Retry production trigger failed:', err);
  });
}

export async function createAutoTask(loteId: string, linhaProduto: string, status: string) {
  const supabase = createServerClient();

  const statusLabel = status === 'concluido' ? 'concluida' : 'com erros';
  const titulo = `Producao ${linhaProduto} — ${statusLabel} — ${new Date().toLocaleDateString('pt-BR')}`;

  await supabase.from('tarefas').insert({
    lote_id: loteId,
    titulo,
    status: 'pendente',
  });
}
