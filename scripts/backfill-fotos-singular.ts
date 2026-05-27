// scripts/backfill-fotos-singular.ts
/**
 * Backfill de itens de bloco cuja `personalizacao` no Tiny veio com o
 * formato singular "Foto: <url>" (sem numero). O parser antigo
 * (lib/tiny/enrichment.ts:parsePersonalizacao) so reconhecia "Foto N: <url>",
 * entao esses itens ficaram com zero linhas em fotos_bloco e
 * tem_fotos_bloco=false. Resultado: sumiram da folha de conferencia
 * e do PNG da chapa (incidente Exp 4739/4742 — 2026-05-27).
 *
 * Esse script:
 *  1. Acha itens_producao com modelo ~ 'bloco', tem_fotos_bloco=false e
 *     personalizacao ilike 'Foto: http%' (formato singular).
 *  2. Chama enrichBlocoPhotos(pedido_id) — agora que o parser foi
 *     corrigido, ele extrai a URL como posicao=1 e enfileira download.
 *  3. Flush dos downloads pendentes.
 *
 * Rodar:
 *   NEXT_PUBLIC_SUPABASE_URL=https://tkfpbcyjmaifuvfjqobn.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY='...' \
 *   STORAGE_SUPABASE_URL=https://ehbxpbeijofxtsbezwxd.supabase.co \
 *   STORAGE_SUPABASE_SERVICE_ROLE_KEY='...' \
 *   npx tsx scripts/backfill-fotos-singular.ts [--dry-run]
 */
import { createClient } from '@supabase/supabase-js';
import { enrichBlocoPhotos } from '../lib/tiny/enrichment';
import { downloadPendingPhotosForItems } from '../lib/storage/photos';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: 'unique_app' } }
  );

  // Busca itens de bloco sem fotos_bloco que tem 'Foto: http' singular na
  // personalizacao (formato que o parser antigo nao reconhecia).
  const { data: itens, error } = await supabase
    .from('itens_producao')
    .select('id, pedido_id, sku, personalizacao, tem_fotos_bloco, pedidos!inner(numero, nome_cliente, status)')
    .ilike('modelo', '%bloco%')
    .eq('tem_fotos_bloco', false)
    .ilike('personalizacao', 'Foto: http%');

  if (error) throw new Error(error.message);
  if (!itens || itens.length === 0) {
    console.log('Nenhum item afetado. Nada a fazer.');
    return;
  }

  // Dedup por pedido — enrichBlocoPhotos roda no pedido inteiro, nao item.
  const pedidoIds = Array.from(new Set(itens.map((i) => i.pedido_id)));

  console.log(`Encontrados ${itens.length} item(ns) afetado(s) em ${pedidoIds.length} pedido(s).\n`);
  for (const it of itens) {
    const p = Array.isArray(it.pedidos) ? it.pedidos[0] : it.pedidos;
    const pp = p as { numero?: number; nome_cliente?: string; status?: string } | undefined;
    console.log(
      `  pedido #${pp?.numero ?? '?'} (${pp?.nome_cliente ?? '?'}) status=${pp?.status ?? '?'} — item ${it.id} sku=${it.sku}`
    );
  }

  if (dryRun) {
    console.log('\n--dry-run: nao executando enrichBlocoPhotos.');
    return;
  }

  let okCount = 0;
  let errCount = 0;
  const allItemIds: string[] = [];

  for (const pedidoId of pedidoIds) {
    const result = await enrichBlocoPhotos(pedidoId);
    if (result.ok) {
      console.log(`  ✓ Pedido ${pedidoId} enriquecido`);
      okCount++;
    } else {
      console.error(`  ✗ Pedido ${pedidoId}: ${result.error.code}: ${result.error.message}`);
      errCount++;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Coleta TODOS os itens de bloco dos pedidos pra flush (enrichBlocoPhotos
  // limpa fotos_bloco existentes e re-cria — pode haver itens com fotos ja
  // ok que precisam de re-download).
  const { data: allItens } = await supabase
    .from('itens_producao')
    .select('id')
    .in('pedido_id', pedidoIds)
    .ilike('modelo', '%bloco%');
  for (const i of allItens ?? []) allItemIds.push(i.id);

  if (allItemIds.length > 0) {
    console.log(`\nAguardando downloads pendentes de ${allItemIds.length} item(ns)...`);
    const flush = await downloadPendingPhotosForItems(allItemIds);
    console.log(`Flush: ${flush.ok} baixadas, ${flush.erro} erro`);
  }

  console.log(`\nResultado: ${okCount} pedido(s) ok, ${errCount} erro`);
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
