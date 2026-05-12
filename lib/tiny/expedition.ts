import { createExpedition, fetchExpedition, fetchAllAgrupamentoLabels } from './client';
import { createServerClient, createStorageClient } from '@/lib/supabase/server';

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
  // Ordem com a qual a expedicao foi criada no Tiny — pode mudar abaixo, se a
  // resposta do fetchExpedition trouxer o array `expedicoes` numa ordem
  // diferente (essa e' a ordem real das etiquetas no PDF que sai da impressora).
  let orderedNfIds: number[] = nfIds;

  try {
    if (idFormaFrete) {
      const result = await createExpedition({
        idsNotasFiscais: nfIds,
        logistica: { formaFrete: { id: idFormaFrete } },
      });
      tinyExpedicaoId = result.id ?? null;

      // Fetch expedition details to get identificacao (numero) e a ordem real
      // das etiquetas (Tiny retorna expedicoes[] na ordem que vai imprimir).
      if (tinyExpedicaoId) {
        try {
          const details = await fetchExpedition(tinyExpedicaoId);
          numeroExpedicao = details.identificacao ? parseInt(details.identificacao, 10) : null;

          const inputSet = new Set(nfIds);
          const fromTiny = (details.expedicoes ?? [])
            .map((e) => e.idObjeto)
            .filter((id) => typeof id === 'number' && inputSet.has(id));
          if (fromTiny.length === nfIds.length) {
            orderedNfIds = fromTiny;
          }
        } catch {
          // non-fatal
        }
      }
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
        nf_ids: orderedNfIds,
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
      nf_ids: orderedNfIds,
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
    dados: { tiny_expedicao_id: tinyExpedicaoId, nf_ids: orderedNfIds, forma_frete: formaFrete, nf_ids_input: nfIds },
    ator: 'sistema',
  });

  return {
    expedicaoId: expedicao?.id ?? '',
    tinyExpedicaoId,
    numeroExpedicao,
  };
}

/**
 * Fetch labels from Tiny and cache them in Supabase Storage.
 * Designed to run in background — errors are logged, never thrown.
 */
export async function cacheExpeditionLabels(
  expeditionId: string,
  tinyAgrupamentoId: number,
  opts: { forceFallback?: boolean } = {}
): Promise<void> {
  const supabase = createServerClient();
  const storage = createStorageClient();
  const bucket = 'etiquetas';

  try {
    const { urls, partial } = await fetchAllAgrupamentoLabels(tinyAgrupamentoId, opts);
    if (!urls?.length) return;

    // Nao cacheia resultado parcial — caso tipico: cache roda em background
    // logo apos criar o agrupamento e o Tiny ainda nao terminou de gerar
    // alguma etiqueta. Se cachearmos os N-1 que vieram, a etiqueta faltante
    // some pra sempre (ate alguem usar ?refresh=1). Pulando aqui, a proxima
    // request bate no Tiny de novo e provavelmente pega tudo.
    if (partial) {
      console.warn(
        `[cacheExpeditionLabels] Resultado parcial pra expedicao ${expeditionId} (${urls.length} URL(s)) — pulando cache, proxima request re-busca.`
      );
      return;
    }

    const storagePaths: string[] = [];
    let uploadFailed = false;

    for (let i = 0; i < urls.length; i++) {
      const res = await fetch(urls[i]);
      if (!res.ok) {
        uploadFailed = true;
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = res.headers.get('content-type')?.includes('pdf') ? 'pdf' : 'pdf';
      const path = `${expeditionId}/etiqueta_${i + 1}.${ext}`;

      const { error } = await storage.storage
        .from(bucket)
        .upload(path, buffer, { contentType: 'application/pdf', upsert: true });

      if (error) {
        uploadFailed = true;
      } else {
        storagePaths.push(path);
      }
    }

    // So persiste cache se todas as URLs viraram arquivo no storage —
    // mesma logica do partial: melhor re-buscar do que servir cache faltando.
    if (storagePaths.length > 0 && !uploadFailed && storagePaths.length === urls.length) {
      await supabase
        .from('expedicoes')
        .update({ etiquetas_cache: storagePaths })
        .eq('id', expeditionId);
    } else if (uploadFailed) {
      console.warn(
        `[cacheExpeditionLabels] Falha no download/upload de alguma etiqueta pra expedicao ${expeditionId} (${storagePaths.length}/${urls.length}) — pulando cache.`
      );
    }
  } catch (err) {
    console.warn(`[cacheExpeditionLabels] Falha ao cachear etiquetas para ${expeditionId}:`, err);
  }
}
