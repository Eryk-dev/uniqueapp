// scripts/adopt-expedicao-5020.ts
//
// Adota a expedicao 5020 (agrupamento Tiny 746541439) que ficou orfa: foi criada
// no Tiny mas a rota /producao/gerar morreu por timeout antes de gravar lote +
// expedicao no app (incidente 2026-06-09, lote de 177 pedidos). As 9 NFs ja estao
// expedidas no Tiny (os pedidos viraram 'expedido' no auto-skip do regen), mas
// nunca foi gerada conferencia/chapa pra elas.
//
// Este script (NAO toca no Tiny — nada de createExpedition/completeExpedition):
//   1. fetchExpedition(746541439) -> numero (5020) + ordem das etiquetas (best-effort)
//   2. cria lote + atribui os itens dos 9 pedidos
//   3. cria a expedicao 5020 (status 'pendente') apontando pro agrupamento existente
//   4. roda processUniqueBoxBatch -> conferencia PDF + SVG + PNG no Storage
//
// Uso:
//   NEXT_PUBLIC_SUPABASE_URL=https://tkfpbcyjmaifuvfjqobn.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY='...' \
//   STORAGE_SUPABASE_URL=https://ehbxpbeijofxtsbezwxd.supabase.co \
//   STORAGE_SUPABASE_SERVICE_ROLE_KEY='...' \
//   npx tsx scripts/adopt-expedicao-5020.ts

import { createServerClient } from '../lib/supabase/server';
import { processUniqueBoxBatch } from '../lib/generation';
import { fetchExpedition } from '../lib/tiny/client';

const TINY_AGRUPAMENTO_ID = 746541439;
const NUMERO_FALLBACK = 5020;
const PEDIDO_NUMEROS = [52687, 52689, 52691, 52716, 52717, 52719, 52862, 52917, 52978];
const CRIADO_POR = '35a259e6-c1c7-4535-8da1-f72b7036dee6'; // Leonardo
const FORMA_FRETE = 'ECONÔMICA';
const ID_FORMA_FRETE = 781766876;
const ID_TRANSPORTADOR = 760002163;

async function main() {
  const supabase = createServerClient();

  // 0. pedidos + itens + NFs
  const { data: pedidos, error: pErr } = await supabase
    .from('pedidos')
    .select('id, numero, itens_producao(id), notas_fiscais(tiny_nf_id)')
    .in('numero', PEDIDO_NUMEROS);
  if (pErr || !pedidos?.length) throw new Error('pedidos nao encontrados: ' + pErr?.message);

  const itemIds = pedidos.flatMap((p) =>
    ((p.itens_producao as Array<{ id: string }>) ?? []).map((i) => i.id)
  );
  const dbNfIds = pedidos
    .flatMap((p) => ((p.notas_fiscais as Array<{ tiny_nf_id: number }>) ?? []).map((n) => n.tiny_nf_id))
    .filter(Boolean);
  console.log(`pedidos=${pedidos.length} itens=${itemIds.length} nfs=${dbNfIds.length}`);
  if (pedidos.length !== PEDIDO_NUMEROS.length) {
    throw new Error(`esperava ${PEDIDO_NUMEROS.length} pedidos, achei ${pedidos.length}`);
  }

  // 1. ordem do Tiny (best-effort)
  let numeroExpedicao = NUMERO_FALLBACK;
  let nfIdsOrdenados = dbNfIds;
  try {
    const details = await fetchExpedition(TINY_AGRUPAMENTO_ID);
    if (details.identificacao) numeroExpedicao = parseInt(details.identificacao, 10);
    const ordem = (details.expedicoes ?? [])
      .map((e) => e.idObjeto)
      .filter((x): x is number => typeof x === 'number');
    if (ordem.length) {
      const seen = new Set<number>();
      const ordered: number[] = [];
      for (const id of ordem) if (dbNfIds.includes(id) && !seen.has(id)) { seen.add(id); ordered.push(id); }
      for (const id of dbNfIds) if (!seen.has(id)) ordered.push(id);
      nfIdsOrdenados = ordered;
    }
    console.log(`Tiny OK: numero=${numeroExpedicao}, ordem=[${nfIdsOrdenados.join(',')}]`);
  } catch (e) {
    console.warn(`fetchExpedition falhou (usando numero=${NUMERO_FALLBACK} + ordem do DB):`, (e as Error).message);
  }

  // 2. guard idempotente — nao duplica expedicao
  const { data: existing } = await supabase
    .from('expedicoes')
    .select('id')
    .eq('numero_expedicao', numeroExpedicao)
    .maybeSingle();
  if (existing) throw new Error(`Expedicao ${numeroExpedicao} ja existe (${existing.id}) — abortando`);

  // 3. cria lote
  const { data: lote, error: lErr } = await supabase
    .from('lotes_producao')
    .insert({ linha_produto: 'uniquebox', total_itens: itemIds.length, criado_por: CRIADO_POR })
    .select()
    .single();
  if (lErr || !lote) throw new Error('erro criar lote: ' + lErr?.message);
  console.log('lote criado:', lote.id);

  // 4. atribui itens ao lote
  const { error: upErr } = await supabase
    .from('itens_producao')
    .update({ lote_id: lote.id })
    .in('id', itemIds);
  if (upErr) throw new Error('erro atribuir itens: ' + upErr.message);

  // 5. cria expedicao 5020 apontando pro agrupamento Tiny existente
  const { data: exped, error: eErr } = await supabase
    .from('expedicoes')
    .insert({
      lote_id: lote.id,
      tiny_agrupamento_id: TINY_AGRUPAMENTO_ID,
      tiny_expedicao_id: TINY_AGRUPAMENTO_ID,
      numero_expedicao: numeroExpedicao,
      forma_frete: FORMA_FRETE,
      id_forma_frete: ID_FORMA_FRETE,
      id_transportador: ID_TRANSPORTADOR,
      nf_ids: nfIdsOrdenados,
      status: 'pendente',
    })
    .select()
    .single();
  if (eErr || !exped) throw new Error('erro criar expedicao: ' + eErr?.message);
  console.log(`expedicao criada: ${exped.id} (numero ${numeroExpedicao})`);

  // 6. gera conferencia + SVG + PNG
  console.log('rodando processUniqueBoxBatch (gera conferencia + chapa)...');
  const res = await processUniqueBoxBatch(lote.id);
  console.log('batch result:', JSON.stringify(res));

  // 7. confere arquivos gerados
  const { data: arquivos } = await supabase
    .from('arquivos')
    .select('tipo, storage_path')
    .eq('lote_id', lote.id);
  console.log(`arquivos gerados (${arquivos?.length ?? 0}):`);
  for (const a of arquivos ?? []) console.log(`  - ${a.tipo}: ${a.storage_path}`);

  console.log(`\nPRONTO. Abra a expedicao ${numeroExpedicao} no app para baixar conferencia + chapa.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FALHOU:', e);
    process.exit(1);
  });
