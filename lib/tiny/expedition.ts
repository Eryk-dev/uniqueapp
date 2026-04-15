import { createExpedition } from './client';
import { createServerClient } from '@/lib/supabase/server';

export async function createExpeditionForGroup(
  loteId: string,
  formaFrete: string,
  nfIds: number[],
  idFormaFrete: number | null,
  idTransportador: number | null
): Promise<{ expedicaoId: string; tinyExpedicaoId: number | null; numeroExpedicao: number | null }> {
  const supabase = createServerClient();

  let tinyExpedicaoId: number | null = null;
  let numeroExpedicao: number | null = null;

  try {
    if (idFormaFrete) {
      const result = await createExpedition({
        idsNotasFiscais: nfIds,
        logistica: { formaFrete: { id: idFormaFrete } },
      });
      tinyExpedicaoId = result.id ?? null;
      numeroExpedicao = result.numero ?? null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    const { data: expedicao } = await supabase
      .from('expedicoes')
      .insert({
        lote_id: loteId,
        forma_frete: formaFrete,
        id_forma_frete: idFormaFrete,
        id_transportador: idTransportador,
        nf_ids: nfIds,
        status: 'erro',
        erro_detalhe: message,
      })
      .select()
      .single();

    await supabase.from('eventos').insert({
      lote_id: loteId,
      tipo: 'erro',
      descricao: `Erro ao criar expedicao ${formaFrete}: ${message}`,
      dados: { error: message, nf_ids: nfIds },
      ator: 'sistema',
    });

    return { expedicaoId: expedicao?.id ?? '', tinyExpedicaoId: null, numeroExpedicao: null };
  }

  const { data: expedicao } = await supabase
    .from('expedicoes')
    .insert({
      lote_id: loteId,
      tiny_expedicao_id: tinyExpedicaoId,
      numero_expedicao: numeroExpedicao,
      forma_frete: formaFrete,
      id_forma_frete: idFormaFrete,
      id_transportador: idTransportador,
      nf_ids: nfIds,
      status: 'criada',
    })
    .select()
    .single();

  const { data: itens } = await supabase
    .from('itens_producao')
    .select('pedido_id')
    .eq('lote_id', loteId)
    .in('tiny_nf_id', nfIds);

  if (itens?.length) {
    const pedidoIds = Array.from(new Set(itens.map((i) => i.pedido_id)));
    await supabase
      .from('pedidos')
      .update({ status: 'expedido' })
      .in('id', pedidoIds);
  }

  await supabase.from('eventos').insert({
    lote_id: loteId,
    tipo: 'expedicao_criada',
    descricao: `Expedicao ${formaFrete} criada — ${nfIds.length} NFs (Tiny ID: ${tinyExpedicaoId ?? 'N/A'})`,
    dados: { tiny_expedicao_id: tinyExpedicaoId, nf_ids: nfIds, forma_frete: formaFrete },
    ator: 'sistema',
  });

  return {
    expedicaoId: expedicao?.id ?? '',
    tinyExpedicaoId,
    numeroExpedicao,
  };
}
