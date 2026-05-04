import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { fetchExpedition } from '@/lib/tiny/client';

/**
 * Re-sincroniza expedicoes.nf_ids com a ordem real das etiquetas no Tiny.
 *
 * Problema: createExpeditionForGroup salvava nf_ids na ordem que ENVIAVA
 * pra criar a expedicao no Tiny — mas o Tiny gera as etiquetas em ordem
 * propria, e essa ordem (a que sai do PDF da impressora) so' aparece em
 * fetchExpedition().expedicoes[]. Como a conferencia / chapa PNG / SVG
 * usam `nf_ids` pra ordenar, ficavam fora de sincronia com as etiquetas.
 *
 * Esta rota busca a ordem real do Tiny e atualiza o DB sem precisar
 * recriar a expedicao. Apos rodar, e' so reprocessar o lote pra os
 * artefatos saírem alinhados.
 *
 * Body opcional: { numero_expedicao?: number, expedicao_id?: string }
 * — sem body, processa todas as expedicoes com tiny_expedicao_id setado
 * que tem nf_ids nao-vazio.
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient();
  const body = (await request.json().catch(() => ({}))) as {
    numero_expedicao?: number;
    expedicao_id?: string;
  };

  let query = supabase
    .from('expedicoes')
    .select('id, numero_expedicao, tiny_expedicao_id, nf_ids')
    .not('tiny_expedicao_id', 'is', null);

  if (body.numero_expedicao) {
    query = query.eq('numero_expedicao', body.numero_expedicao);
  } else if (body.expedicao_id) {
    query = query.eq('id', body.expedicao_id);
  }

  const { data: expedicoes, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{
    numero_expedicao: number | null;
    expedicao_id: string;
    status: 'reordenada' | 'sem_mudanca' | 'erro_tiny' | 'mismatch_count' | 'sem_nf_ids';
    detalhe?: string;
  }> = [];

  for (const exp of expedicoes ?? []) {
    const expRow = exp as {
      id: string;
      numero_expedicao: number | null;
      tiny_expedicao_id: number | null;
      nf_ids: Array<number | string> | null;
    };

    const inputIds = (expRow.nf_ids ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (inputIds.length === 0) {
      results.push({
        numero_expedicao: expRow.numero_expedicao,
        expedicao_id: expRow.id,
        status: 'sem_nf_ids',
      });
      continue;
    }

    try {
      const details = await fetchExpedition(expRow.tiny_expedicao_id!);
      const inputSet = new Set(inputIds);
      const fromTiny = (details.expedicoes ?? [])
        .map((e) => e.idObjeto)
        .filter((id) => typeof id === 'number' && inputSet.has(id));

      if (fromTiny.length !== inputIds.length) {
        results.push({
          numero_expedicao: expRow.numero_expedicao,
          expedicao_id: expRow.id,
          status: 'mismatch_count',
          detalhe: `tiny=${fromTiny.length} vs db=${inputIds.length}`,
        });
        continue;
      }

      const sameOrder = fromTiny.every((id, i) => id === inputIds[i]);
      if (sameOrder) {
        results.push({
          numero_expedicao: expRow.numero_expedicao,
          expedicao_id: expRow.id,
          status: 'sem_mudanca',
        });
        continue;
      }

      await supabase.from('expedicoes').update({ nf_ids: fromTiny }).eq('id', expRow.id);
      results.push({
        numero_expedicao: expRow.numero_expedicao,
        expedicao_id: expRow.id,
        status: 'reordenada',
      });
    } catch (err) {
      results.push({
        numero_expedicao: expRow.numero_expedicao,
        expedicao_id: expRow.id,
        status: 'erro_tiny',
        detalhe: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, total: results.length, counts, results });
}
